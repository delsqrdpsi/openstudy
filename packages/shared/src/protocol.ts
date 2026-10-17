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
 *   @annotate id=<id> target=<id> kind=circle match="word or phrase"
 *   @focus id=<id>
 *   @remove id=<id>
 *   @ask            end the turn and wait for the student
 *   @ask options="first choice|second choice|third choice"
 *   @done           the lesson is finished
 */

/** `ask` may carry quick-check options the student can click instead of typing. */
export type ProtocolSignal = { type: "ask"; options?: string[] } | { type: "done" } | { type: "error"; message: string; line: string };

export interface ProtocolSink {
  event(e: LessonEvent): void;
  signal(s: ProtocolSignal): void;
}

type Mode = { kind: "idle" } | { kind: "html"; id: string } | { kind: "svg"; id: string; column: number; caption?: string; buf: string };

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
      case "svg": {
        this.closeOpen();
        const id = this.uniqueId(attrs.id);
        this.mode = { kind: "svg", id, column: num(attrs.col), caption: attrs.caption, buf: "" };
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
        const block = this.validate(
          { id, type: "annotation", target: attrs.target ?? "", kind: attrs.kind ?? "highlight", match: attrs.match ?? "", color: attrs.color },
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
    const { id, column, caption, buf } = this.mode;
    const svg = buf.trim();
    const block = this.validate({ id, type: "svg", column, svg, width: 300, height: 200, caption }, `@svg id=${id}`);
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
