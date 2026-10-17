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
export type PacedItem = { kind: "event"; event: LessonEvent } | { kind: "turn"; state: TurnState; options?: string[] };

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
    this.queue.push(item);
    this.drain();
  }

  /** Everything pending lands now, silently. For interruptions and reopened boards. */
  flush() {
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
    while (this.queue.length) {
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
      if (finished) return;
      finished = true;
      s.ended = true;
      if (s.guard) clearTimeout(s.guard);
      this.drain();
    };
    s.cancel = this.hooks.speak(text, done);
    // A synthesiser that never reports back must not freeze the lesson.
    s.guard = setTimeout(done, estMs * 2.5 + 3000);
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
