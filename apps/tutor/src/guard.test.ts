import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { corsHeaders, HttpError, readJson, refusal } from "./guard";

/** A tiny server that applies the guard the way index.ts does and echoes the JSON body back. */
let server: Server;
let port: number;
beforeAll(async () => {
  delete process.env.WEB_ORIGINS;
  delete process.env.TUTOR_PUBLIC_URL;
  server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const refused = refusal(req, path);
    if (refused) {
      res.writeHead(403);
      return res.end(refused);
    }
    if (req.method === "POST") {
      try {
        const body = await readJson(req, 100);
        res.writeHead(200, corsHeaders(req, path));
        return res.end(JSON.stringify(body));
      } catch (e) {
        res.writeHead(e instanceof HttpError ? e.status : 500);
        return res.end();
      }
    }
    res.writeHead(200, corsHeaders(req, path));
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

function call(opts: { method?: string; path?: string; host?: string; origin?: string; type?: string; body?: string }) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const headers: Record<string, string> = { host: opts.host ?? `localhost:${port}` };
    if (opts.origin) headers.origin = opts.origin;
    if (opts.type) headers["content-type"] = opts.type;
    const req = request({ host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path ?? "/boards", headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

describe("guard", () => {
  it("lets the board's own page in and names it in the CORS header", async () => {
    const r = await call({ origin: "http://localhost:3000" });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("refuses another website's page", async () => {
    expect((await call({ origin: "https://evil.example" })).status).toBe(403);
    expect((await call({ method: "POST", path: "/tts", origin: "https://evil.example", type: "text/plain", body: '{"text":"hi"}' })).status).toBe(403);
  });

  it("refuses a hostname that is not ours, even from the same page (DNS rebinding)", async () => {
    expect((await call({ host: `evil.example:${port}` })).status).toBe(403);
  });

  it("still serves tools that send no Origin, like curl", async () => {
    expect((await call({})).status).toBe(200);
  });

  it("lets anyone read the figure library and pictures, including sandboxed frames", async () => {
    const r = await call({ path: "/figures/lever-balance/model.js", origin: "null" });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    expect((await call({ path: "/images/abc.png", origin: "https://anywhere.example" })).status).toBe(200);
    expect((await call({ method: "POST", path: "/figures/x", origin: "null", type: "application/json", body: "{}" })).status).toBe(403);
  });

  it("only takes JSON bodies, and only small ones", async () => {
    const ok = await call({ method: "POST", path: "/tts", origin: "http://localhost:3000", type: "application/json", body: '{"text":"hi"}' });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ text: "hi" });
    expect((await call({ method: "POST", path: "/tts", type: "text/plain", body: '{"text":"hi"}' })).status).toBe(415);
    expect((await call({ method: "POST", path: "/tts", type: "application/json", body: JSON.stringify({ text: "x".repeat(500) }) })).status).toBe(413);
  });

  it("follows WEB_ORIGINS and TUTOR_PUBLIC_URL when hosted", async () => {
    process.env.WEB_ORIGINS = "https://app.example.com";
    process.env.TUTOR_PUBLIC_URL = "https://api.example.com";
    try {
      expect((await call({ host: "api.example.com", origin: "https://app.example.com" })).status).toBe(200);
      expect((await call({ host: "api.example.com", origin: "http://localhost:3000" })).status).toBe(403);
    } finally {
      delete process.env.WEB_ORIGINS;
      delete process.env.TUTOR_PUBLIC_URL;
    }
  });
});
