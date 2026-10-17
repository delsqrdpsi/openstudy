import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Brain, TurnInput, TurnResult } from "./types";
import { log } from "../log";

/**
 * Drives the `claude` CLI in headless mode. One process per turn, resumed by
 * session id, so the conversation and its prompt cache carry over and an
 * interrupt is just killing the current process. Bills to the Claude plan the
 * CLI is logged in with. Runs in an empty directory with no tools so no repo
 * context or CLAUDE.md gets pulled in.
 */
export class ClaudeCodeBrain implements Brain {
  readonly name = "claude-code";
  private sessionId: string | null = null;
  private child: ChildProcess | null = null;
  private readonly cwd: string;

  constructor(readonly model: string, private readonly bin = process.env.CLAUDE_BIN ?? "claude") {
    this.cwd = mkdtempSync(join(tmpdir(), "openstudy-brain-"));
  }

  async turn({ system, userText, signal, onText }: TurnInput): Promise<TurnResult> {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--strict-mcp-config",
      "--tools", "",
      "--model", this.model,
      "--system-prompt", system,
    ];
    // Own session: first turn fixes the id, later turns resume it.
    if (this.sessionId) args.push("--resume", this.sessionId);
    else {
      this.sessionId = randomUUID();
      args.push("--session-id", this.sessionId);
    }
    args.push(userText);

    // Never let the child attach to a surrounding Claude Code session.
    const env = { ...process.env };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDE_CODE_CHILD_SESSION;
    delete env.CLAUDECODE;

    return new Promise<TurnResult>((resolve) => {
      const child = spawn(this.bin, args, { cwd: this.cwd, stdio: ["ignore", "pipe", "pipe"], env });
      this.child = child;
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
              onText(ev.delta.text);
            }
          } else if (msg.type === "result") {
            const r = msg as { is_error?: boolean; result?: string; total_cost_usd?: number; usage?: unknown };
            if (r.is_error) result = { status: "error", message: String(r.result ?? "unknown error") };
            else result = { status: "ok", meta: { cost_usd: r.total_cost_usd, usage: r.usage } };
          }
        }
      });
      child.stderr!.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", (e) => resolve({ status: "error", message: e.message }));
      child.on("close", (code) => {
        signal.removeEventListener("abort", onAbort);
        this.child = null;
        if (result) return resolve(result);
        if (sawText && code === 0) return resolve({ status: "ok" });
        log.warn("claude exited", code, stderr.slice(0, 500));
        resolve({ status: "error", message: stderr.trim().split("\n").at(-1) || `claude exited with code ${code}` });
      });
    });
  }

  close() {
    this.child?.kill("SIGTERM");
  }
}
