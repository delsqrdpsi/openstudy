import { afterEach, describe, expect, it } from "vitest";
import { checkRequest, corsHeaders } from "./guard";

const req = (headers: Record<string, string>) => ({ headers });

describe("request guard", () => {
  afterEach(() => {
    delete process.env.WEB_ORIGINS;
    delete process.env.TUTOR_ALLOWED_HOSTS;
  });

  it("allows the web app on this machine, on any port", () => {
    expect(checkRequest(req({ host: "localhost:8787", origin: "http://localhost:3000" }))).toEqual({ ok: true, origin: "http://localhost:3000" });
    expect(checkRequest(req({ host: "127.0.0.1:8787", origin: "http://127.0.0.1:3100" })).ok).toBe(true);
    expect(checkRequest(req({ host: "[::1]:8787" })).ok).toBe(true);
  });

  it("refuses pages on other sites", () => {
    expect(checkRequest(req({ host: "localhost:8787", origin: "https://evil.example" })).ok).toBe(false);
    expect(checkRequest(req({ host: "localhost:8787", origin: "http://localhost.evil.example" })).ok).toBe(false);
  });

  it("refuses DNS rebinding: a foreign Host pointed at loopback", () => {
    expect(checkRequest(req({ host: "evil.example:8787" })).ok).toBe(false);
    expect(checkRequest(req({})).ok).toBe(false);
  });

  it("allows the opaque origin only where asked (sandboxed figure frames)", () => {
    expect(checkRequest(req({ host: "localhost:8787", origin: "null" })).ok).toBe(false);
    expect(checkRequest(req({ host: "localhost:8787", origin: "null" }), { allowNullOrigin: true }).ok).toBe(true);
  });

  it("takes extra origins and hosts from the environment", () => {
    process.env.WEB_ORIGINS = "http://tablet.lan:3000";
    process.env.TUTOR_ALLOWED_HOSTS = "laptop.lan";
    expect(checkRequest(req({ host: "laptop.lan:8787", origin: "http://tablet.lan:3000" })).ok).toBe(true);
  });

  it("echoes only an allowed origin in CORS headers", () => {
    expect(corsHeaders(undefined)).toEqual({});
    expect(corsHeaders("http://localhost:3000")["access-control-allow-origin"]).toBe("http://localhost:3000");
  });
});
