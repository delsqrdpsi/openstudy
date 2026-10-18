import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessageSchema, type ServerMessage } from "@openstudy/shared";
import { brainKind, brainModels, createBrain } from "./brain";
import { createImages, imageStore } from "./images";
import { Session } from "./session";
import { Store } from "./store";
import { listFigures, readFigureFile } from "./figures";
import { listSources, prepareSource, readSourceFile, scanFolder } from "./sources";
import { listJobs } from "./figures/builder";
import { bridgeTranscription, SAMPLE_RATE, speak, voiceConfig, VoiceError } from "./voice/deepgram";
import { log } from "./log";
import { activeMeter } from "./usage";

const PORT = Number(process.env.TUTOR_PORT ?? 8787);

// One failed picture or model call must never take the server down with every lesson on it.
process.on("unhandledRejection", (err) => log.error("unhandled rejection:", err instanceof Error ? err.message : err));
process.on("uncaughtException", (err) => log.error("uncaught exception:", err.message));
const store = new Store();

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type" };
const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
};

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, brain: brainKind(), images: process.env.IMAGES ?? (process.env.GEMINI_API_KEY ? "gemini" : "none"), voice: voiceConfig().provider });
  }
  if (url.pathname === "/models" && req.method === "GET") {
    void brainModels().then((models) => json(res, 200, { brain: brainKind(), models }));
    return;
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
      let body = "";
      for await (const chunk of req) body += chunk;
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
      res.writeHead(200, { "content-type": file.type, "cache-control": "public, max-age=3600", ...CORS });
      res.end(file.bytes);
      return;
    }
  }
  const figMatch = /^\/figures\/([a-z0-9][a-z0-9-]*)\/?(.*)$/.exec(url.pathname);
  if (figMatch && req.method === "GET") {
    const file = readFigureFile(figMatch[1], decodeURIComponent(figMatch[2]));
    if (file) {
      // Pages are re-read each time (the board's size reporter is added on the way out); assets can be cached.
      const cache = file.type.startsWith("text/html") ? "no-cache" : "public, max-age=3600";
      res.writeHead(200, { "content-type": file.type, "cache-control": cache, ...CORS });
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
  if (req.url?.startsWith("/images/")) {
    const file = imageStore.read(decodeURIComponent(req.url.slice("/images/".length)));
    if (file) {
      res.writeHead(200, { "content-type": file.type, "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" });
      res.end(file.bytes);
      return;
    }
  }
  res.writeHead(404);
  res.end();
});

/** POST /tts {text}: the line as streamed PCM, for the browser to play as it arrives. */
async function streamSpeech(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20000) return json(res, 413, { error: "too long" });
  }
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
    res.writeHead(200, { "content-type": "audio/l16", "x-sample-rate": String(SAMPLE_RATE), "cache-control": "no-store", ...CORS });
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
const wss = new WebSocketServer({ noServer: true });
const stt = new WebSocketServer({ noServer: true });
http.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
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
          const images = createImages();
          if (msg.resume) {
            const row = store.getBoard(msg.resume);
            if (!row) return send({ type: "error", message: "that board no longer exists" });
            session = new Session(createBrain({ model: row.model, session: row.brainSessionId }), images, store, send, row.id);
            log.info("resume", row.id, row.title);
            await session.resume();
            break;
          }
          if (!msg.topic.trim()) return send({ type: "error", message: "tell me what you want to learn" });
          session = new Session(createBrain({ model: msg.model }), images, store, send);
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

http.listen(PORT, () => log.info(`tutor server on http://localhost:${PORT} (ws at /ws, voice: ${voiceConfig().provider})`));
