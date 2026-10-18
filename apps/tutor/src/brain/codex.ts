import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../paths";
import { log } from "../log";
import type { Brain, TurnInput, TurnResult } from "./types";
import { CodexAppServer, TUTOR_THREAD_CONFIG } from "./codexAppServer";

/**
 * Drives the `codex` CLI through `codex app-server`: one long-lived process
 * per lesson, one Codex thread per board, token deltas streamed as they
 * arrive, and a real turn/interrupt instead of a kill. Bills to the ChatGPT
 * plan the CLI is logged in with (`codex login`).
 *
 * The system prompt goes in as the thread's base instructions, which replace
 * Codex's own coding-agent prompt. A live thread ignores new ones; a resumed
 * thread takes them. So when ours changes mid-lesson (a new figure, images
 * switched on) the process is restarted and the thread resumed.
 *
 * Threads are stored under the Codex home, not the working directory, so a
 * saved board resumes from anywhere; the empty directory just keeps Codex
 * away from any repo or AGENTS.md.
 */
export class CodexBrain implements Brain {
  readonly name = "codex";
  private threadId: string | null;
  /** True once this process has started or resumed the thread. */
  private loaded = false;
  private lastSystem: string | null = null;
  private server: CodexAppServer | null = null;

  constructor(
    readonly model: string,
    session: string | null = null,
    private readonly bin = process.env.CODEX_BIN ?? "codex",
  ) {
    this.threadId = session;
  }

  get session(): string | null {
    return this.threadId;
  }

  forget() {
    this.threadId = null;
    this.loaded = false;
    this.lastSystem = null;
  }

  async turn({ system, userText, signal, onText }: TurnInput): Promise<TurnResult> {
    // Codex fixes base instructions while a thread is live and only takes new
    // ones on resume, so a changed system prompt means a fresh process.
    if (this.server && this.loaded && system !== this.lastSystem) this.restart();
    if (this.server && !this.server.alive) this.restart();
    const server = (this.server ??= new CodexAppServer({ bin: this.bin, cwd: brainDir() }));
    try {
      await server.whenReady();
      const auth = await server.call<{ account: unknown; requiresOpenaiAuth: boolean }>("account/read", {});
      // Without this check an unauthenticated turn retries five times before failing.
      if (!auth.account && auth.requiresOpenaiAuth) return { status: "error", message: "Codex is not signed in. Run `codex login` in a terminal, then try again." };

      if (!this.loaded) {
        const thread = {
          // Empty means whatever Codex defaults to for this account.
          ...(this.model ? { model: this.model } : {}),
          cwd: brainDir(),
          sandbox: "read-only",
          approvalPolicy: "never",
          baseInstructions: system,
          config: TUTOR_THREAD_CONFIG,
        };
        if (this.threadId) {
          try {
            await server.call("thread/resume", { threadId: this.threadId, ...thread, excludeTurns: true });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.warn("codex resume failed:", message);
            return { status: "error", message, lostSession: /no rollout found/i.test(message) };
          }
        } else {
          const r = await server.call<{ thread: { id: string } }>("thread/start", thread);
          this.threadId = r.thread.id;
        }
        this.loaded = true;
        this.lastSystem = system;
      }
      return await runTurn(server, this.threadId!, userText, { model: this.model || undefined, effort: process.env.CODEX_EFFORT, signal, onText });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn("codex turn failed:", message);
      this.restart();
      return { status: "error", message: /ENOENT/.test(message) ? `codex CLI not found (${this.bin}). Install it with \`npm i -g @openai/codex\`.` : message };
    }
  }

  /** Drop the process; the next turn starts a new one and resumes the thread. */
  private restart() {
    this.server?.close();
    this.server = null;
    this.loaded = false;
  }

  close() {
    this.server?.close();
    this.server = null;
  }
}

export interface CodexTurnOptions {
  model?: string;
  effort?: string;
  outputSchema?: unknown;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}

/** What a finished turn hands back, on top of the brain's TurnResult. */
export type CodexTurnResult = TurnResult & { text: string };

/**
 * Starts one turn on a loaded thread and follows it to turn/completed.
 * Streams answer text only: commentary items (a model narrating what it is
 * about to do) are left off the board.
 */
export function runTurn(server: CodexAppServer, threadId: string, text: string, opts: CodexTurnOptions): Promise<CodexTurnResult> {
  return new Promise((resolve) => {
    let turnId: string | null = null;
    let interruptAsked = false;
    let finalError: string | undefined;
    let usage: TokenUsage | undefined;
    const phases = new Map<string, string | null>();
    let lastItem: string | null = null;
    const answer: string[] = [];
    let done = false;

    const finish = (r: TurnResult) => {
      if (done) return;
      done = true;
      offNote();
      offExit();
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ ...r, text: answer.join("") });
    };
    const interrupt = () => {
      if (turnId) server.call("turn/interrupt", { threadId, turnId }).catch(() => {});
    };
    const onAbort = () => {
      interruptAsked = true;
      interrupt();
    };

    const offNote = server.on((method, p) => {
      if (p.threadId !== threadId) return;
      switch (method) {
        case "item/started": {
          const item = p.item as { type: string; id: string; phase?: string | null };
          if (item.type === "agentMessage") phases.set(item.id, item.phase ?? null);
          break;
        }
        case "item/agentMessage/delta": {
          const itemId = p.itemId as string;
          if (phases.get(itemId) === "commentary") break;
          let delta = p.delta as string;
          if (lastItem && itemId !== lastItem) delta = "\n" + delta;
          lastItem = itemId;
          answer.push(delta);
          opts.onText?.(delta);
          break;
        }
        case "thread/tokenUsage/updated":
          usage = p.tokenUsage as TokenUsage;
          break;
        case "error": {
          const err = p.error as { message?: string; additionalDetails?: string | null };
          if (!p.willRetry) finalError = err.additionalDetails || err.message;
          break;
        }
        case "turn/completed": {
          const turn = p.turn as { id: string; status: string; error: { message: string; codexErrorInfo?: unknown } | null };
          if (turnId && turn.id !== turnId) break;
          const meta = usage ? usageMeta(usage) : undefined;
          if (turn.status === "completed") finish({ status: "ok", meta });
          else if (turn.status === "interrupted") finish({ status: interruptAsked ? "aborted" : "error", message: "turn interrupted", meta });
          else finish({ status: "error", message: explain(turn.error) ?? finalError ?? `turn ${turn.status}`, meta });
          break;
        }
      }
    });
    const offExit = server.onExit((e) => finish({ status: "error", message: e.message }));
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    server
      .call<{ turn: { id: string } }>("turn/start", {
        threadId,
        input: [{ type: "text", text, text_elements: [] }],
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.effort ? { effort: opts.effort } : {}),
        ...(opts.outputSchema ? { outputSchema: opts.outputSchema } : {}),
      })
      .then((r) => {
        turnId = r.turn.id;
        if (interruptAsked) interrupt();
      })
      .catch((e: Error) => finish({ status: "error", message: e.message }));
  });
}

interface TokenBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
}
interface TokenUsage {
  last: TokenBreakdown;
  modelContextWindow: number | null;
}

/**
 * Codex counts cached tokens inside inputTokens; the usage meter wants them
 * apart, the way the Claude CLI reports them. No dollar figure: on a ChatGPT
 * plan there is none to report.
 */
function usageMeta(u: TokenUsage): Record<string, unknown> {
  const l = u.last;
  return {
    usage: {
      input_tokens: Math.max(0, l.inputTokens - l.cachedInputTokens - l.cacheWriteInputTokens),
      cache_read_input_tokens: l.cachedInputTokens,
      cache_creation_input_tokens: l.cacheWriteInputTokens,
      output_tokens: l.outputTokens,
    },
    ...(u.modelContextWindow ? { context_window: u.modelContextWindow } : {}),
  };
}

function explain(err: { message: string; codexErrorInfo?: unknown } | null): string | undefined {
  if (!err) return undefined;
  switch (err.codexErrorInfo) {
    case "unauthorized":
      return "Codex is not signed in, or the login expired. Run `codex login` in a terminal.";
    case "usageLimitExceeded":
      return "The ChatGPT plan's usage limit is reached for now. " + err.message;
    case "contextWindowExceeded":
      return "This lesson has outgrown the model's context window. " + err.message;
  }
  return err.message;
}

/** One empty directory for every Codex run, under the data dir, created on first use. */
function brainDir(): string {
  const dir = join(dataDir(), "brain-codex");
  mkdirSync(dir, { recursive: true });
  return dir;
}
