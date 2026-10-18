/**
 * Logging in without an access token. Some schools switch token generation
 * off for students. Then the only thing that identifies the student to
 * Canvas is their browser session, so: open a real browser window on the
 * school's Canvas login, let them sign in the way they always do (SSO, Duo,
 * whatever the school uses), and keep the session cookies. Canvas accepts
 * those for the same read-only API calls a token would make.
 *
 * The browser is the Chrome or Edge already on the machine (playwright-core
 * drives it; nothing is downloaded), with its own profile under data/, so
 * the student's everyday browser is untouched. One login at a time.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { CanvasClient, CanvasError, type CanvasConnection } from "./client";
import { dataDir } from "../paths";
import { log } from "../log";

export type LoginState = { state: "idle" } | { state: "waiting"; domain: string } | { state: "done"; domain: string; user: string } | { state: "failed"; domain: string; error: string };

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
/** Cookies Canvas sets once the student is signed in. */
const SESSION_COOKIES = ["canvas_session", "_legacy_normandy_session", "_normandy_session"];

let current: { domain: string; context: BrowserContext | null; cancel: () => void } | null = null;
let last: LoginState = { state: "idle" };

export function loginState(): LoginState {
  return last;
}

export function cancelLogin() {
  current?.cancel();
}

/**
 * Open the login window and resolve with a connection once the student is
 * in. Returns right away; poll loginState() for progress. `onDone` saves the
 * connection.
 */
export function startLogin(domain: string, onDone: (c: CanvasConnection) => void, opts: { loginUrl?: string; headless?: boolean } = {}) {
  if (current) {
    // Asked twice for the same school (the page re-rendered): the open window is the answer.
    if (current.domain === domain) return;
    throw new CanvasError(`a login window for ${current.domain} is already open`, 409);
  }
  last = { state: "waiting", domain };
  let cancelled = false;
  const entry = { domain, context: null as BrowserContext | null, cancel: () => {} };
  current = entry;
  entry.cancel = () => {
    cancelled = true;
    entry.context?.close().catch(() => {});
  };
  void (async () => {
    try {
      const conn = await runLogin(domain, entry, opts, () => cancelled);
      onDone(conn);
      last = { state: "done", domain, user: conn.user };
      log.info("canvas login:", domain, "as", conn.user);
    } catch (err) {
      const error = cancelled ? "login cancelled" : err instanceof Error ? err.message : String(err);
      last = { state: "failed", domain, error };
      log.warn("canvas login failed:", error);
    } finally {
      entry.context?.close().catch(() => {});
      current = null;
    }
  })();
}

async function runLogin(domain: string, entry: { context: BrowserContext | null }, opts: { loginUrl?: string; headless?: boolean }, isCancelled: () => boolean): Promise<CanvasConnection> {
  const profile = join(dataDir(), "canvas", "browser-profile");
  const context = await launch(profile, opts.headless ?? false);
  entry.context = context;
  let closed = false;
  context.on("close", () => (closed = true));
  const page = context.pages()[0] ?? (await context.newPage());
  const loginUrl = opts.loginUrl ?? `https://${domain}/login`;
  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  } catch (err) {
    throw new CanvasError(`could not open ${loginUrl}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (closed || isCancelled()) throw new CanvasError(closed ? "the browser window was closed before the login finished" : "login cancelled");
    const cookies = await context.cookies(`https://${domain}`).catch(() => []);
    if (cookies.some((c) => SESSION_COOKIES.includes(c.name))) {
      const jar = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      try {
        const who = await new CanvasClient(domain, jar, "cookie").self();
        return { domain, auth: "cookie", secret: jar, user: who.name };
      } catch {
        // Signed in to the SSO provider but not to Canvas yet; keep waiting.
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new CanvasError("the login took too long; try again");
}

/**
 * The browser on this machine. CANVAS_BROWSER names an executable outright;
 * otherwise Chrome, then Edge, then a Chromium Playwright has installed.
 */
async function launch(profile: string, headless: boolean): Promise<BrowserContext> {
  const base = { headless, viewport: null as null, args: ["--window-size=1100,800"] };
  const custom = process.env.CANVAS_BROWSER?.trim();
  const tries: (() => Promise<BrowserContext>)[] = [];
  if (custom && existsSync(custom)) tries.push(() => chromium.launchPersistentContext(profile, { ...base, executablePath: custom }));
  for (const channel of ["chrome", "msedge"]) tries.push(() => chromium.launchPersistentContext(profile, { ...base, channel }));
  tries.push(() => chromium.launchPersistentContext(profile, base));
  let lastErr: unknown;
  for (const t of tries) {
    try {
      return await t();
    } catch (err) {
      lastErr = err;
    }
  }
  const why = lastErr instanceof Error ? lastErr.message.split("\n")[0] : String(lastErr);
  throw new CanvasError(`no browser to log in with (install Chrome or Edge, or set CANVAS_BROWSER): ${why}`);
}
