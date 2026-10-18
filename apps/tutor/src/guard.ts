import type { IncomingMessage } from "node:http";

/**
 * Who may talk to the tutor server. It holds the API keys and can read the
 * student's folders, so only the board's own pages may call it. A request
 * another website makes from the student's browser carries that site's
 * Origin and is refused; a request through a hostname that is not ours (DNS
 * rebinding: evil.example resolving to 127.0.0.1) is refused by its Host.
 * Tools that send no Origin (curl, scripts) still work, and the server only
 * listens on this machine unless TUTOR_HOST says otherwise.
 *
 * WEB_ORIGINS lists the board's origins (default the local dev server).
 * TUTOR_PUBLIC_URL and TUTOR_ALLOWED_HOSTS name the hostnames this server
 * answers to besides localhost.
 */
export function webOrigins(): string[] {
  const env = process.env.WEB_ORIGINS?.trim();
  const list = env ? env.split(",") : ["http://localhost:3000", "http://127.0.0.1:3000"];
  return list.map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
}

function allowedHosts(): Set<string> {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const pub = process.env.TUTOR_PUBLIC_URL;
  if (pub) {
    try {
      hosts.add(new URL(pub).hostname);
    } catch {
      // A malformed TUTOR_PUBLIC_URL breaks picture links too; nothing to add here.
    }
  }
  for (const h of (process.env.TUTOR_ALLOWED_HOSTS ?? "").split(",")) if (h.trim()) hosts.add(h.trim().toLowerCase());
  return hosts;
}

const hostname = (host: string) => (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]).toLowerCase();

/**
 * Paths anyone may read: the figure library (its pages run in a sandboxed
 * frame, so their own requests arrive with Origin "null") and pictures, whose
 * names are random.
 */
export const isPublicRead = (req: IncomingMessage, path: string) => req.method === "GET" && (path.startsWith("/figures/") || path.startsWith("/images/"));

/** Why this request must be refused, or null when it may go ahead. */
export function refusal(req: IncomingMessage, path: string): string | null {
  const host = req.headers.host;
  if (!host || !allowedHosts().has(hostname(host))) return "unknown host";
  const origin = req.headers.origin;
  if (origin === undefined || isPublicRead(req, path)) return null;
  return webOrigins().includes(origin) ? null : "origin not allowed";
}

/** CORS headers for this request: the board's origin echoed back, or "*" for public reads. */
export function corsHeaders(req: IncomingMessage, path: string): Record<string, string> {
  if (isPublicRead(req, path)) return { "access-control-allow-origin": "*" };
  const origin = req.headers.origin;
  if (!origin || !webOrigins().includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Read a JSON body of at most `limit` bytes. Requiring the JSON content type
 * also means a browser must ask first (a CORS preflight) before sending one
 * from another site, so a plain cross-site form post cannot reach the handler.
 */
export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "expected application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "request too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "bad json");
  }
}
