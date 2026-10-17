"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ServerMessageSchema, applyEvent, emptyBoard, type BoardState, type ClientMessage, type TurnState } from "@openstudy/shared";
import { entryFromEvent, pushEntry, type TranscriptEntry } from "@/lib/transcript";
import { Pacer, estimateSpeechMs, type PacedItem } from "./pacer";

export interface StartOptions {
  topic?: string;
  materials?: { name: string; text: string }[];
  model?: string;
  /** Saved board id to reopen and continue. */
  resume?: string;
}

export const TUTOR_HTTP = process.env.NEXT_PUBLIC_TUTOR_HTTP ?? "http://localhost:8787";
const WS_URL = process.env.NEXT_PUBLIC_TUTOR_WS ?? "ws://localhost:8787/ws";

export interface Speaker {
  /** Say a line; call `done` when it has been heard. Return false to let the session keep time itself. */
  speak: (text: string, done: () => void) => boolean;
  /** How long a line takes to say, in ms. */
  estimateMs: (text: string) => number;
}

/**
 * A live lesson over the tutor server's websocket. Board events and turn
 * changes go through a pacer so the board keeps step with the voice.
 */
export function useLiveSession(opts: { speaker?: Speaker } = {}) {
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
  const pacer = useRef<Pacer | null>(null);

  const land = useCallback((item: PacedItem) => {
    if (item.kind === "turn") {
      setTurn(item.state);
      setOptions(item.state === "waiting" ? (item.options ?? []) : []);
      return;
    }
    const e = item.event;
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

  const getPacer = useCallback(() => {
    if (!pacer.current) {
      pacer.current = new Pacer({
        apply: land,
        speak: (text, done) => {
          const sp = optsRef.current.speaker;
          if (sp?.speak(text, done)) return () => {}; // the voice reports back through `done`
          const t = window.setTimeout(done, sp?.estimateMs(text) ?? estimateSpeechMs(text));
          return () => window.clearTimeout(t);
        },
        estimateMs: (text) => optsRef.current.speaker?.estimateMs(text) ?? estimateSpeechMs(text),
      });
    }
    return pacer.current;
  }, [land]);
  useEffect(() => () => pacer.current?.dispose(), []);

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
          getPacer().flush();
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
          getPacer().push({ kind: "event", event: m.event });
          break;
        case "turn":
          if (m.state === "thinking") {
            // A new turn: the student spoke, so whatever was still pending lands now.
            getPacer().flush();
            land({ kind: "turn", state: m.state });
          } else getPacer().push({ kind: "turn", state: m.state, options: m.options });
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
  }, [getPacer, land]);

  const start = useCallback(
    (opts: StartOptions) => {
      pacer.current?.flush();
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
      pacer.current?.flush();
      setTranscript((list) => [...list, { kind: "user", text: t }]);
      setOptions([]);
      send({ type: "user", text: t });
    },
    [send],
  );

  const interrupt = useCallback(() => {
    pacer.current?.flush();
    send({ type: "interrupt" });
  }, [send]);

  return { state, turn, options, transcript, connected, error, info, writingId, start, say, interrupt };
}
