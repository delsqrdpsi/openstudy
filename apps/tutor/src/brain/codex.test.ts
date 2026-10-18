import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexBrain } from "./codex";

const FAKE = join(import.meta.dirname, "fixtures", "fake-codex.mjs");

let dir: string;
let brain: CodexBrain | null = null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openstudy-codex-test-"));
  process.env.DATA_DIR = dir;
  process.env.FAKE_CODEX_LOG = join(dir, "log.jsonl");
  process.env.FAKE_CODEX_THREADS = join(dir, "threads.json");
  process.env.FAKE_CODEX_MODE = "ok";
});
afterEach(() => brain?.close());

/** Every request the fake server received, in order. */
const requests = () =>
  readFileSync(process.env.FAKE_CODEX_LOG!, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown });

async function turn(b: CodexBrain, system = "SYSTEM", signal = new AbortController().signal) {
  let text = "";
  const result = await b.turn({ system, userText: "hi", signal, onText: (t) => (text += t) });
  return { result, text };
}

describe("CodexBrain", () => {
  it("streams the answer, leaves commentary off the board, and reports usage", async () => {
    brain = new CodexBrain("gpt-test", null, FAKE);
    const { result, text } = await turn(brain);
    expect(text).toBe("@say Hello there.\n");
    expect(result.status).toBe("ok");
    expect(result.meta).toEqual({
      usage: { input_tokens: 200, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 7 },
      context_window: 400000,
    });
    expect(brain.session).toMatch(/^thread-/);
    const start = requests().find((r) => r.method === "thread/start")!;
    expect(start.params).toMatchObject({ model: "gpt-test", sandbox: "read-only", approvalPolicy: "never", baseInstructions: "SYSTEM" });
  });

  it("continues the same thread on the next turn without restarting", async () => {
    brain = new CodexBrain("gpt-test", null, FAKE);
    await turn(brain);
    const first = brain.session;
    await turn(brain);
    expect(brain.session).toBe(first);
    const methods = requests().map((r) => r.method);
    expect(methods.filter((m) => m === "initialize")).toHaveLength(1);
    expect(methods.filter((m) => m === "turn/start")).toHaveLength(2);
  });

  it("restarts and resumes with the new instructions when the system prompt changes", async () => {
    brain = new CodexBrain("gpt-test", null, FAKE);
    await turn(brain, "SYSTEM ONE");
    const thread = brain.session;
    await turn(brain, "SYSTEM TWO");
    const resume = requests().find((r) => r.method === "thread/resume")!;
    expect(resume.params).toMatchObject({ threadId: thread, baseInstructions: "SYSTEM TWO" });
    expect(requests().filter((r) => r.method === "initialize")).toHaveLength(2);
  });

  it("resumes a saved thread in a new process", async () => {
    brain = new CodexBrain("gpt-test", null, FAKE);
    await turn(brain);
    const saved = brain.session;
    brain.close();
    brain = new CodexBrain("gpt-other", saved, FAKE);
    const { result } = await turn(brain);
    expect(result.status).toBe("ok");
    expect(requests().find((r) => r.method === "thread/resume")?.params).toMatchObject({ threadId: saved, model: "gpt-other" });
  });

  it("reports a thread that no longer exists as a lost session", async () => {
    brain = new CodexBrain("gpt-test", "a-claude-session-id", FAKE);
    const { result } = await turn(brain);
    expect(result).toMatchObject({ status: "error", lostSession: true });
    brain.forget();
    expect((await turn(brain)).result.status).toBe("ok");
  });

  it("interrupts a running turn", async () => {
    process.env.FAKE_CODEX_MODE = "slow";
    brain = new CodexBrain("gpt-test", null, FAKE);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const { result, text } = await turn(brain, "SYSTEM", ac.signal);
    expect(result.status).toBe("aborted");
    expect(text).toContain("more");
    expect(requests().some((r) => r.method === "turn/interrupt")).toBe(true);
  });

  it("fails fast with a clear message when Codex is not signed in", async () => {
    process.env.FAKE_CODEX_MODE = "signed-out";
    brain = new CodexBrain("gpt-test", null, FAKE);
    const { result } = await turn(brain);
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/codex login/);
    expect(requests().some((r) => r.method === "turn/start")).toBe(false);
  });

  it("answers a question from the server instead of hanging", async () => {
    process.env.FAKE_CODEX_MODE = "ask";
    brain = new CodexBrain("gpt-test", null, FAKE);
    const { result } = await turn(brain);
    expect(result.status).toBe("ok");
    expect(requests().find((r) => r.id === "srv-1")?.result).toEqual({ answers: {} });
  });

  it("says how to install the CLI when it is missing", async () => {
    brain = new CodexBrain("gpt-test", null, join(dir, "no-such-codex"));
    const { result } = await turn(brain);
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/npm i -g @openai\/codex/);
  });
});
