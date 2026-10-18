import { spawn, type ChildProcess } from "node:child_process";
import { log } from "../log";

/**
 * A connection to `codex app-server`: newline-delimited JSON-RPC over stdio
 * (no "jsonrpc" field on the wire). One process per connection; the caller
 * owns its lifetime.
 *
 * The server can also send requests (approvals, request_user_input). The
 * tutor has nothing to approve and no one to ask mid-turn, so those get a
 * refusal straight away; leaving one unanswered would hang the turn.
 */
export class CodexAppServer {
  private child: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  private exitListeners = new Set<(e: Error) => void>();
  private stderr = "";
  private exited: Error | null = null;
  private ready: Promise<void>;

  constructor(opts: { bin?: string; cwd: string; args?: string[] }) {
    this.child = spawn(opts.bin ?? process.env.CODEX_BIN ?? "codex", ["app-server", ...(opts.args ?? [])], {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    this.child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) this.onLine(line);
      }
    });
    this.child.stderr!.on("data", (d: Buffer) => {
      // Keep only the tail: it is read for the reason when the process dies.
      this.stderr = (this.stderr + d.toString("utf8")).slice(-4000);
    });
    const fail = (e: Error) => {
      if (this.exited) return;
      this.exited = e;
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
      for (const fn of this.exitListeners) fn(e);
    };
    this.child.on("error", fail);
    this.child.on("close", (code) => fail(new Error(lastLine(this.stderr) || `codex app-server exited with code ${code}`)));
    this.ready = this.request("initialize", {
      clientInfo: { name: "openstudy", title: "OpenStudy", version: "0.1.0" },
      capabilities: { experimentalApi: false, requestAttestation: false, optOutNotificationMethods: QUIET },
    }).then(() => this.notify("initialized"));
  }

  /** Resolves once the handshake is done; rejects if the binary is missing or dies first. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  async call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.ready;
    return this.request(method, params) as Promise<T>;
  }

  /** Subscribe to server notifications. Returns the unsubscribe function. */
  on(fn: (method: string, params: Record<string, unknown>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get alive(): boolean {
    return this.exited === null;
  }

  /** Called once if the process dies or fails to start. Returns the unsubscribe function. */
  onExit(fn: (e: Error) => void): () => void {
    if (this.exited) {
      fn(this.exited);
      return () => {};
    }
    this.exitListeners.add(fn);
    return () => this.exitListeners.delete(fn);
  }

  close() {
    if (!this.exited) this.child.kill("SIGTERM");
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.exited) return Promise.reject(this.exited);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private notify(method: string) {
    this.write({ method });
  }

  private write(msg: Record<string, unknown>) {
    this.child.stdin!.write(JSON.stringify(msg) + "\n");
  }

  private onLine(line: string) {
    let msg: { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.method && msg.id !== undefined) return this.answerServerRequest(msg.id, msg.method);
    if (msg.method) {
      for (const fn of this.listeners) fn(msg.method, msg.params ?? {});
      return;
    }
    if (typeof msg.id !== "number") return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "codex app-server error"));
    else p.resolve(msg.result);
  }

  private answerServerRequest(id: number | string, method: string) {
    log.warn("codex asked", method, "- declining (the tutor runs without tools)");
    if (method === "item/tool/requestUserInput") return this.write({ id, result: { answers: {} } });
    if (method.endsWith("requestApproval")) return this.write({ id, result: { decision: "decline" } });
    this.write({ id, error: { code: -32601, message: "not supported by this client" } });
  }
}

/** Notifications the tutor never reads; suppressed to keep the pipe quiet. */
const QUIET = [
  "thread/started",
  "thread/status/changed",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "remoteControl/status/changed",
  "mcpServer/startupStatus/updated",
];

/**
 * Config for every tutor thread: no shell, no web, no pictures of its own,
 * no file access beyond reading, no environment block about the machine.
 * Newer models still get Codex's code-mode `exec` and sub-agent tools from
 * their model metadata; with the above off there is nothing useful behind
 * them, and the system prompt tells the model to just talk.
 */
export const TUTOR_THREAD_CONFIG: Record<string, unknown> = {
  web_search: "disabled",
  include_environment_context: false,
  "features.shell_tool": false,
  "features.unified_exec": false,
  "features.image_generation": false,
  "features.view_image": false,
  "features.browser_use": false,
  "features.in_app_browser": false,
  "features.computer_use": false,
  "features.apps": false,
  "features.plugins": false,
  "features.multi_agent": false,
  "features.goals": false,
  "features.sleep_tool": false,
  "features.skill_search": false,
  "features.tool_suggest": false,
};

const lastLine = (s: string) =>
  s
    .split(String.fromCharCode(27)) // ANSI colour codes from Codex's logger
    .map((part) => part.replace(/^\[[0-9;]*m/, ""))
    .join("")
    .trim()
    .split("\n")
    .filter((l) => !/bubblewrap|PATH aliases/.test(l))
    .at(-1) ?? "";
