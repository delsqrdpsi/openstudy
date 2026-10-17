"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardState, LessonEvent, LessonFixture } from "@openstudy/shared";
import { applyEvent, emptyBoard } from "@openstudy/shared";

/**
 * Plays a scripted lesson against the board reducer with real timing. This
 * is the stand-in for the tutor server: same events, no model.
 */
export function usePlayer(fixture: LessonFixture) {
  const [state, setState] = useState<BoardState>(() => emptyBoard(fixture.title));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState(0); // ms into the lesson
  const [writingId, setWritingId] = useState<string | null>(null);
  const idx = useRef(0);
  const clock = useRef({ t: 0, wall: 0 });
  const writeTimer = useRef<number | null>(null);
  const total = fixture.events.length ? fixture.events[fixture.events.length - 1].at + 1500 : 0;

  const reset = useCallback(() => {
    idx.current = 0;
    clock.current = { t: 0, wall: performance.now() };
    setState(emptyBoard(fixture.title));
    setPosition(0);
    setWritingId(null);
  }, [fixture.title]);

  useEffect(() => {
    if (!playing) return;
    clock.current.wall = performance.now();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      clock.current.t += (now - clock.current.wall) * speed;
      clock.current.wall = now;
      const t = clock.current.t;
      const due: LessonEvent[] = [];
      while (idx.current < fixture.events.length && fixture.events[idx.current].at <= t) {
        due.push(fixture.events[idx.current].event);
        idx.current += 1;
      }
      if (due.length) {
        setState((s) => due.reduce(applyEvent, s));
        let writeId: string | null = null;
        for (const e of due) {
          if (e.type === "block.append") writeId = e.id;
          else if (e.type === "block.add" && e.block.type === "html") writeId = e.block.id;
        }
        if (writeId) {
          setWritingId(writeId);
          if (writeTimer.current) window.clearTimeout(writeTimer.current);
          writeTimer.current = window.setTimeout(() => setWritingId(null), 700 / speed);
        }
      }
      setPosition(t);
      if (idx.current >= fixture.events.length && t > total) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, fixture.events, total]);

  /** Jump straight to the end: the whole board, no waiting. */
  const finish = useCallback(() => {
    setPlaying(false);
    setState(fixture.events.map((e) => e.event).reduce(applyEvent, emptyBoard(fixture.title)));
    idx.current = fixture.events.length;
    clock.current.t = total;
    setPosition(total);
    setWritingId(null);
  }, [fixture, total]);

  return { state, playing, setPlaying, speed, setSpeed, position, total, reset, finish, writingId };
}
