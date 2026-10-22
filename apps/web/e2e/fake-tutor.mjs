// Fake tutor for the web client's live-session tests. Boards persist to a JSON file so the
// process can be killed and restarted (a server restart) without losing the lesson.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// ws comes from the tutor package (the web app does not depend on it).
import { WebSocketServer } from "../../tutor/node_modules/ws/wrapper.mjs";

const PORT = Number(process.env.PORT || 9311);
const DIR = process.env.FAKE_TUTOR_DIR || os.tmpdir();
const STATE = path.join(DIR, "fake-state.json");
const LOG = path.join(DIR, "fake-recv.jsonl");
const boards = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(boards));
let conns = 0;
const owners = new Map(); // board id -> ws

const srv = http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/conns") return res.end(String(conns));
  if (url.pathname === "/voice") return res.end(JSON.stringify({ provider: "browser" }));
  if (url.pathname === "/offer") {
    for (const ws of wss.clients) ws.send(JSON.stringify({ type: "offer", id: url.searchParams.get("id") || "o1", kind: "build_figure", concept: "A <b>pendulum</b> you can swing", detail: "Takes up to an hour." }));
    return res.end("ok");
  }
  res.end("[]");
});
const wss = new WebSocketServer({ server: srv, path: "/ws" });

wss.on("connection", (ws) => {
  conns++;
  let board = null;
  let timers = [];
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const emit = (e) => {
    boards[board].log.push({ kind: "event", event: e });
    save();
    send({ type: "event", event: e });
  };
  const own = (id) => {
    const prev = owners.get(id);
    if (prev && prev !== ws && prev.readyState === 1) prev.send(JSON.stringify({ type: "error", message: "open elsewhere", code: "superseded" }));
    owners.set(id, ws);
  };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    fs.appendFileSync(LOG, JSON.stringify({ port: PORT, conn: conns, ...m, materials: undefined }) + "\n");
    if (m.type === "start") {
      const id = m.resume || m.id;
      if (id && boards[id]) {
        board = id;
        own(id);
        send({ type: "session", id, brain: "fake", model: "sonnet", title: boards[id].title });
        send({ type: "history", log: boards[id].log });
        send({ type: "turn", state: "waiting" });
        return;
      }
      if (m.resume) return send({ type: "error", message: "that board no longer exists" });
      if (m.topic.includes("slow")) return; // never answers: lets a test reload before the session arrives
      board = m.id || "srv" + Date.now();
      boards[board] = { title: "Fake: " + m.topic, log: [] };
      own(board);
      send({ type: "session", id: board, brain: "fake", model: "sonnet", title: boards[board].title });
      send({ type: "turn", state: "thinking" });
      emit({ type: "say", text: "Hello there." });
      emit({ type: "block.add", block: { id: "intro", type: "html", column: 0, html: "<p>Intro</p>" } });
      emit({ type: "say", text: "Second line." });
      send({ type: "turn", state: "waiting" });
    } else if (m.type === "user") {
      boards[board].log.push({ kind: "user", text: m.text });
      save();
      send({ type: "turn", state: "thinking" });
      if (m.text === "look") {
        // A @wait turn: one line and a block, then the tutor holds for the student.
        emit({ type: "say", text: "Take a look at this." });
        emit({ type: "block.add", block: { id: "look1", type: "html", column: 0, html: "<p>Look block</p>" } });
        send({ type: "turn", state: "waiting", wait: true });
        return;
      }
      for (let i = 1; i <= 6; i++) {
        emit({ type: "say", text: `Point ${i} is here and it is long enough to take a little while to say out loud.` });
        emit({ type: "block.add", block: { id: `b${i}`, type: "html", column: 0, html: `<p>Block ${i}</p>` } });
      }
      send({ type: "turn", state: "waiting" });
    } else if (m.type === "continue") {
      send({ type: "turn", state: "thinking" });
      emit({ type: "say", text: "Going on." });
      send({ type: "turn", state: "waiting" });
    } else if (m.type === "interrupt") {
      // Events already in flight when the interrupt lands, then the guaranteed answer.
      send({ type: "event", event: { type: "say", text: "LEAKED LINE after stop." } });
      send({ type: "event", event: { type: "block.add", block: { id: "leak", type: "html", column: 0, html: "<p>LEAKED BLOCK</p>" } } });
      timers.push(
        setTimeout(() => {
          for (let i = (m.heard ?? 0) + 1; i <= 6; i++) send({ type: "event", event: { type: "block.remove", id: `b${i}` } });
          send({ type: "turn", state: "waiting" });
        }, 150),
      );
    }
  });
  ws.on("close", () => timers.forEach(clearTimeout));
});
srv.listen(PORT, () => console.log("fake tutor on", PORT));
