/**
 * Session behaviour against a fake `claude` CLI (test/fake-claude.mjs): turn
 * order, interrupts, the plan hand-off, recovery of a lost brain session, and
 * what a closed or superseded session may still do.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerMessage } from "@openstudy/shared";

const dir = mkdtempSync(join(tmpdir(), "openstudy-session-test-"));
process.env.DATA_DIR = join(dir, "data");
process.env.FAKE_DIR = dir;
process.env.CLAUDE_BIN = resolve(__dirname, "../test/fake-claude.mjs");
process.env.PLAN_WAIT_MS = "300";

type Mods = { Session: typeof import("./session").Session; Store: typeof import("./store").Store; ClaudeCodeBrain: typeof import("./brain/claudeCode").ClaudeCodeBrain };
let m: Mods;

beforeAll(async () => {
  // Imported after the environment is set: the modules read DATA_DIR and PLAN_WAIT_MS when they load.
  m = { Session: (await import("./session")).Session, Store: (await import("./store")).Store, ClaudeCodeBrain: (await import("./brain/claudeCode")).ClaudeCodeBrain };
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  rmSync(join(dir, "calls.jsonl"), { force: true });
  rmSync(join(dir, "sessions.json"), { force: true });
  for (const k of ["FAKE_BODY", "FAKE_LINE_MS", "FAKE_FIRST_MS", "FAKE_PLAN_MS", "FAKE_PLAN_FAIL"]) delete process.env[k];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function make(opts: { id?: string; store?: InstanceType<Mods["Store"]>; session?: string | null } = {}) {
  const msgs: ServerMessage[] = [];
  const store = opts.store ?? new m.Store(":memory:");
  const s = new m.Session(new m.ClaudeCodeBrain("sonnet", opts.session ?? null), null, store, (msg) => msgs.push(msg), opts.id);
  return { s, msgs, store };
}

interface Call {
  kind: "turn" | "plan";
  resume?: boolean;
  session?: string;
  prompt: string;
  argv: string[];
}
const calls = (): Call[] =>
  existsSync(join(dir, "calls.jsonl"))
    ? readFileSync(join(dir, "calls.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Call)
    : [];
const turns = () => calls().filter((c) => c.kind === "turn");
const errors = (msgs: ServerMessage[]) => msgs.filter((x) => x.type === "error");

/** Start a lesson and get past the intake, so the plan is delivered. */
async function teaching() {
  const t = make();
  await t.s.start("how rainbows form", []);
  await t.s.user("I know a little about light");
  return t;
}

describe("session", () => {
  it("passes student text that looks like a CLI option to the model as text, never as an argument", async () => {
    const { s } = await teaching();
    await s.user('--settings={"hooks":{}}');
    const last = turns().at(-1)!;
    expect(last.prompt).toContain('--settings={"hooks":{}}');
    expect(last.argv.join(" ")).not.toContain("--settings");
  });

  it("runs a turn whose prompt is far over the command-line size limit", async () => {
    const { s, msgs } = await teaching();
    await s.user("word ".repeat(40_000));
    expect(errors(msgs)).toEqual([]);
    expect(turns().at(-1)!.prompt.length).toBeGreaterThan(131_072);
    expect(s.state).toBe("waiting");
  });

  it("keeps the intake prompt bounded however much material is attached", async () => {
    const { s } = make();
    const notes = Array.from({ length: 12 }, (_, i) => ({ name: `notes-${i}.txt`, text: "word ".repeat(10_000) }));
    await s.start("a long reading", notes);
    expect(turns()[0].prompt.length).toBeLessThan(110_000);
  });

  it("recovers a lost brain session in a fresh one seeded with the saved lesson", async () => {
    const { s, msgs, store } = await teaching();
    const before = store.getBoard(s.id)!.brainSessionId;
    rmSync(join(dir, "sessions.json")); // the CLI's conversation is gone
    await s.user("what next?");
    const t = turns();
    const failed = t.at(-2)!;
    const fresh = t.at(-1)!;
    expect(failed.resume).toBe(true);
    expect(fresh.resume).toBe(false);
    expect(fresh.prompt).toContain("Transcript so far");
    expect(fresh.prompt).toContain("Board now");
    expect(fresh.prompt).toContain("what next?");
    expect(errors(msgs)).toEqual([]);
    expect(store.getBoard(s.id)!.brainSessionId).not.toBe(before);
  });

  it("seeds a fresh brain when a resumed board has no usable session id", async () => {
    const a = await teaching();
    a.s.close();
    rmSync(join(dir, "sessions.json"));
    const b = make({ id: a.s.id, store: a.store, session: a.store.getBoard(a.s.id)!.brainSessionId });
    await b.s.resume({ quiet: true });
    await b.s.user("carry on");
    expect(turns().at(-1)!.prompt).toContain("Transcript so far");
    expect(errors(b.msgs)).toEqual([]);
  });

  it("answers an interrupt after the model finished writing: unseen blocks go, then exactly one turn message", async () => {
    const { s, msgs } = await teaching();
    process.env.FAKE_BODY = "@say three\n@html id=b3 col=0\nthird\n@end\n@say four\n@html id=b4 col=0\nfourth\n@end\n@continue\n";
    await s.user("go on");
    expect(s.board.blocks.map((b) => b.id)).toEqual(expect.arrayContaining(["b1", "b2", "b3", "b4"]));
    const mark = msgs.length;
    s.interrupt(1); // heard "three" only
    const after = msgs.slice(mark);
    expect(after).toEqual([{ type: "event", event: { type: "block.remove", id: "b4" } }, { type: "turn", state: "waiting" }]);
    expect(s.board.blocks.map((b) => b.id)).toEqual(expect.arrayContaining(["b1", "b2", "b3"]));
    expect(s.board.blocks.map((b) => b.id)).not.toContain("b4");
    // An interrupted @continue turn must not carry on by itself.
    await s.continue();
    expect(turns().at(-1)!.prompt).toContain("go on");
  });

  it("gives a re-sent block its earlier version back instead of deleting it", async () => {
    process.env.FAKE_BODY = "@say a\n@html id=plan col=0\nv1\n@end\n@ask\n";
    const { s } = make();
    await s.start("topic", []);
    process.env.FAKE_BODY = "@say b\n@say c\n@html id=plan col=0\nv2\n@end\n@ask\n";
    await s.user("answer");
    expect(s.board.blocks.find((b) => b.id === "plan")).toMatchObject({ html: "v2\n" });
    s.interrupt(1);
    expect(s.board.blocks.find((b) => b.id === "plan")).toMatchObject({ html: "v1\n" });
  });

  it("holds a @wait turn for the student and goes on when they say so", async () => {
    const { s, msgs } = await teaching();
    process.env.FAKE_BODY = "@say Take a look.\n@html id=b3 col=0\nthird\n@end\n@wait\n";
    await s.user("go on");
    expect(msgs.at(-1)).toEqual({ type: "turn", state: "waiting", wait: true });
    process.env.FAKE_BODY = "@say Next.\n@continue\n";
    await s.continue();
    expect(turns().at(-1)!.prompt).toContain("looked at the board");
    expect(msgs.at(-1)).toEqual({ type: "turn", state: "waiting", auto: true });
    // A go-on with nothing pending starts nothing.
    process.env.FAKE_BODY = "@say Done.\n@ask\n";
    await s.continue();
    const n = turns().length;
    await s.continue();
    expect(turns().length).toBe(n);
  });

  it("keeps a slow-down request in every later turn until the student asks for normal speed", async () => {
    const { s } = await teaching();
    await s.user("slow down please");
    expect(turns().at(-1)!.prompt).toContain("asked you to slow down");
    expect(turns().at(-1)!.prompt).toContain("saying you will go slower");
    await s.user("what is a reward?");
    expect(turns().at(-1)!.prompt).toContain("asked you to slow down");
    expect(turns().at(-1)!.prompt).not.toContain("saying you will go slower");
    await s.user("ok normal speed now");
    expect(turns().at(-1)!.prompt).not.toContain("asked you to slow down");
  });

  it("takes a pace message from the client without stopping the turn that is playing", async () => {
    const { s, msgs } = await teaching();
    process.env.FAKE_LINE_MS = "60";
    process.env.FAKE_BODY = "@say three\n@html id=b3 col=0\nthird\n@end\n@say four\n@html id=b4 col=0\nfourth\n@end\n@continue\n";
    const running = s.user("go on");
    await sleep(100);
    s.setPace(true, "slow down");
    await running;
    expect(s.board.blocks.map((b) => b.id)).toEqual(expect.arrayContaining(["b3", "b4"]));
    expect(errors(msgs)).toEqual([]);
    await s.continue();
    expect(turns().at(-1)!.prompt).toContain("asked you to slow down");
  });

  it("tells the next turn about an interruption and answers what the student said over it", async () => {
    const { s } = await teaching();
    process.env.FAKE_LINE_MS = "60";
    const running = s.user("tell me more");
    await sleep(150);
    s.interrupt(1);
    await s.user("why?");
    await running;
    const last = turns().at(-1)!;
    expect(last.prompt).toContain("The student interrupted you");
    expect(last.prompt).toContain("why?");
  });

  it("hands a late plan over exactly once", async () => {
    process.env.FAKE_PLAN_MS = "1200";
    const { s } = make();
    await s.start("topic", []);
    await s.user("first answer"); // planner is late: provisional turn
    await sleep(1300);
    await s.user("second");
    await s.user("third");
    const prompts = turns().map((t) => t.prompt);
    expect(prompts.filter((p) => p.includes("planner is late"))).toHaveLength(1);
    expect(prompts.filter((p) => p.includes("Lesson plan from the planner"))).toHaveLength(1);
  });

  it("stops mentioning the planner when it failed", async () => {
    process.env.FAKE_PLAN_FAIL = "1";
    const { s } = make();
    await s.start("topic", []);
    await s.user("a");
    await s.user("b");
    await s.user("c");
    expect(turns().filter((t) => t.prompt.includes("planner is late"))).toHaveLength(1);
  });

  it("folds a message sent while waiting for the plan into the first teaching turn", async () => {
    process.env.FAKE_PLAN_MS = "1500";
    const { s } = make();
    await s.start("topic", []);
    const first = s.user("first part");
    await sleep(50);
    await s.user("second part");
    await first;
    const teach = turns().at(-1)!;
    expect(teach.prompt).toContain("first part");
    expect(teach.prompt).toContain("second part");
  });

  it("sends nothing after it is closed", async () => {
    process.env.FAKE_LINE_MS = "60";
    const { s, msgs } = make();
    const started = s.start("topic", []);
    await sleep(200);
    s.close();
    const mark = msgs.length;
    await started;
    await sleep(100);
    expect(msgs.length).toBe(mark);
  });

  it("tells an older tab it was superseded when the board is opened again", async () => {
    const a = await teaching();
    const b = make({ id: a.s.id, store: a.store, session: a.store.getBoard(a.s.id)!.brainSessionId });
    await b.s.resume({ quiet: true });
    expect(a.msgs.at(-1)).toMatchObject({ type: "error", code: "superseded" });
    expect(m.Session.live.get(a.s.id)).toBe(b.s);
    b.s.close();
  });

  it("counts the CLI's running cost once", async () => {
    const { s } = await teaching();
    await s.user("more");
    // Three turns on one session: the fake reports totals 0.01, 0.02, 0.03.
    expect(s.meter.usage.tutor.costUsd).toBeCloseTo(0.03, 6);
  });
});
