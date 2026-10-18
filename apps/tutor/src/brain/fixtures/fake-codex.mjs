#!/usr/bin/env node
/* global process, setInterval, clearInterval */
// Stands in for `codex app-server` in tests. Speaks just enough of the
// protocol, logs every request it gets to $FAKE_CODEX_LOG, and behaves per
// $FAKE_CODEX_MODE: "ok" (default), "signed-out", "ask" (asks the client a
// question mid-turn), "slow" (streams until interrupted).
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const mode = process.env.FAKE_CODEX_MODE ?? "ok";
const logFile = process.env.FAKE_CODEX_LOG;
const threadsFile = process.env.FAKE_CODEX_THREADS; // threads that "exist on disk" across processes
const known = () => (threadsFile && existsSync(threadsFile) ? JSON.parse(readFileSync(threadsFile, "utf8")) : []);
const out = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const note = (method, params) => out({ method, params });
let n = 0;
const active = new Map(); // turnId -> timer

let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});

function handle(m) {
  if (logFile) appendFileSync(logFile, JSON.stringify(m) + "\n");
  if (m.method === undefined) return; // a response to our own request
  const reply = (result) => out({ id: m.id, result });
  const fail = (message) => out({ id: m.id, error: { code: -32600, message } });
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize":
      return reply({ userAgent: "fake" });
    case "initialized":
      return;
    case "account/read":
      return reply(mode === "signed-out" ? { account: null, requiresOpenaiAuth: true } : { account: { type: "chatgpt" }, requiresOpenaiAuth: true });
    case "thread/start": {
      const id = `thread-${process.pid}-${++n}`;
      if (threadsFile) writeFileSync(threadsFile, JSON.stringify([...known(), id]));
      return reply({ thread: { id } });
    }
    case "thread/resume":
      return known().includes(p.threadId) ? reply({ thread: { id: p.threadId } }) : fail(`no rollout found for thread id ${p.threadId}`);
    case "turn/start":
      return startTurn(m.id, p);
    case "turn/interrupt": {
      const t = active.get(p.turnId);
      if (t) {
        clearInterval(t);
        active.delete(p.turnId);
        note("turn/completed", { threadId: p.threadId, turn: { id: p.turnId, status: "interrupted", error: null } });
      }
      return reply({});
    }
    default:
      return fail(`unknown method ${m.method}`);
  }
}

function startTurn(id, p) {
  const threadId = p.threadId;
  const turnId = `turn-${++n}`;
  out({ id, result: { turn: { id: turnId, status: "inProgress" } } });
  if (mode === "ask") out({ id: "srv-1", method: "item/tool/requestUserInput", params: { threadId, turnId, itemId: "q", questions: [], isBlocking: true } });
  note("item/started", { threadId, turnId, item: { type: "agentMessage", id: "c1", phase: "commentary" } });
  note("item/agentMessage/delta", { threadId, turnId, itemId: "c1", delta: "Let me think. " });
  note("item/started", { threadId, turnId, item: { type: "agentMessage", id: "a1", phase: null } });
  if (mode === "slow") {
    active.set(turnId, setInterval(() => note("item/agentMessage/delta", { threadId, turnId, itemId: "a1", delta: "more " }), 20));
    return;
  }
  for (const delta of ["@say Hello ", "there.\n"]) note("item/agentMessage/delta", { threadId, turnId, itemId: "a1", delta });
  note("thread/tokenUsage/updated", {
    threadId,
    turnId,
    tokenUsage: { last: { inputTokens: 1200, cachedInputTokens: 1000, cacheWriteInputTokens: 0, outputTokens: 7 }, modelContextWindow: 400000 },
  });
  note("turn/completed", { threadId, turn: { id: turnId, status: "completed", error: null } });
}
