#!/usr/bin/env node
// A stand-in for the `claude` CLI, for session tests. It reads the prompt on
// stdin (as the real brain sends it), streams FAKE_BODY as stream-json text
// deltas, keeps "sessions" in FAKE_DIR so --resume can fail like the real one,
// and reports a running cost per session the way the CLI does.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const dir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prompt = await new Promise((resolve) => {
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => resolve(s));
});
const system = args.includes("--system-prompt-file") ? readFileSync(args[args.indexOf("--system-prompt-file") + 1], "utf8") : "";
const log = (o) => appendFileSync(`${dir}/calls.jsonl`, JSON.stringify(o) + "\n");

if (args.includes("--json-schema")) {
  log({ kind: "plan", prompt, argv: args });
  await sleep(Number(process.env.FAKE_PLAN_MS ?? 0));
  if (process.env.FAKE_PLAN_FAIL) {
    console.error("planner failed on purpose");
    process.exit(1);
  }
  const plan = {
    title: "Fake plan",
    student: "a student",
    sections: [1, 2].map((i) => ({ id: `s${i}`, title: `Section ${i}`, goal: "g", keyPoints: ["k"], example: "e", checkQuestion: "q", misconceptions: [], images: [] })),
  };
  console.log(JSON.stringify({ structured_output: plan, total_cost_usd: 0.5 }));
  process.exit(0);
}

const sessFile = `${dir}/sessions.json`;
const sessions = existsSync(sessFile) ? JSON.parse(readFileSync(sessFile, "utf8")) : {};
const ri = args.indexOf("--resume");
const si = args.indexOf("--session-id");
const id = ri !== -1 ? args[ri + 1] : args[si + 1];
log({ kind: "turn", resume: ri !== -1, session: id, prompt, argv: args, hasSystem: system.length > 0 });
if (ri !== -1 && !(id in sessions)) {
  console.error(`No conversation found with session ID: ${id}`);
  process.exit(1);
}
await sleep(Number(process.env.FAKE_FIRST_MS ?? 0));
const body = process.env.FAKE_BODY ?? "@say one\n@html id=b1 col=0\nfirst\n@end\n@say two\n@html id=b2 col=0\nsecond\n@end\n@ask\n";
let first = true;
for (const line of body.split(/(?<=\n)/)) {
  if (first) {
    // The real CLI has written the session by the time text streams.
    sessions[id] = sessions[id] ?? 0;
    writeFileSync(sessFile, JSON.stringify(sessions));
    first = false;
  }
  console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: line } } }));
  await sleep(Number(process.env.FAKE_LINE_MS ?? 0));
}
sessions[id] = (sessions[id] ?? 0) + 0.01;
writeFileSync(sessFile, JSON.stringify(sessions));
console.log(JSON.stringify({ type: "result", total_cost_usd: sessions[id], usage: { input_tokens: 10, output_tokens: 5 } }));
