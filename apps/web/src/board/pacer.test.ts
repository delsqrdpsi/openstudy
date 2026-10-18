import { describe, expect, it, vi } from "vitest";
import type { LessonEvent } from "@openstudy/shared";
import { Pacer, estimateSpeechMs, visibleChars, type PacedItem } from "./pacer";

function setup() {
  let t = 0;
  const applied: PacedItem[] = [];
  const spoken: { text: string; done: () => void }[] = [];
  const pacer = new Pacer({
    apply: (i) => applied.push(i),
    speak: (text, done) => {
      spoken.push({ text, done });
      return () => {};
    },
    estimateMs: () => 1000,
    now: () => t,
  });
  const advance = (ms: number) => {
    t += ms;
    pacer.tick();
  };
  const ev = (event: LessonEvent): PacedItem => ({ kind: "event", event });
  return { pacer, applied, spoken, advance, ev };
}

describe("Pacer", () => {
  it("speaks one line at a time and holds the next until the first is heard", () => {
    const { pacer, applied, spoken, ev } = setup();
    pacer.push(ev({ type: "say", text: "First line." }));
    pacer.push(ev({ type: "say", text: "Second line." }));
    expect(spoken.map((s) => s.text)).toEqual(["First line."]);
    expect(applied).toHaveLength(1);
    spoken[0].done();
    expect(spoken.map((s) => s.text)).toEqual(["First line.", "Second line."]);
    expect(applied).toHaveLength(2);
    pacer.dispose();
  });

  it("writes streamed text at pen speed, fast enough to finish with the line", () => {
    const { pacer, applied, spoken, advance, ev } = setup();
    pacer.push(ev({ type: "say", text: "A line." }));
    pacer.push(ev({ type: "block.add", block: { type: "html", id: "b", col: 0, html: "" } as unknown as Extract<LessonEvent, { type: "block.add" }>["block"] }));
    // 200 characters in 1 second of speech: needs 200 chars/s, above the base rate.
    for (let i = 0; i < 20; i++) pacer.push(ev({ type: "block.append", id: "b", html: "x".repeat(10) }));
    const appended = () => applied.filter((i) => i.kind === "event" && i.event.type === "block.append").length;
    expect(appended()).toBeLessThan(20);
    advance(500);
    const half = appended();
    expect(half).toBeGreaterThan(5);
    expect(half).toBeLessThan(20);
    advance(600);
    expect(appended()).toBe(20);
    expect(spoken).toHaveLength(1);
    pacer.dispose();
  });

  it("lets 'your turn' wait for the voice, and flush lands everything at once", () => {
    const { pacer, applied, spoken, ev } = setup();
    pacer.push(ev({ type: "say", text: "Question?" }));
    pacer.push({ kind: "turn", state: "waiting", options: ["a", "b"] });
    expect(applied.some((i) => i.kind === "turn")).toBe(false);
    spoken[0].done();
    expect(applied.some((i) => i.kind === "turn")).toBe(true);

    pacer.push(ev({ type: "say", text: "More." }));
    pacer.push(ev({ type: "say", text: "And more." }));
    pacer.push({ kind: "turn", state: "waiting" });
    const before = applied.length;
    pacer.flush();
    expect(applied.length).toBe(before + 2);
    expect(spoken).toHaveLength(2); // the third line was never spoken
    pacer.dispose();
  });

  it("moves on if the synthesiser never calls back", () => {
    vi.useFakeTimers();
    const { pacer, spoken, ev } = setup();
    pacer.push(ev({ type: "say", text: "Lost line." }));
    pacer.push(ev({ type: "say", text: "Next line." }));
    expect(spoken).toHaveLength(1);
    vi.advanceTimersByTime(1000 * 2.5 + 3001);
    expect(spoken).toHaveLength(2);
    pacer.dispose();
    vi.useRealTimers();
  });
});

describe("Pacer pause", () => {
  it("holds lines and turn changes while paused, and carries on after resume", () => {
    const { pacer, applied, spoken, ev } = setup();
    pacer.push(ev({ type: "say", text: "One." }));
    pacer.pause();
    spoken[0].done();
    pacer.push(ev({ type: "say", text: "Two." }));
    pacer.push({ kind: "turn", state: "waiting" });
    expect(spoken).toHaveLength(1);
    expect(applied.some((i) => i.kind === "turn")).toBe(false);
    pacer.resume();
    expect(spoken.map((x) => x.text)).toEqual(["One.", "Two."]);
    spoken[1].done();
    expect(applied.some((i) => i.kind === "turn")).toBe(true);
    pacer.dispose();
  });
});

describe("helpers", () => {
  it("counts only visible characters", () => {
    expect(visibleChars("<b>hi</b> there")).toBe(8);
    expect(visibleChars("<br/>")).toBe(0);
  });
  it("estimates speech time from word count and rate", () => {
    expect(estimateSpeechMs("one two three four five six seven eight nine ten", 1)).toBeGreaterThan(3000);
    expect(estimateSpeechMs("one two", 2)).toBeLessThan(estimateSpeechMs("one two", 1));
  });
});
