import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessageSchema, type ServerMessage } from "@openstudy/shared";
import { createBrain } from "./brain";
import { createImages, imageStore } from "./images";
import { Session } from "./session";
import { Store } from "./store";
import { listFigures, readFigureFile } from "./figures";
import { listSources, prepareSource, readSourceFile, scanFolder } from "./sources";
import { stopOcr } from "./sources/ocr";
import { listJobs } from "./figures/builder";
import { bridgeTranscription, SAMPLE_RATE, speak, voiceConfig, VoiceError } from "./voice/deepgram";
import { log } from "./log";
import { activeMeter } from "./usage";
import { checkRequest, corsHeaders } from "./guard";

const PORT = Number(process.env.TUTOR_PORT ?? 8787);
/**
 * Loopback only by default: the server can read local folders and spend your
 * plan and keys, so nothing on the network should reach it. Set TUTOR_HOST=0.0.0.0
 * (and WEB_ORIGINS) only on a network you trust, for example to use a tablet.
 */
const HOST = process.env.TUTOR_HOST ?? "127.0.0.1";

// One failed picture or model call must never take the server down with every lesson on it.
process.on("unhandledRejection", (err) => log.error("unhandled rejection:", err instanceof Error ? err.message : err));
process.on("uncaughtException", (err) => log.error("uncaught exception:", err.message));
const store = new Store();

/** CORS headers per response: only the web app's own origin is ever echoed back. */
const corsOf = new WeakMap<import("node:http").ServerResponse, Record<string, string>>();
const cors = (res: import("node:http").ServerResponse) => corsOf.get(res) ?? {};
const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", ...cors(res) });
  res.end(JSON.stringify(body));
};

/** Read a request body, refusing anything larger than `max` bytes. */
async function readBody(req: import("node:http").IncomingMessage, max: number): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Figure pages run in sandboxed frames, whose origin is "null"; they may only load their own files.
  const gate = checkRequest(req, { allowNullOrigin: req.method === "GET" && url.pathname.startsWith("/figures/") });
  if (!gate.ok) {
    log.warn(`refused ${req.method} ${url.pathname}: ${gate.reason}`);
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  corsOf.set(res, corsHeaders(gate.origin));
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors(res));
    res.end();
    return;
  }
  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, brain: process.env.BRAIN ?? "claude-code", images: process.env.IMAGES ?? (process.env.GEMINI_API_KEY ? "gemini" : "none"), voice: voiceConfig().provider });
  }
  if (url.pathname === "/voice" && req.method === "GET") return json(res, 200, voiceConfig());
  if (url.pathname === "/tts" && req.method === "POST") {
    void streamSpeech(req, res);
    return;
  }
  if (url.pathname === "/boards" && req.method === "GET") return json(res, 200, store.listBoards());
  if (url.pathname === "/figures" && req.method === "GET") return json(res, 200, { figures: listFigures(), jobs: listJobs() });
  if (url.pathname === "/sources" && req.method === "GET") return json(res, 200, { sources: listSources() });
  if (url.pathname === "/sources/scan" && req.method === "POST") {
    void (async () => {
      const body = await readBody(req, 64 * 1024);
      if (body === null) return json(res, 413, { error: "too long" });
      try {
        const { dir, files } = JSON.parse(body || "{}") as { dir?: string; files?: string[] };
        if (!dir) return json(res, 400, { error: "dir is required" });
        const found = scanFolder(dir);
        if (!files) return json(res, 200, { found });
        const chosen = found.filter((f) => files.includes(f.path));
        const prepared = [];
        for (const f of chosen) {
          try {
            prepared.push(await prepareSource(f.path));
          } catch (e) {
            prepared.push({ id: "", name: f.name, kind: f.kind, pages: 0, chars: 0, note: `could not read: ${e instanceof Error ? e.message : e}` });
          }
        }
        json(res, 200, { prepared });
      } catch (e) {
        json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return;
  }
  const srcMatch = /^\/sources\/([a-f0-9]{12})\/([\w.-]+)$/.exec(url.pathname);
  if (srcMatch && req.method === "GET") {
    const file = readSourceFile(srcMatch[1], srcMatch[2]);
    if (file) {
      res.writeHead(200, { "content-type": file.type, "cache-control": "public, max-age=3600", ...cors(res) });
      res.end(file.bytes);
      return;
    }
  }
  const figMatch = /^\/figures\/([a-z0-9][a-z0-9-]*)\/?(.*)$/.exec(url.pathname);
  if (figMatch && req.method === "GET") {
    const rest = decode(figMatch[2]);
    if (rest === null) return json(res, 400, { error: "bad path" });
    const file = readFigureFile(figMatch[1], rest);
    if (file) {
      // Pages are re-read each time (the board's size reporter is added on the way out); assets can be cached.
      const cache = file.type.startsWith("text/html") ? "no-cache" : "public, max-age=3600";
      res.writeHead(200, { "content-type": file.type, "cache-control": cache, ...cors(res) });
      res.end(file.bytes);
      return;
    }
  }
  const boardMatch = /^\/boards\/([\w-]+)$/.exec(url.pathname);
  if (boardMatch) {
    const id = boardMatch[1];
    if (req.method === "GET") {
      const board = store.getBoard(id);
      return board ? json(res, 200, { board: { id: board.id, title: board.title, topic: board.topic, model: board.model, createdAt: board.createdAt, updatedAt: board.updatedAt }, log: store.log(id) }) : json(res, 404, { error: "not found" });
    }
    if (req.method === "DELETE") {
      store.deleteBoard(id);
      return json(res, 200, { ok: true });
    }
  }
  if (url.pathname.startsWith("/images/")) {
    const name = decode(url.pathname.slice("/images/".length));
    if (name === null) return json(res, 400, { error: "bad path" });
    const file = imageStore.read(name);
    if (file) {
      res.writeHead(200, { "content-type": file.type, "cache-control": "public, max-age=31536000, immutable", ...cors(res) });
      res.end(file.bytes);
      return;
    }
  }
  res.writeHead(404);
  res.end();
});

/** POST /tts {text}: the line as streamed PCM, for the browser to play as it arrives. */
async function streamSpeech(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const body = await readBody(req, 20000);
  if (body === null) return json(res, 413, { error: "too long" });
  let text: string;
  try {
    text = String((JSON.parse(body) as { text?: unknown }).text ?? "");
  } catch {
    return json(res, 400, { error: "bad json" });
  }
  const abort = new AbortController();
  req.on("close", () => abort.abort());
  try {
    const up = await speak(text, abort.signal);
    activeMeter()?.tts(text.length);
    res.writeHead(200, { "content-type": "audio/l16", "x-sample-rate": String(SAMPLE_RATE), "cache-control": "no-store", ...cors(res) });
    for await (const chunk of up.body as unknown as AsyncIterable<Uint8Array>) {
      if (abort.signal.aborted) break;
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    if (abort.signal.aborted) return;
    const status = err instanceof VoiceError ? err.status : 502;
    log.warn("tts failed:", err instanceof Error ? err.message : err);
    if (!res.headersSent) json(res, status, { error: err instanceof Error ? err.message : String(err) });
    else res.end();
  }
}

// Two websocket paths on one server: /ws for the lesson, /stt for the student's microphone.
const wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 * 1024 });
const stt = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
http.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Browsers always send Origin on a websocket; a page on another site must not drive a lesson or the mic.
  const gate = checkRequest(req);
  if (!gate.ok) {
    log.warn(`refused websocket ${url.pathname}: ${gate.reason}`);
    socket.write("HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (url.pathname === "/ws") wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  else if (url.pathname === "/stt") stt.handleUpgrade(req, socket, head, (ws) => bridgeTranscription(ws, url.searchParams));
  else socket.destroy();
});

wss.on("connection", (ws: WebSocket) => {
  let session: Session | null = null;
  const send = (m: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  log.info("client connected");

  ws.on("message", async (raw) => {
    let parsed;
    try {
      parsed = ClientMessageSchema.safeParse(JSON.parse(raw.toString()));
    } catch {
      return send({ type: "error", message: "bad json" });
    }
    if (!parsed.success) return send({ type: "error", message: "bad message: " + parsed.error.issues.map((i) => i.message).join("; ") });
    const msg = parsed.data;
    try {
      switch (msg.type) {
        case "start": {
          session?.close();
          session = null;
          const images = createImages();
          // A client-chosen id that already exists is a resume: the page was refreshed before the server answered.
          const reopen = msg.resume ?? (msg.id && store.getBoard(msg.id) ? msg.id : undefined);
          if (reopen) {
            const row = store.getBoard(reopen);
            if (!row) return send({ type: "error", message: "that board no longer exists" });
            session = new Session(createBrain({ model: row.model, session: row.brainSessionId }), images, store, send, row.id);
            log.info(msg.quiet ? "reconnect" : "resume", row.id, row.title);
            await session.resume({ quiet: msg.quiet });
            break;
          }
          if (!msg.topic.trim()) return send({ type: "error", message: "tell me what you want to learn" });
          session = new Session(createBrain({ model: msg.model }), images, store, send, msg.id);
          log.info("session", session.id, "topic:", msg.topic.slice(0, 80), msg.sources.length ? `sources: ${msg.sources.length}` : "");
          await session.start(msg.topic, msg.materials, msg.sources);
          break;
        }
        case "user":
          if (!session) return send({ type: "error", message: "no session; send start first" });
          await session.user(msg.text);
          break;
        case "interrupt":
          session?.interrupt(msg.heard);
          break;
        case "continue":
          await session?.continue();
          break;
        case "model":
          session?.setModel(msg.model);
          break;
        case "offer.answer":
          session?.answerOffer(msg.id, msg.accept);
          break;
      }
    } catch (err) {
      log.error(err);
      send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  ws.on("close", () => {
    session?.close();
    log.info("client gone");
  });
});

// Stop cleanly: end lessons (which kills their claude processes) and the OCR worker, then exit.
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info(`${sig}: closing lessons`);
    for (const s of [...Session.live.values()]) s.close();
    wss.clients.forEach((c) => c.close(1001, "server stopping"));
    void stopOcr().finally(() => http.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

http.listen(PORT, HOST, () => log.info(`tutor server on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT} (ws at /ws, voice: ${voiceConfig().provider})`));
