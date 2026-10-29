import type { LessonEvent, TurnState } from "@openstudy/shared";

/**
 * Keeps the board in step with the voice. The tutor's events arrive as fast
 * as the model writes them; a person hears them at speaking speed. The pacer
 * queues everything in order and lets it through like a human at a
 * whiteboard would: a spoken line starts when the previous one has been
 * heard, the writing that follows a line flows while that line is spoken
 * (fast enough to finish with it), diagrams and marks land as soon as the
 * line they belong to starts, and "your turn" waits for the voice to stop.
 */
export type PacedItem = { kind: "event"; event: LessonEvent } | { kind: "turn"; state: TurnState; options?: string[]; auto?: boolean; wait?: boolean };

export interface PacerHooks {
  /** Land an item on the board (state, transcript, caret). */
  apply: (item: PacedItem) => void;
  /** Speak a line and call `done` once it has been heard. Returns a cancel. */
  speak: (text: string, done: () => void) => () => void;
  /** How long a line takes to say, in ms. */
  estimateMs: (text: string) => number;
  now?: () => number;
}

/** Characters per second the pen writes when nothing is being said. */
export const BASE_RATE = 40;
/** Pen speed once the voice has moved on and the writing is behind. */
export const CATCHUP_RATE = 120;
/** Characters the pen may hold ready while idle, so a new line starts at once. */
const IDLE_BUDGET = 12;
export const TICK_MS = 50;
/**
 * The tutor puts a picture up and then talks about it ("See the skater?").
 * While a picture is still being drawn, everything after it waits (the next
 * line, the next blocks, so the camera stays on it), up to this long. When it
 * is drawn the camera comes back to it before the lesson carries on.
 */
export const IMAGE_WAIT_MS = 15000;

interface Speaking {
  ended: boolean;
  startedAt: number;
  estMs: number;
  cancel: () => void;
  guard: ReturnType<typeof setTimeout> | null;
}

export class Pacer {
  private queue: PacedItem[] = [];
  private speaking: Speaking | null = null;
  private paused = false;
  /** Held until the page may play sound (a reload needs a click first). Separate from the student's pause. */
  private held = false;
  /** Pictures placed on the board but not drawn yet, with the time the voice stops waiting for each. */
  private drawing = new Map<string, number>();
  private budget = IDLE_BUDGET;
  private lastTick: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly hooks: PacerHooks) {
    this.now = hooks.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.lastTick = this.now();
  }

  get pending(): number {
    return this.queue.length;
  }

  push(item: PacedItem) {
    // A finished picture does not wait its turn: it fills a frame already on the
    // board, and the speech queued behind it may be waiting for exactly this.
    if (item.kind === "event" && item.event.type === "image.update") {
      const up = item.event;
      const heldForIt = this.drawing.has(up.id);
      this.drawing.delete(up.id);
      // Still queued (a pregenerated picture is ready before its frame lands): fold
      // the result into the queued frame so it lands drawn. Otherwise fill it now.
      const i = this.queue.findIndex((q) => q.kind === "event" && q.event.type === "block.add" && q.event.block.id === up.id);
      const queued = i === -1 ? null : this.queue[i];
      if (queued && queued.kind === "event" && queued.event.type === "block.add" && queued.event.block.type === "image") {
        const block = queued.event.block;
        this.queue[i] = { kind: "event", event: { ...queued.event, block: { ...block, status: up.status, url: up.url ?? block.url } } };
      } else {
        this.hooks.apply(item);
        // The lesson was waiting on this picture: look at it before carrying on.
        if (heldForIt) this.hooks.apply({ kind: "event", event: { type: "focus", id: up.id } });
      }
      this.drain();
      return;
    }
    this.queue.push(item);
    this.drain();
  }

  /** A picture is on the board but still being drawn, and the voice has not given up on it. */
  private waitingForPicture(): boolean {
    if (!this.drawing.size) return false;
    const t = this.now();
    for (const [id, until] of this.drawing) if (until <= t) this.drawing.delete(id);
    return this.drawing.size > 0;
  }

  /** Hold everything where it is: nothing more lands. The voice is held by its owner. */
  pause() {
    this.paused = true;
    this.stopTimer();
  }

  /** Carry on from where the pause left it. */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.lastTick = this.now();
    this.drain();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Hold everything back without touching the student's pause, e.g. until audio is unlocked. */
  hold(on: boolean) {
    if (this.held === on) return;
    this.held = on;
    if (on) this.stopTimer();
    else {
      this.lastTick = this.now();
      this.drain();
    }
  }

  /** Drop everything pending and stop the voice. For interruptions: what was not heard is not shown. */
  discard(): number {
    this.paused = false;
    this.drawing.clear();
    this.endSpeech();
    const dropped = this.queue.length;
    this.queue = [];
    this.budget = IDLE_BUDGET;
    this.stopTimer();
    return dropped;
  }

  /** Everything pending lands now, silently. For reopened boards and new turns. */
  flush() {
    this.paused = false;
    this.drawing.clear();
    this.endSpeech();
    const items = this.queue;
    this.queue = [];
    for (const item of items) this.hooks.apply(item);
    this.budget = IDLE_BUDGET;
    this.stopTimer();
  }

  /** Advance the pen's budget by the time elapsed and release what it covers. */
  tick() {
    const t = this.now();
    const dt = Math.max(0, t - this.lastTick) / 1000;
    // The rate is what was needed at the start of the interval, so a long
    // tick cannot release more than the line's remaining time allows.
    const rate = this.rate(this.lastTick);
    this.lastTick = t;
    this.budget = Math.min(this.budget + dt * rate, this.queue.length ? Number.POSITIVE_INFINITY : IDLE_BUDGET);
    this.drain();
  }

  dispose() {
    this.endSpeech();
    this.stopTimer();
    this.queue = [];
  }

  private rate(t: number): number {
    const s = this.speaking;
    if (!s) return BASE_RATE;
    if (s.ended) return CATCHUP_RATE;
    const left = Math.max(0.25, (s.estMs - (t - s.startedAt)) / 1000);
    return Math.max(BASE_RATE, this.charsBeforeNextSay() / left);
  }

  private charsBeforeNextSay(): number {
    let n = 0;
    for (const item of this.queue) {
      if (item.kind !== "event") continue;
      if (item.event.type === "say") break;
      if (item.event.type === "block.append") n += visibleChars(item.event.html);
    }
    return n;
  }

  private drain() {
    if (this.paused || this.held) return;
    while (this.queue.length) {
      // A picture is still being drawn: nothing after it lands yet.
      if (this.waitingForPicture()) break;
      const item = this.queue[0];
      if (item.kind === "turn") {
        if ((item.state === "waiting" || item.state === "done") && this.speaking && !this.speaking.ended) break;
        this.queue.shift();
        this.hooks.apply(item);
        continue;
      }
      const e = item.event;
      if (e.type === "say") {
        if (this.speaking && !this.speaking.ended) break;
        this.queue.shift();
        this.hooks.apply(item);
        this.startSpeech(e.text);
        continue;
      }
      if (e.type === "block.append") {
        const cost = visibleChars(e.html);
        if (cost > this.budget) break;
        this.budget -= cost;
        this.queue.shift();
        this.hooks.apply(item);
        continue;
      }
      this.queue.shift();
      this.hooks.apply(item);
      if (e.type === "block.add" && e.block.type === "image" && e.block.status === "pending") this.drawing.set(e.block.id, this.now() + IMAGE_WAIT_MS);
    }
    if (this.queue.length) this.startTimer();
    else this.stopTimer();
  }

  private startSpeech(text: string) {
    this.endSpeech();
    const estMs = this.hooks.estimateMs(text);
    const s: Speaking = { ended: false, startedAt: this.now(), estMs, cancel: () => {}, guard: null };
    this.speaking = s;
    let finished = false;
    const done = () => {
      // A line that was cut off (discard, flush, a newer line) reports back late
      // when its voice is stopped; that must not release the next line.
      if (finished || this.speaking !== s) return;
      finished = true;
      s.ended = true;
      if (s.guard) clearTimeout(s.guard);
      this.drain();
    };
    s.cancel = this.hooks.speak(text, done);
    // A synthesiser that never reports back must not freeze the lesson (while paused, it waits).
    const arm = () => {
      s.guard = setTimeout(() => (this.paused || this.held ? arm() : done()), estMs * 2.5 + 3000);
    };
    arm();
  }

  private endSpeech() {
    const s = this.speaking;
    if (!s) return;
    if (s.guard) clearTimeout(s.guard);
    if (!s.ended) s.cancel();
    s.ended = true;
    this.speaking = null;
  }

  private startTimer() {
    if (this.timer) return;
    this.lastTick = this.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

/** Characters a reader sees in a streamed html chunk. Tags cost nothing. */
export function visibleChars(html: string): number {
  return html.replace(/<[^>]*>/g, "").length;
}

/** Rough speaking time at a given synthesiser rate: about 170 words a minute at 1x. */
export function estimateSpeechMs(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words * 60000) / (170 * Math.max(0.5, rate)) + 250;
}

/** A breath after a @continue turn before the lesson carries on, even when nothing was written. */
export const READ_BASE_MS = 800;
/** Reading time per visible character the turn wrote, on top of the narration already heard. */
export const READ_MS_PER_CHAR = 12;
/** A look of its own for each diagram, picture, page or model. */
export const READ_MS_PER_VISUAL = 2500;
export const READ_MAX_MS = 10000;

/** What a turn put on the board. */
export interface TurnLoad {
  chars: number;
  visuals: number;
}

/**
 * How long to rest after a @continue turn: the narration has been heard, but
 * the board is what the student reads, and reading takes longer than
 * listening. The student can always go on sooner.
 */
export function readingPauseMs(load: TurnLoad): number {
  return Math.min(READ_MAX_MS, READ_BASE_MS + load.chars * READ_MS_PER_CHAR + load.visuals * READ_MS_PER_VISUAL);
}
