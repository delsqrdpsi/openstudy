import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessageSchema, type ServerMessage } from "@openstudy/shared";
import { createBrain } from "./brain";
import { createImages, imageStore } from "./images";
import { Session } from "./session";
import { Store } from "./store";
import { listFigures, readFigureFile } from "./figures";
import { listJobs } from "./figures/builder";
import { bridgeTranscription, SAMPLE_RATE, speak, voiceConfig, VoiceError } from "./voice/deepgram";
import { CanvasClient, CanvasError, normalizeDomain, searchSchools, type CanvasConnection } from "./canvas/client";
import { courseStatus, openCourse, type CourseIndex } from "./canvas/index";
import { cancelLogin, loginState, startLogin } from "./canvas/login";
import { log } from "./log";

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
    return json(res, 200, { ok: true, brain: process.env.BRAIN ?? "claude-code", images: process.env.IMAGES ?? (process.env.GEMINI_API_KEY ? "gemini" : "none"), voice: voiceConfig().provider });
  }
  if (url.pathname === "/voice" && req.method === "GET") return json(res, 200, voiceConfig());
  if (url.pathname === "/tts" && req.method === "POST") {
    void streamSpeech(req, res);
    return;
  }
  if (url.pathname.startsWith("/canvas")) {
    void canvasRoute(url, req, res);
    return;
  }
  if (url.pathname === "/boards" && req.method === "GET") return json(res, 200, store.listBoards());
  if (url.pathname === "/figures" && req.method === "GET") return json(res, 200, { figures: listFigures(), jobs: listJobs() });
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
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  try {
    const up = await speak(text, abort.signal);
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

async function readJson(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20000) throw new CanvasError("too long", 413);
  }
  try {
    return body ? (JSON.parse(body) as Record<string, unknown>) : {};
  } catch {
    throw new CanvasError("bad json", 400);
  }
}

/**
 * Canvas LMS, in two steps: find the school (a directory search, no token),
 * then paste an access token. The token is saved here and never sent back;
 * the browser gets course and item names, and item contents on request.
 *
 *   GET    /canvas                      who is connected (domain, user) or {connected:false}
 *   GET    /canvas/schools?q=           step one: schools matching a name
 *   POST   /canvas/connect {domain,token}  step two: check the token and save it
 *   POST   /canvas/login {domain}       step two without a token: open a browser window to log in; GET for progress, DELETE to cancel
 *   DELETE /canvas                      forget the connection
 *   GET    /canvas/courses              the student's active courses
 *   POST   /canvas/courses/:id/index {name}  read the whole course in the background (cached on disk); returns progress
 *   GET    /canvas/courses/:id/index    indexing progress
 *   GET    /canvas/courses/:id/items    pages, assignments and files, by module
 *   GET    /canvas/courses/:id/text?kind=page|assignment&id=   one item as text
 *   GET    /canvas/files/:id            a file's bytes (read in the browser like a dropped file)
 */
async function canvasRoute(url: URL, req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const abort = new AbortController();
  // The request emits close once its body is read; the response closes when the client is gone.
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const signal = abort.signal;
  const conn = store.getSetting<CanvasConnection>("canvas");
  const client = () => {
    if (!conn) throw new CanvasError("Canvas is not connected", 401);
    return CanvasClient.from(conn);
  };
  try {
    const path = url.pathname;
    if (path === "/canvas" && req.method === "GET") return json(res, 200, conn ? { connected: true, domain: conn.domain, user: conn.user, auth: conn.auth } : { connected: false });
    if (path === "/canvas" && req.method === "DELETE") {
      store.deleteSetting("canvas");
      return json(res, 200, { ok: true });
    }
    if (path === "/canvas/schools" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      // Whatever they typed may itself be the address; offer it first so any school works, listed or not.
      const typed = normalizeDomain(q);
      const found = await searchSchools(q, signal);
      const schools = typed && !found.some((s) => s.domain === typed) ? [{ name: typed, domain: typed }, ...found] : found;
      return json(res, 200, { schools });
    }
    if (path === "/canvas/connect" && req.method === "POST") {
      const body = await readJson(req);
      const domain = normalizeDomain(String(body.domain ?? ""));
      const token = String(body.token ?? "").trim();
      if (!domain) throw new CanvasError("that does not look like a Canvas address", 400);
      if (!token) throw new CanvasError("paste the access token", 400);
      const who = await new CanvasClient(domain, token).self(signal);
      store.setSetting("canvas", { domain, auth: "token", secret: token, user: who.name } satisfies CanvasConnection);
      log.info("canvas connected:", domain, "as", who.name);
      return json(res, 200, { connected: true, domain, user: who.name, auth: "token" });
    }
    if (path === "/canvas/login") {
      if (req.method === "POST") {
        const domain = normalizeDomain(String((await readJson(req)).domain ?? ""));
        if (!domain) throw new CanvasError("that does not look like a Canvas address", 400);
        startLogin(domain, (c) => store.setSetting("canvas", c));
        return json(res, 200, loginState());
      }
      if (req.method === "DELETE") {
        cancelLogin();
        return json(res, 200, { ok: true });
      }
      return json(res, 200, loginState());
    }
    if (path === "/canvas/courses" && req.method === "GET") return json(res, 200, { courses: await client().courses(signal) });
    const course = /^\/canvas\/courses\/(\d+)\/(items|text|index|search)$/.exec(path);
    if (course && course[2] === "index") {
      const id = Number(course[1]);
      if (req.method === "POST") {
        const body = await readJson(req);
        const idx = openCourse(client(), conn!.domain, id, String(body.name ?? `course ${id}`));
        return json(res, 200, idx.status);
      }
      const status = conn ? courseStatus(conn.domain, id) : null;
      return status ? json(res, 200, status) : json(res, 404, { error: "not indexed" });
    }
    if (course && course[2] === "search" && req.method === "GET") {
      // What a @pull would return, for checking an index by hand.
      const idx = conn ? openCourse(client(), conn.domain, Number(course[1]), url.searchParams.get("name") ?? `course ${course[1]}`) : null;
      if (!idx) throw new CanvasError("Canvas is not connected", 401);
      await idx.settle(5000);
      return json(res, 200, { status: idx.status, hits: idx.search(url.searchParams.get("q") ?? "", 8) });
    }
    if (course && req.method === "GET") {
      const id = Number(course[1]);
      if (course[2] === "items") return json(res, 200, { items: await client().items(id, signal) });
      const kind = url.searchParams.get("kind");
      const itemId = url.searchParams.get("id") ?? "";
      if ((kind !== "page" && kind !== "assignment") || !itemId) throw new CanvasError("kind and id are required", 400);
      return json(res, 200, await client().text(id, kind, itemId, signal));
    }
    const file = /^\/canvas\/files\/(\d+)$/.exec(path);
    if (file && req.method === "GET") {
      const f = await client().file(file[1], signal);
      res.writeHead(200, { "content-type": f.type, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, "cache-control": "no-store", ...CORS, "access-control-expose-headers": "content-disposition" });
      for await (const chunk of f.body.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal.aborted) break;
        res.write(chunk);
      }
      res.end();
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    if (signal.aborted) return;
    const status = err instanceof CanvasError ? err.status : 502;
    log.warn("canvas:", err instanceof Error ? err.message : err);
    if (!res.headersSent) json(res, status, { error: err instanceof Error ? err.message : String(err) });
    else res.end();
  }
}

/** The index for a course, if Canvas is connected; a lesson without it just has no course to pull from. */
function courseFor(courseId: number, name: string): CourseIndex | null {
  const conn = store.getSetting<CanvasConnection>("canvas");
  if (!conn) return null;
  return openCourse(CanvasClient.from(conn), conn.domain, courseId, name);
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
            await session.resume(row.courseId != null ? courseFor(row.courseId, row.title) : null);
            break;
          }
          if (!msg.topic.trim()) return send({ type: "error", message: "tell me what you want to learn" });
          session = new Session(createBrain({ model: msg.model }), images, store, send);
          log.info("session", session.id, "topic:", msg.topic.slice(0, 80), msg.course ? `course: ${msg.course.name}` : "");
          await session.start(msg.topic, msg.materials, msg.course ? courseFor(msg.course.id, msg.course.name) : null);
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
