import type { LessonEvent } from "./events";
import type { Block } from "./blocks";
import { BlockSchema } from "./blocks";
import { plainSpeech } from "./text";

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
 *   @page id=<id> col=<n> source="<file name>" page=<n> caption="..."   (a page of the student's material)
 *   @build_figure name="<slug>" concept="what the model should show"
 *   @annotate id=<id> target=<id> kind=circle match="word or phrase"
 *   @focus id=<id>
 *   @remove id=<id>
 *   @continue       end the turn but keep teaching once the narration has played
 *   @wait           end the turn and let the student look; they say when to go on
 *   @ask            end the turn and wait for the student's answer
 *   @ask options="first choice|second choice|third choice"
 *   @done           the lesson is finished
 */

/** `ask` may carry quick-check options the student can click instead of typing. */
export type ProtocolSignal =
  | { type: "ask"; options?: string[] }
  | { type: "continue" }
  /** The tutor stops for the student to look at the board; nothing is asked of them. */
  | { type: "wait" }
  | { type: "done" }
  | { type: "error"; message: string; line: string }
  /** The tutor wants a library figure on the board; the server resolves name to src. */
  | { type: "figure"; id: string; column: number; name: string; caption?: string }
  /** The tutor wants a page of the student's material on the board; the server resolves it. */
  | { type: "page"; id: string; column: number; source: string; page: number; caption?: string }
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

/** Commands the parser knows. Inside a block, any other line starting with @ (a CSS @keyframes, an email) is content. */
const COMMANDS = new Set(["end", "say", "section", "ask", "continue", "wait", "done", "html", "svg", "motion", "figure", "page", "build_figure", "image", "annotate", "focus", "remove"]);

/** The snake_case form block ids are stored in; references to a block go through the same function. */
export function slugId(id: string): string {
  const s = id.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return s.slice(0, 60);
}

export interface ProtocolOptions {
  /** Ids already on the board from earlier turns, so generated ids (block, ann, page_3) do not replace them. */
  existingIds?: Iterable<string>;
}

export class ProtocolParser {
  private buf = "";
  private mode: Mode = { kind: "idle" };
  private seen = new Set<string>();
  private readonly existing: Set<string>;
  /** Part of the current line was already streamed, so the rest is content, never a command. */
  private midLine = false;

  constructor(
    private sink: ProtocolSink,
    opts: ProtocolOptions = {},
  ) {
    this.existing = new Set(opts.existingIds ?? []);
  }

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
    if (this.mode.kind === "html" && this.buf.length && (this.midLine || !this.buf.trimStart().startsWith("@"))) {
      const safe = safePrefix(this.buf);
      if (safe) {
        this.sink.event({ type: "block.append", id: this.mode.id, html: safe });
        this.buf = this.buf.slice(safe.length);
        this.midLine = true;
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
    const continued = this.midLine;
    this.midLine = false;
    const trimmed = line.trimStart();
    if (!continued && trimmed.startsWith("@")) {
      const name = /^@(\w+)/.exec(trimmed)?.[1] ?? "";
      // In a block, only real commands end it; outside, an unknown command is reported.
      if (COMMANDS.has(name) || this.mode.kind === "idle") {
        this.command(trimmed);
        return;
      }
    }
    if (this.mode.kind === "html") {
      this.sink.event({ type: "block.append", id: this.mode.id, html: line + (complete ? "\n" : "") });
    } else if (this.mode.kind === "svg") {
      this.mode.buf += line + "\n";
    } else if (line.trim()) {
      // Bare prose outside a block is treated as narration.
      this.say(line);
    }
  }

  /** Spoken lines are plain words: the model sometimes carries board markup (<b>Actor</b>) into them. */
  private say(text: string) {
    const plain = plainSpeech(text);
    if (plain) this.sink.event({ type: "say", text: plain });
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
        this.say(rest);
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
      case "continue":
        this.closeOpen();
        this.sink.signal({ type: "continue" });
        return;
      case "wait":
        this.closeOpen();
        this.sink.signal({ type: "wait" });
        return;
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
        const id = attrs.id ? this.uniqueId(attrs.id) : this.freshId(attrs.name);
        this.sink.signal({ type: "figure", id, column: num(attrs.col), name: attrs.name, caption: attrs.caption });
        return;
      }
      case "page": {
        this.closeOpen();
        const page = parseInt(attrs.page ?? "1", 10);
        if (!attrs.source || !Number.isFinite(page) || page < 1) {
          this.sink.signal({ type: "error", message: "page needs source and page", line });
          return;
        }
        const id = attrs.id ? this.uniqueId(attrs.id) : this.freshId(`page_${page}`);
        this.sink.signal({ type: "page", id, column: num(attrs.col), source: attrs.source, page, caption: attrs.caption });
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
        const id = attrs.id ? this.uniqueId(attrs.id) : this.freshId("ann");
        const region = parseRegion(attrs.region, attrs.at);
        if (!region && !attrs.match) {
          this.sink.signal({ type: "error", message: "annotation needs match, region or at", line });
          return;
        }
        const block = this.validate(
          { id, type: "annotation", target: slugId(attrs.target ?? ""), kind: attrs.kind ?? "highlight", match: attrs.match ?? "", region, color: attrs.color },
          line,
        );
        if (block) this.sink.event({ type: "block.add", block });
        return;
      }
      case "focus":
      case "remove": {
        // Same slug as the block was stored under, so "Step-1" finds step_1 and never reaches the board as an invalid id.
        const id = slugId(attrs.id ?? "");
        if (!id) {
          this.sink.signal({ type: "error", message: `${name} needs id`, line });
          return;
        }
        this.sink.event(name === "focus" ? { type: "focus", id } : { type: "block.remove", id });
        return;
      }
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

  /**
   * The id the model asked for. Re-using an id from an earlier turn replaces
   * that block (how the plan gets its check marks); within one turn a repeat
   * gets a suffix. No id at all means a fresh one.
   */
  private uniqueId(id: string | undefined): string {
    if (!id) return this.freshId("block");
    const base = slugId(id) || "block";
    let out = base;
    let n = 2;
    while (this.seen.has(out)) out = `${base}_${n++}`;
    this.seen.add(out);
    return out;
  }

  /** A generated id that clashes with nothing on the board or in this turn. */
  private freshId(hint: string): string {
    const base = slugId(hint) || "block";
    let out = base;
    let n = 2;
    while (this.seen.has(out) || this.existing.has(out)) out = `${base}_${n++}`;
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
