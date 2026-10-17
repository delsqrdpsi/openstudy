"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ServerMessageSchema, applyEvent, emptyBoard, type BoardState, type ClientMessage, type TurnState } from "@openstudy/shared";
import { entryFromEvent, pushEntry, type TranscriptEntry } from "@/lib/transcript";

export interface StartOptions {
  topic?: string;
  materials?: { name: string; text: string }[];
  model?: string;
  /** Saved board id to reopen and continue. */
  resume?: string;
}

export const TUTOR_HTTP = process.env.NEXT_PUBLIC_TUTOR_HTTP ?? "http://localhost:8787";
const WS_URL = process.env.NEXT_PUBLIC_TUTOR_WS ?? "ws://localhost:8787/ws";

/** A live lesson over the tutor server's websocket. */
export function useLiveSession(opts: { onSay?: (text: string) => void } = {}) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);
  const [state, setState] = useState<BoardState>(() => emptyBoard());
  const [turn, setTurn] = useState<TurnState>("idle");
  const [options, setOptions] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ brain: string; model: string; id: string; title: string } | null>(null);
  const [writingId, setWritingId] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const writeTimer = useRef<number | null>(null);
  const pending = useRef<StartOptions | null>(null);

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
          // Replay a saved lesson: board events and what the student typed, in order.
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
        case "event": {
          setState((s) => applyEvent(s, m.event));
          const entry = entryFromEvent(m.event);
          if (entry) setTranscript((t) => pushEntry(t, entry));
          if (m.event.type === "say") optsRef.current.onSay?.(m.event.text);
          if (m.event.type === "block.append" || (m.event.type === "block.add" && m.event.block.type === "html")) {
            const id = m.event.type === "block.append" ? m.event.id : m.event.block.id;
            setWritingId(id);
            if (writeTimer.current) window.clearTimeout(writeTimer.current);
            writeTimer.current = window.setTimeout(() => setWritingId(null), 700);
          }
          break;
        }
        case "turn":
          setTurn(m.state);
          setOptions(m.state === "waiting" ? (m.options ?? []) : []);
          break;
        case "error":
          setError(m.message);
          break;
        case "debug":
          if (process.env.NODE_ENV !== "production") console.debug("[tutor]", m.text);
          break;
      }
    };
    return () => sock.close();
  }, []);

  const start = useCallback(
    (opts: StartOptions) => {
      setState(emptyBoard(opts.topic ?? ""));
      setTranscript([]);
      setError(null);
      const msg: ClientMessage = { type: "start", topic: opts.topic ?? "", materials: opts.materials ?? [], model: opts.model, resume: opts.resume };
      if (ws.current?.readyState === WebSocket.OPEN) send(msg);
      else pending.current = opts;
    },
    [send],
  );

  const say = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setTranscript((list) => [...list, { kind: "user", text: t }]);
      setOptions([]);
      send({ type: "user", text: t });
    },
    [send],
  );

  const interrupt = useCallback(() => send({ type: "interrupt" }), [send]);

  return { state, turn, options, transcript, connected, error, info, writingId, start, say, interrupt };
}
