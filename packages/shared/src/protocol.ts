import type { LessonEvent } from "./events";
import type { Block } from "./blocks";
import { BlockSchema } from "./blocks";

/**
 * The board protocol: a line-based text format the tutor model writes, parsed
 * incrementally as tokens stream in. It is deliberately not JSON so that html
 * can stream into a block a few characters at a time.
 *
 *   @say <one line of narration>
 *   @section <title>
 *   @html id=<id> col=<n>
 *   ...html, streamed...
 *   @end
 *   @svg id=<id> col=<n> caption="..."
 *   <svg viewBox="0 0 300 200">...</svg>
 *   @end
 *   @image id=<id> col=<n> prompt="..." caption="..."
 *   @motion id=<id> col=<n> caption="..."
 *   <svg viewBox="0 0 300 200">...animated with <animate> or CSS...</svg>
 *   @end
 *   @figure id=<id> col=<n> name="<figure from the library>" caption="..."
 *   @build_figure name="<slug>" concept="what the model should show"
 *   @annotate id=<id> target=<id> kind=circle match="word or phrase"
 *   @focus id=<id>
 *   @remove id=<id>
 *   @ask            end the turn and wait for the student
 *   @ask options="first choice|second choice|third choice"
 *   @done           the lesson is finished
 */

/** `ask` may carry quick-check options the student can click instead of typing. */
export type ProtocolSignal =
  | { type: "ask"; options?: string[] }
  | { type: "done" }
  | { type: "error"; message: string; line: string }
  /** The tutor wants a library figure on the board; the server resolves name to src. */
  | { type: "figure"; id: string; column: number; name: string; caption?: string }
  /** The tutor asks for a new interactive model to be built in the background. */
  | { type: "build_figure"; name: string; concept: string };

export interface ProtocolSink {
  event(e: LessonEvent): void;
  signal(s: ProtocolSignal): void;
}

type Mode =
  | { kind: "idle" }
  | { kind: "html"; id: string }
  | { kind: "svg"; id: string; column: number; caption?: string; buf: string; motion: boolean };

export class ProtocolParser {
  private buf = "";
  private mode: Mode = { kind: "idle" };
  private seen = new Set<string>();

  constructor(private sink: ProtocolSink) {}

  /** Feed streamed text. Safe to call with any chunk boundaries. */
  feed(chunk: string) {
    this.buf += chunk;
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl === -1) break;
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.line(line, true);
    }
    // Stream a partial trailing line when it is clearly html content.
    if (this.mode.kind === "html" && this.buf.length && !this.buf.startsWith("@")) {
      const safe = safePrefix(this.buf);
      if (safe) {
        this.sink.event({ type: "block.append", id: this.mode.id, html: safe });
        this.buf = this.buf.slice(safe.length);
      }
    }
  }

  /** Flush at end of stream. */
  end() {
    if (this.buf) {
      this.line(this.buf, false);
      this.buf = "";
    }
    if (this.mode.kind === "svg") this.closeSvg();
    this.mode = { kind: "idle" };
  }

  private line(raw: string, complete: boolean) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("@")) {
      this.command(line);
      return;
    }
    if (this.mode.kind === "html") {
      this.sink.event({ type: "block.append", id: this.mode.id, html: line + (complete ? "\n" : "") });
    } else if (this.mode.kind === "svg") {
      this.mode.buf += line + "\n";
    } else if (line.trim()) {
      // Bare prose outside a block is treated as narration.
      this.sink.event({ type: "say", text: line.trim() });
    }
  }

  private command(line: string) {
    const m = /^@(\w+)\s?(.*)$/.exec(line);
    if (!m) return;
    const [, name, rest] = m;
    switch (name) {
      case "end":
        if (this.mode.kind === "svg") this.closeSvg();
        this.mode = { kind: "idle" };
        return;
      case "say":
        this.closeOpen();
        if (rest.trim()) this.sink.event({ type: "say", text: rest.trim() });
        return;
      case "section":
        this.closeOpen();
        this.sink.event({ type: "section", title: rest.trim() });
        return;
      case "ask": {
        this.closeOpen();
        const opts = parseAttrs(rest).options;
        const options = opts ? opts.split("|").map((o) => o.trim()).filter(Boolean) : undefined;
        this.sink.signal(options?.length ? { type: "ask", options } : { type: "ask" });
        return;
      }
      case "done":
        this.closeOpen();
        this.sink.signal({ type: "done" });
        return;
    }
    const attrs = parseAttrs(rest);
    switch (name) {
      case "html": {
        this.closeOpen();
        const id = this.uniqueId(attrs.id);
        const block = this.validate({ id, type: "html", column: num(attrs.col), html: "" }, line);
        if (!block) return;
        this.sink.event({ type: "block.add", block });
        this.mode = { kind: "html", id };
        return;
      }
      case "svg":
      case "motion": {
        this.closeOpen();
        const id = this.uniqueId(attrs.id);
        this.mode = { kind: "svg", id, column: num(attrs.col), caption: attrs.caption, buf: "", motion: name === "motion" };
        return;
      }
      case "figure": {
        this.closeOpen();
        if (!attrs.name) {
          this.sink.signal({ type: "error", message: "figure needs name", line });
          return;
        }
        const id = this.uniqueId(attrs.id ?? attrs.name);
        this.sink.signal({ type: "figure", id, column: num(attrs.col), name: attrs.name, caption: attrs.caption });
        return;
      }
      case "build_figure": {
        this.closeOpen();
        if (!attrs.name || !attrs.concept) {
          this.sink.signal({ type: "error", message: "build_figure needs name and concept", line });
          return;
        }
        this.sink.signal({ type: "build_figure", name: attrs.name, concept: attrs.concept });
        return;
      }
      case "image": {
        this.closeOpen();
        const id = this.uniqueId(attrs.id);
        const block = this.validate(
          { id, type: "image", column: num(attrs.col), prompt: attrs.prompt ?? "", status: "pending", caption: attrs.caption },
          line,
        );
        if (block) this.sink.event({ type: "block.add", block });
        return;
      }
      case "annotate": {
        this.closeOpen();
        const id = this.uniqueId(attrs.id ?? `ann_${this.seen.size}`);
        const region = parseRegion(attrs.region, attrs.at);
        if (!region && !attrs.match) {
          this.sink.signal({ type: "error", message: "annotation needs match, region or at", line });
          return;
        }
        const block = this.validate(
          { id, type: "annotation", target: attrs.target ?? "", kind: attrs.kind ?? "highlight", match: attrs.match ?? "", region, color: attrs.color },
          line,
        );
        if (block) this.sink.event({ type: "block.add", block });
        return;
      }
      case "focus":
        if (attrs.id) this.sink.event({ type: "focus", id: attrs.id });
        return;
      case "remove":
        if (attrs.id) this.sink.event({ type: "block.remove", id: attrs.id });
        return;
      default:
        this.sink.signal({ type: "error", message: `unknown command @${name}`, line });
    }
  }

  private closeOpen() {
    if (this.mode.kind === "svg") this.closeSvg();
    this.mode = { kind: "idle" };
  }

  private closeSvg() {
    if (this.mode.kind !== "svg") return;
    const { id, column, caption, buf, motion } = this.mode;
    const svg = buf.trim();
    const block = this.validate({ id, type: "svg", column, svg, width: 300, height: 200, caption, motion: motion || undefined }, `@svg id=${id}`);
    if (block) this.sink.event({ type: "block.add", block });
    this.mode = { kind: "idle" };
  }

  private uniqueId(id: string | undefined): string {
    let base = (id ?? "block").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "block";
    if (base.length > 60) base = base.slice(0, 60);
    let out = base;
    let n = 2;
    while (this.seen.has(out)) out = `${base}_${n++}`;
    this.seen.add(out);
    return out;
  }

  private validate(candidate: unknown, line: string): Block | null {
    const r = BlockSchema.safeParse(candidate);
    if (r.success) return r.data;
    this.sink.signal({ type: "error", message: r.error.issues.map((i) => i.message).join("; "), line });
    return null;
  }
}

const num = (v: string | undefined) => {
  const n = parseInt(v ?? "0", 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(7, n)) : 0;
};

const AT: Record<string, [number, number, number, number]> = {
  center: [0.3, 0.3, 0.4, 0.4],
  left: [0.03, 0.15, 0.42, 0.7],
  right: [0.55, 0.15, 0.42, 0.7],
  top: [0.15, 0.03, 0.7, 0.4],
  bottom: [0.15, 0.57, 0.7, 0.4],
  "top-left": [0.03, 0.03, 0.42, 0.45],
  "top-right": [0.55, 0.03, 0.42, 0.45],
  "bottom-left": [0.03, 0.52, 0.42, 0.45],
  "bottom-right": [0.55, 0.52, 0.42, 0.45],
  all: [0.02, 0.02, 0.96, 0.96],
};

/** region="x,y,w,h" as fractions, or a named position. */
export function parseRegion(region?: string, at?: string): { x: number; y: number; w: number; h: number } | undefined {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  if (region) {
    const n = region.split(/[\s,]+/).map(Number);
    if (n.length === 4 && n.every(Number.isFinite)) return { x: clamp(n[0]), y: clamp(n[1]), w: clamp(n[2]), h: clamp(n[3]) };
  }
  const key = at?.toLowerCase().replace(/[\s_]+/g, "-");
  if (key && AT[key]) {
    const [x, y, w, h] = AT[key];
    return { x, y, w, h };
  }
  return undefined;
}

/** key=value pairs; values may be double-quoted with \" escapes. */
export function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = m[2] ?? m[3] ?? m[4] ?? "";
    out[m[1]] = v.replace(/\\(["'\\])/g, "$1");
  }
  return out;
}

/** The longest prefix of `s` that ends outside any html tag or entity. */
function safePrefix(s: string): string {
  const lt = s.lastIndexOf("<");
  const gt = s.lastIndexOf(">");
  let end = s.length;
  if (lt > gt) end = lt;
  const amp = s.lastIndexOf("&", end - 1);
  if (amp !== -1 && !s.slice(amp, end).includes(";") && end - amp < 10) end = amp;
  const dollar = s.lastIndexOf("$", end - 1);
  if (dollar !== -1) {
    // keep an unfinished $math$ run together
    const before = (s.slice(0, dollar).match(/\$/g) ?? []).length;
    if (before % 2 === 0) end = Math.min(end, dollar);
  }
  return s.slice(0, end);
}

/** Convenience for tests and the fixture tooling. */
export function parseProtocol(text: string): { events: LessonEvent[]; signals: ProtocolSignal[] } {
  const events: LessonEvent[] = [];
  const signals: ProtocolSignal[] = [];
  const p = new ProtocolParser({ event: (e) => events.push(e), signal: (s) => signals.push(s) });
  p.feed(text);
  p.end();
  return { events, signals };
}
