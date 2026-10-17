"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ServerMessageSchema, applyEvent, emptyBoard, type BoardState, type ClientMessage, type LessonEvent, type TurnState } from "@openstudy/shared";
import { entryFromEvent, pushEntry, type TranscriptEntry } from "@/lib/transcript";

export interface StartOptions {
  topic?: string;
  materials?: { name: string; text: string }[];
  model?: string;
  /** Saved board id to reopen and continue. */
  resume?: string;
}

export interface LiveOptions {
  /**
   * Called for each spoken line with its index in the turn. Return true if
   * speech will play it: the board then waits for `releaseSay(index)`.
   * Return false (or omit) and the board paces itself by reading time.
   */
  onSay?: (text: string, index: number) => boolean | void;
}

export const TUTOR_HTTP = process.env.NEXT_PUBLIC_TUTOR_HTTP ?? "http://localhost:8787";
const WS_URL = process.env.NEXT_PUBLIC_TUTOR_WS ?? "ws://localhost:8787/ws";

/** Reading-time estimate for a spoken line when no voice is playing. */
const sayMs = (text: string) => Math.max(1100, Math.min(9000, text.length * 52));
/** Handwriting speed for streamed html when pacing. */
const APPEND_MS_PER_CHAR = 18;

interface Pending {
  sayIndex: number;
  event: LessonEvent;
}

/**
 * A live lesson over the tutor server's websocket. Board events are paced
 * to the narration: everything the tutor writes after a spoken line waits
 * until that line starts playing, so writing, highlights and speech stay
 * together the way they do with a person at a whiteboard.
 */
export function useLiveSession(opts: LiveOptions = {}) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const [state, setState] = useState<BoardState>(() => emptyBoard());
  const [turn, setTurn] = useState<TurnState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ brain: string; model: string; id: string; title: string } | null>(null);
  const [writingId, setWritingId] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const writeTimer = useRef<number | null>(null);
  const pending = useRef<StartOptions | null>(null);

  // Pacing state for the current turn.
  const queue = useRef<Pending[]>([]);
  const sayCount = useRef(0); // spoken lines received this turn
  const released = useRef(0); // spoken lines whose board actions are shown
  const heard = useRef(0); // spoken lines that started playing (for interrupts)
  const timers = useRef<number[]>([]);
  const draining = useRef(false);
  const turnEnded = useRef<TurnState | null>(null);

  const apply = useCallback((e: LessonEvent) => {
    setState((s) => applyEvent(s, e));
    const entry = entryFromEvent(e);
    if (entry) setTranscript((t) => pushEntry(t, entry));
    if (e.type === "block.append" || (e.type === "block.add" && e.block.type === "html")) {
      const id = e.type === "block.append" ? e.id : e.block.id;
      setWritingId(id);
      if (writeTimer.current) window.clearTimeout(writeTimer.current);
      writeTimer.current = window.setTimeout(() => setWritingId(null), 700);
    }
  }, []);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  /** Show queued actions up to and including spoken line `index`, writing html at hand speed. */
  const drain = useCallback(() => {
    if (draining.current) return;
    draining.current = true;
    let delay = 0;
    while (queue.current.length && queue.current[0].sayIndex <= released.current) {
      const item = queue.current.shift()!;
      const e = item.event;
      const run = () => apply(e);
      if (e.type === "block.append") {
        delay += Math.min(600, e.html.replace(/<[^>]+>/g, "").length * APPEND_MS_PER_CHAR);
        timers.current.push(window.setTimeout(run, delay));
      } else if (delay > 0) timers.current.push(window.setTimeout(run, delay));
      else run();
    }
    draining.current = false;
    if (turnEnded.current && queue.current.length === 0) {
      const t = turnEnded.current;
      turnEnded.current = null;
      timers.current.push(window.setTimeout(() => setTurn(t), delay));
    }
  }, [apply]);

  /** The voice (or the reading timer) has reached spoken line `index`. */
  const releaseSay = useCallback(
    (index: number) => {
      heard.current = Math.max(heard.current, index);
      released.current = Math.max(released.current, index);
      drain();
    },
    [drain],
  );

  const resetTurn = useCallback(() => {
    clearTimers();
    queue.current = [];
    sayCount.current = 0;
    released.current = 0;
    heard.current = 0;
    turnEnded.current = null;
  }, []);

  const handleEvent = useCallback(
    (e: LessonEvent) => {
      if (e.type === "image.update" || e.type === "block.remove") {
        // Never gate these: a picture landing late or a removal must apply as is.
        apply(e);
        return;
      }
      if (e.type === "say") {
        sayCount.current += 1;
        const index = sayCount.current;
        queue.current.push({ sayIndex: index, event: e });
        const voiced = optsRef.current.onSay?.(e.text, index);
        if (!voiced) {
          // No voice: pace by reading time, chained after the previous line.
          const prev = index - 1;
          const wait = prev === 0 ? 0 : sayMs(e.text);
          const schedule = () => releaseSay(index);
          if (prev === 0 || released.current >= prev) timers.current.push(window.setTimeout(schedule, prev === 0 ? 0 : sayMs(e.text)));
          else {
            // chain: release after the previous line's reading time elapses
            const check = () => {
              if (released.current >= prev) timers.current.push(window.setTimeout(schedule, wait));
              else timers.current.push(window.setTimeout(check, 200));
            };
            check();
          }
        }
        return;
      }
      queue.current.push({ sayIndex: sayCount.current, event: e });
      drain();
    },
    [apply, drain, releaseSay],
  );

  const send = useCallback((m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);

  useEffect(() => {
    const sock = new WebSocket(WS_URL);
    ws.current = sock;
    sock.onopen = () => {
      setConnected(true);
      setError(null);
      if (pending.current) {
        const o = pending.current;
        sock.send(JSON.stringify({ type: "start", topic: o.topic ?? "", materials: o.materials ?? [], model: o.model, resume: o.resume }));
        pending.current = null;
      }
    };
    sock.onclose = () => setConnected(false);
    sock.onerror = () => setError("Can't reach the tutor server. Is `pnpm dev:tutor` running?");
    sock.onmessage = (ev) => {
      const parsed = ServerMessageSchema.safeParse(JSON.parse(ev.data));
      if (!parsed.success) return;
      const m = parsed.data;
      switch (m.type) {
        case "session":
          setInfo({ brain: m.brain, model: m.model, id: m.id, title: m.title });
          setState((s) => ({ ...s, title: m.title }));
          break;
        case "history": {
          let board = emptyBoard();
          let list: TranscriptEntry[] = [];
          for (const row of m.log) {
            if (row.kind === "event") {
              board = applyEvent(board, row.event);
              const entry = entryFromEvent(row.event);
              if (entry) list = pushEntry(list, entry);
            } else list = [...list, { kind: "user", text: row.text }];
          }
          setState((s) => ({ ...board, title: s.title || board.title, focusId: null }));
          setTranscript(list);
          break;
        }
        case "event":
          handleEvent(m.event);
          break;
        case "turn":
          if (m.state === "thinking") {
            resetTurn();
            setTurn("thinking");
          } else if (m.state === "speaking") setTurn("speaking");
          else if (queue.current.length) turnEnded.current = m.state; // wait for the board to catch up
          else setTurn(m.state);
          break;
        case "error":
          setError(m.message);
          break;
        case "debug":
          if (process.env.NODE_ENV !== "production") console.debug("[tutor]", m.text);
          break;
      }
    };
    return () => {
      sock.close();
      clearTimers();
    };
  }, [handleEvent, resetTurn]);

  const start = useCallback(
    (o: StartOptions) => {
      setState(emptyBoard(o.topic ?? ""));
      setTranscript([]);
      setError(null);
      resetTurn();
      const msg: ClientMessage = { type: "start", topic: o.topic ?? "", materials: o.materials ?? [], model: o.model, resume: o.resume };
      if (ws.current?.readyState === WebSocket.OPEN) send(msg);
      else pending.current = o;
    },
    [send, resetTurn],
  );

  const say = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setTranscript((list) => [...list, { kind: "user", text: t }]);
      send({ type: "user", text: t });
    },
    [send],
  );

  /** Stop the tutor. Whatever was not yet shown is dropped here and on the server. */
  const interrupt = useCallback(() => {
    const h = heard.current;
    clearTimers();
    queue.current = [];
    turnEnded.current = null;
    send({ type: "interrupt", heard: h });
  }, [send]);

  return { state, turn, transcript, connected, error, info, writingId, start, say, interrupt, releaseSay };
}
