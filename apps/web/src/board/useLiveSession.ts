"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_USER_TEXT, ServerMessageSchema, applyEvent, emptyBoard, type BoardState, type ClientMessage, type TurnState, type Usage } from "@openstudy/shared";
import { entryFromEvent, pushEntry, type TranscriptEntry } from "@/lib/transcript";
import { Pacer, estimateSpeechMs, type PacedItem } from "./pacer";
import { clipText, reconnectDelay } from "./liveProtocol";

export interface StartOptions {
  topic?: string;
  materials?: { name: string; text: string }[];
  model?: string;
  /** Saved board id to reopen and continue. */
  resume?: string;
  /** Client-chosen id for a new board; if it already exists the server reopens it. */
  id?: string;
  /** Prepared source ids (the student's folder) to teach from. */
  sources?: string[];
}

export const TUTOR_HTTP = process.env.NEXT_PUBLIC_TUTOR_HTTP ?? "http://localhost:8787";
const WS_URL = process.env.NEXT_PUBLIC_TUTOR_WS ?? "ws://localhost:8787/ws";

/** Longest topic the server takes in a `start`. */
const MAX_TOPIC = 2000;

/** Where the connection to the tutor stands. */
export type LinkStatus = "connecting" | "open" | "reconnecting" | "superseded";

/** The tutor offering to do something bigger that needs the student's go-ahead. */
export interface Offer {
  id: string;
  kind: "build_figure";
  concept: string;
  detail: string;
}

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
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ brain: string; model: string; id: string; title: string } | null>(null);
  const [writingId, setWritingId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const writeTimer = useRef<number | null>(null);
  const pacer = useRef<Pacer | null>(null);
  /** Spoken lines of the current turn that reached the student. */
  const heard = useRef(0);
  /** Pending auto-continue after a @continue turn has been heard. */
  const autoTimer = useRef<number | null>(null);
  /** The start for this lesson, kept to resend if the connection drops before the server confirms it. */
  const startMsg = useRef<ClientMessage | null>(null);
  /** The start has gone out at least once: a resend is a reconnect, so it is quiet. */
  const startSent = useRef(false);
  /** The server confirmed the board (a `session` message): reconnects resume it. */
  const confirmed = useRef(false);
  const boardId = useRef<string | null>(null);
  /** A start is on its way: hold the student's messages until the server has caught up (history or a turn). */
  const syncing = useRef(false);
  /** What the student said while the connection was down or catching up, sent once it is back. */
  const outbox = useRef<string[]>([]);
  /** After an interrupt, board events still in flight are dropped until the server's answering `turn`. */
  const gated = useRef(false);
  /** Another tab owns the lesson, or this one is gone: never reconnect. */
  const stopped = useRef(false);

  const land = useCallback((item: PacedItem) => {
    if (item.kind === "turn") {
      if (item.state === "thinking") heard.current = 0;
      setTurn(item.state);
      setOptions(item.state === "waiting" ? (item.options ?? []) : []);
      if (item.state === "waiting" && item.auto) {
        // The tutor is not waiting for an answer: once the narration has played, keep going.
        if (autoTimer.current) window.clearTimeout(autoTimer.current);
        autoTimer.current = window.setTimeout(() => {
          autoTimer.current = null;
          if (ws.current?.readyState === WebSocket.OPEN && !syncing.current) ws.current.send(JSON.stringify({ type: "continue" }));
        }, 600);
      }
      return;
    }
    const e = item.event;
    if (e.type === "say") heard.current += 1;
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

  /** Send what the student said while the line was down, now that the server has the lesson again. */
  const flushOutbox = useCallback(() => {
    syncing.current = false;
    const sock = ws.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    const texts = outbox.current;
    outbox.current = [];
    for (const text of texts) sock.send(JSON.stringify({ type: "user", text } satisfies ClientMessage));
  }, []);

  useEffect(() => {
    let alive = true;
    let attempt = 0;
    let everOpened = false;
    let retry: number | null = null;

    const connect = () => {
      retry = null;
      const sock = new WebSocket(WS_URL);
      ws.current = sock;
      // Every handler checks it still belongs to the current socket: a stale one's late events are ignored.
      sock.onopen = () => {
        if (ws.current !== sock) return;
        everOpened = true;
        setStatus("open");
        setError(null);
        // Pick the lesson back up: resume the confirmed board quietly, or resend the start that never got an answer.
        let msg: ClientMessage | null = null;
        if (confirmed.current && boardId.current) msg = { type: "start", topic: "", materials: [], sources: [], resume: boardId.current, quiet: true };
        else if (startMsg.current) msg = startSent.current ? { ...startMsg.current, quiet: true } as ClientMessage : startMsg.current;
        if (msg) {
          syncing.current = true;
          startSent.current = true;
          sock.send(JSON.stringify(msg));
        }
      };
      sock.onclose = () => {
        if (ws.current !== sock) return;
        ws.current = null;
        syncing.current = false;
        if (autoTimer.current) window.clearTimeout(autoTimer.current);
        autoTimer.current = null;
        if (!alive || stopped.current) return;
        setStatus(everOpened ? "reconnecting" : "connecting");
        retry = window.setTimeout(connect, reconnectDelay(attempt++));
      };
      sock.onerror = () => {
        if (ws.current !== sock || everOpened) return;
        setError("Can't reach the tutor server. Is `pnpm dev:tutor` running?");
      };
      sock.onmessage = (ev) => {
        if (ws.current !== sock) return;
        let raw: unknown;
        try {
          raw = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        const parsed = ServerMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        // The backoff resets once the server actually talks, not on open: one that accepts and drops at once still backs off.
        attempt = 0;
        const m = parsed.data;
        switch (m.type) {
          case "usage":
            setUsage(m.usage);
            break;
          case "session":
            confirmed.current = true;
            boardId.current = m.id;
            setInfo({ brain: m.brain, model: m.model, id: m.id, title: m.title });
            setState((s) => ({ ...s, title: m.title }));
            break;
          case "history": {
            // Replay a saved lesson: board events and what the student typed, in order. It replaces
            // what is on screen (a reconnect replays everything again), never adds to it.
            getPacer().discard();
            gated.current = false;
            heard.current = 0;
            let board = emptyBoard();
            let list: TranscriptEntry[] = [];
            for (const row of m.log) {
              if (row.kind === "event") {
                board = applyEvent(board, row.event);
                const entry = entryFromEvent(row.event);
                if (entry) list = pushEntry(list, entry);
              } else list = [...list, { kind: "user", text: row.text }];
            }
            // Still unsent: the server has not seen these yet, so keep them on screen.
            for (const text of outbox.current) list = [...list, { kind: "user", text }];
            setState((s) => ({ ...board, title: s.title || board.title, focusId: null }));
            setTranscript(list);
            setWritingId(null);
            setOffer(null);
            flushOutbox();
            break;
          }
          case "event":
            // Interrupted: what was still on its way belongs to the turn the student stopped.
            if (gated.current && m.event.type !== "block.remove") break;
            getPacer().push({ kind: "event", event: m.event });
            break;
          case "turn":
            gated.current = false;
            if (syncing.current) flushOutbox();
            if (m.state === "thinking") {
              // A new turn: the student spoke, so whatever was still pending lands now.
              getPacer().flush();
              land({ kind: "turn", state: m.state });
            } else getPacer().push({ kind: "turn", state: m.state, options: m.options, auto: m.auto });
            break;
          case "offer":
            // One question at a time: a newer offer replaces an unanswered one.
            setOffer({ id: m.id, kind: m.kind, concept: m.concept, detail: m.detail });
            break;
          case "error":
            if (m.code === "superseded") {
              // The lesson moved to another tab. Go quiet and stay disconnected.
              stopped.current = true;
              getPacer().discard();
              if (autoTimer.current) window.clearTimeout(autoTimer.current);
              autoTimer.current = null;
              outbox.current = [];
              setStatus("superseded");
              setTurn("idle");
              setOffer(null);
              setError("This lesson is open in another tab.");
              sock.close();
            } else setError(m.message);
            break;
          case "debug":
            if (process.env.NODE_ENV !== "production") console.debug("[tutor]", m.text);
            break;
        }
      };
    };

    connect();
    return () => {
      alive = false;
      if (retry) window.clearTimeout(retry);
      const sock = ws.current;
      ws.current = null;
      sock?.close();
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
      autoTimer.current = null;
      if (writeTimer.current) window.clearTimeout(writeTimer.current);
    };
  }, [getPacer, land, flushOutbox]);

  const start = useCallback(
    (opts: StartOptions) => {
      pacer.current?.flush();
      setState(emptyBoard(opts.topic ?? ""));
      setTranscript([]);
      setError(null);
      setOffer(null);
      const msg: ClientMessage = {
        type: "start",
        topic: clipText(opts.topic ?? "", MAX_TOPIC),
        materials: opts.materials ?? [],
        model: opts.model,
        resume: opts.resume,
        id: opts.id,
        sources: opts.sources ?? [],
      };
      startMsg.current = msg;
      startSent.current = false;
      confirmed.current = false;
      boardId.current = opts.id ?? opts.resume ?? null;
      outbox.current = [];
      gated.current = false;
      const sock = ws.current;
      if (sock?.readyState === WebSocket.OPEN) {
        syncing.current = true;
        startSent.current = true;
        sock.send(JSON.stringify(msg));
      }
      // Otherwise the socket sends it as soon as it opens.
    },
    [],
  );

  const say = useCallback((text: string) => {
    const t = clipText(text, MAX_USER_TEXT);
    if (!t || stopped.current) return;
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    autoTimer.current = null;
    pacer.current?.flush();
    setTranscript((list) => [...list, { kind: "user", text: t }]);
    setOptions([]);
    // While the line is down (or a resume is catching up) it waits in the outbox rather than being dropped.
    const sock = ws.current;
    if (sock?.readyState === WebSocket.OPEN && !syncing.current) sock.send(JSON.stringify({ type: "user", text: t } satisfies ClientMessage));
    else outbox.current.push(t);
  }, []);

  /** Switch the tutor's model from the next turn on. */
  const setModel = useCallback((model: string) => send({ type: "model", model }), [send]);

  /**
   * Stop the tutor. Lines not yet heard are dropped here and taken off the
   * saved board by the server, which answers with removals and one `turn`.
   * Call it before stopping the voice, so the voice's end-of-line cannot
   * start the next queued line.
   */
  const interrupt = useCallback(() => {
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    autoTimer.current = null;
    pacer.current?.discard();
    gated.current = true;
    setTurn("waiting");
    setOptions([]);
    send({ type: "interrupt", heard: heard.current });
  }, [send]);

  /** Answer the tutor's offer and put the card away. */
  const answerOffer = useCallback(
    (accept: boolean) => {
      if (offer) send({ type: "offer.answer", id: offer.id, accept });
      setOffer(null);
    },
    [offer, send],
  );

  /** Hold the board where it is; the caller pauses the voice. */
  const pause = useCallback(() => getPacer().pause(), [getPacer]);
  const resume = useCallback(() => getPacer().resume(), [getPacer]);
  /** Hold the lesson back without it counting as a pause (until sound is allowed). */
  const hold = useCallback((on: boolean) => getPacer().hold(on), [getPacer]);

  const connected = status === "open";
  const superseded = status === "superseded";
  return { state, turn, options, transcript, connected, status, superseded, error, info, writingId, usage, offer, start, say, interrupt, answerOffer, setModel, pause, resume, hold };
}
