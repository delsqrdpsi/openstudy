import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../paths";
import type { Brain, TurnInput, TurnResult } from "./types";
import { log } from "../log";

/**
 * Drives the `claude` CLI in headless mode. One process per turn, resumed by
 * session id, so the conversation and its prompt cache carry over and an
 * interrupt is just killing the current process. Bills to the Claude plan the
 * CLI is logged in with. Runs in an empty directory with no tools so no repo
 * context or CLAUDE.md gets pulled in.
 *
 * The directory is the same for every lesson: the CLI files sessions under
 * the directory they were started in, so a saved board can only be resumed
 * from the directory its session was created in.
 */
export class ClaudeCodeBrain implements Brain {
  readonly name = "claude-code";
  /** A CLI session known to exist on disk: only set once a turn on it produced output. */
  private sessionId: string | null;
  private child: ChildProcess | null = null;
  private readonly cwd: string;

  constructor(readonly model: string, sessionId: string | null = null, private readonly bin = process.env.CLAUDE_BIN ?? "claude") {
    this.sessionId = sessionId;
    this.cwd = brainDir();
  }

  forget() {
    this.sessionId = null;
  }

  /** The CLI session this brain resumes. Saved with the board so a lesson can continue later. */
  get session(): string | null {
    return this.sessionId;
  }

  async turn({ system, userText, signal, onText }: TurnInput): Promise<TurnResult> {
    // The system prompt goes in a file and the student's words on stdin, never
    // on the command line: argv has a size limit, and text starting with "--"
    // would be read as a CLI option.
    const systemFile = join(this.cwd, `system-${process.pid}-${randomUUID()}.md`);
    writeFileSync(systemFile, system);
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--strict-mcp-config",
      "--tools", "",
      "--model", this.model,
      "--system-prompt-file", systemFile,
    ];
    // Own session: a new conversation gets a fresh id, later turns resume it.
    // The id is only kept once the CLI has written something on it, so a turn
    // killed in its first second does not leave an id that cannot be resumed.
    const resuming = this.sessionId;
    const sessionId = resuming ?? randomUUID();
    if (resuming) args.push("--resume", resuming);
    else args.push("--session-id", sessionId);

    // Never let the child attach to a surrounding Claude Code session.
    const env = { ...process.env };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDE_CODE_CHILD_SESSION;
    delete env.CLAUDECODE;

    return new Promise<TurnResult>((done) => {
      const resolve = (r: TurnResult) => {
        rmQuiet(systemFile);
        done(r);
      };
      if (signal.aborted) return resolve({ status: "aborted" });
      let child: ChildProcess;
      try {
        child = spawn(this.bin, args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"], env });
      } catch (e) {
        // spawn throws synchronously for some failures (E2BIG, EACCES); the turn must still end.
        return resolve({ status: "error", message: `could not start claude: ${e instanceof Error ? e.message : e}` });
      }
      this.child = child;
      child.stdin!.on("error", () => {}); // the CLI may exit before reading all of it
      child.stdin!.end(userText);
      const commit = () => {
        if (!this.sessionId) this.sessionId = sessionId;
      };
      let buf = "";
      let stderr = "";
      let sawText = false;
      let result: TurnResult | null = null;
      const onAbort = () => {
        result = { status: "aborted" };
        child.kill("SIGTERM");
      };
      signal.addEventListener("abort", onAbort, { once: true });

      child.stdout!.on("data", (d: Buffer) => {
        buf += d.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type === "stream_event") {
            const ev = msg.event as { type: string; delta?: { type: string; text?: string } };
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
              sawText = true;
              commit();
              onText(ev.delta.text);
            }
          } else if (msg.type === "result") {
            const r = msg as { is_error?: boolean; result?: string; total_cost_usd?: number; usage?: unknown };
            commit();
            // An error result often carries no text; the reason is on stderr, read at close.
            if (r.is_error) result = { status: "error", message: r.result ? String(r.result) : undefined };
            else result = { status: "ok", meta: { cost_usd: r.total_cost_usd, usage: r.usage, session: sessionId } };
          }
        }
      });
      child.stderr!.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", (e) => resolve({ status: "error", message: e.message }));
      child.on("close", (code) => {
        signal.removeEventListener("abort", onAbort);
        this.child = null;
        if (result?.status === "ok" || result?.status === "aborted") return resolve(result);
        if (!result && sawText && code === 0) return resolve({ status: "ok" });
        const message = result?.message || stderr.trim().split("\n").at(-1) || `claude exited with code ${code}`;
        log.warn("claude turn failed:", message);
        const lost = !!resuming && /no conversation found|session .*not found|could not find session/i.test(message);
        if (lost && this.sessionId === resuming) this.sessionId = null;
        resolve({ status: "error", message, lostSession: lost });
      });
    });
  }

  close() {
    this.child?.kill("SIGTERM");
  }
}

function rmQuiet(file: string) {
  try {
    rmSync(file, { force: true });
  } catch {
    // a leftover prompt file is harmless
  }
}

/** One empty directory for every CLI run, under the data dir, created on first use. */
function brainDir(): string {
  const dir = join(dataDir(), "brain");
  mkdirSync(dir, { recursive: true });
  return dir;
}
