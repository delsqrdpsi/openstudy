import type { IncomingMessage } from "node:http";

/**
 * Who may talk to the tutor server. It reads local folders, spends your Claude
 * plan and your keys, and runs lessons, so only the OpenStudy web app on this
 * machine may use it:
 *
 * - Host must name this machine (localhost, 127.0.0.1, ::1, or a host listed in
 *   TUTOR_ALLOWED_HOSTS / TUTOR_PUBLIC_URL). This defeats DNS rebinding, where
 *   an attacker's domain is pointed at 127.0.0.1.
 * - Origin, when the browser sends one, must be a page served from this machine
 *   (any port, so `next dev` and `next start` both work) or listed in
 *   WEB_ORIGINS. A page on another site therefore cannot open the lesson
 *   socket, scan folders, read boards or delete them.
 * - Requests without an Origin (curl, server-side rendering, plain image loads)
 *   are allowed: a browser only omits Origin where the response cannot be read
 *   cross-site anyway.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function allowedHosts(): Set<string> {
  const hosts = new Set(LOOPBACK);
  for (const h of list(process.env.TUTOR_ALLOWED_HOSTS)) hosts.add(h.toLowerCase());
  const pub = process.env.TUTOR_PUBLIC_URL;
  if (pub) {
    try {
      hosts.add(new URL(pub).hostname.toLowerCase());
    } catch {
      // ignore a malformed public URL; loopback still works
    }
  }
  return hosts;
}

/** The hostname of a Host header, without the port. */
export function hostOf(header: string | undefined): string | null {
  if (!header) return null;
  try {
    return new URL(`http://${header}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function originAllowed(origin: string): boolean {
  if (list(process.env.WEB_ORIGINS).includes(origin)) return true;
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export type Gate = { ok: true; origin?: string } | { ok: false; reason: string };

export function checkRequest(req: Pick<IncomingMessage, "headers">, opts: { allowNullOrigin?: boolean } = {}): Gate {
  const host = hostOf(req.headers.host);
  if (!host || !allowedHosts().has(host)) return { ok: false, reason: `host ${req.headers.host ?? "(none)"} is not this machine` };
  const origin = req.headers.origin;
  if (origin === undefined) return { ok: true };
  if (origin === "null") return opts.allowNullOrigin ? { ok: true, origin } : { ok: false, reason: "opaque origin" };
  if (!originAllowed(origin)) return { ok: false, reason: `origin ${origin} is not the OpenStudy web app` };
  return { ok: true, origin };
}

export function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    // What /tts tells the browser about the audio it sends.
    "access-control-expose-headers": "x-sample-rate, x-speed",
    vary: "origin",
  };
}
