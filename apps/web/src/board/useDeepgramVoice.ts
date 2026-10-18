"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { estimateSpeechMs } from "./pacer";
import { TUTOR_HTTP } from "./useLiveSession";
import type { VoiceApi, VoiceConfig, VoiceOptions } from "./useVoice";
import { concatBytes, pcm16ToFloat, pickRecorderMime, readTranscript } from "./deepgram";

/**
 * Hosted voice: Aura-2 for the tutor, Nova for the student, both through
 * the tutor server. Lines are fetched as streamed PCM and played through
 * the Web Audio API as they arrive, so speech starts within a few hundred
 * milliseconds and stops the instant the student interrupts. The mic goes
 * up as MediaRecorder chunks over a websocket; transcripts come back live.
 */
const STT_URL = `${TUTOR_HTTP.replace(/^http/, "ws")}/stt`;

interface Playing {
  text: string;
  words: number;
  abort: AbortController;
  sources: AudioBufferSourceNode[];
  startAt: number;
  /** Seconds of audio scheduled so far. */
  scheduled: number;
  streamed: boolean;
  onEnd?: () => void;
  finished: boolean;
  /** Audio clock time at which the last scheduled sample ends, once streamed. */
  endAt: number;
  finishTimer: number | null;
}

export function useDeepgramVoice(opts: VoiceOptions, cfg: Extract<VoiceConfig, { provider: "deepgram" }> | null): VoiceApi {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);
  const enabled = !!cfg;
  const sampleRate = cfg?.sampleRate ?? 24000;

  const [supported, setSupported] = useState({ tts: false, stt: false });
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState<VoiceApi["caption"]>(null);
  const [rate, setRate] = useState(1);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  const ctx = useRef<AudioContext | null>(null);
  const queue = useRef<{ text: string; onEnd?: () => void }[]>([]);
  const playing = useRef<Playing | null>(null);
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);
  const captionTimer = useRef<number | null>(null);
  const playNextRef = useRef<() => void>(() => {});

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSupported({
        tts: enabled && typeof AudioContext !== "undefined",
        stt: enabled && !!navigator.mediaDevices?.getUserMedia && !!pickRecorderMime() && typeof WebSocket !== "undefined",
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, [enabled]);

  const audio = useCallback(() => {
    if (!ctx.current) ctx.current = new AudioContext({ sampleRate });
    if (ctx.current.state === "suspended") void ctx.current.resume();
    return ctx.current;
  }, [sampleRate]);

  // Browsers only start audio after a gesture; the lesson page is reached by one, but be safe.
  useEffect(() => {
    const wake = () => {
      if (ctx.current?.state === "suspended") void ctx.current.resume();
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  const finish = useCallback((p: Playing) => {
    if (p.finished) return;
    p.finished = true;
    if (playing.current === p) playing.current = null;
    if (captionTimer.current) window.clearInterval(captionTimer.current);
    captionTimer.current = null;
    speakingRef.current = false;
    setCaption((c) => (c && c.text === p.text ? { text: p.text, wordIndex: p.words } : c));
    p.onEnd?.();
    playNextRef.current();
  }, []);

  const playNext = useCallback(() => {
    if (speakingRef.current || mutedRef.current) return;
    const item = queue.current.shift();
    if (!item) {
      setSpeaking(false);
      return;
    }
    const ac = audio();
    const p: Playing = {
      text: item.text,
      words: item.text.trim().split(/\s+/).filter(Boolean).length,
      abort: new AbortController(),
      sources: [],
      startAt: 0,
      scheduled: 0,
      streamed: false,
      onEnd: item.onEnd,
      finished: false,
      endAt: 0,
      finishTimer: null,
    };
    playing.current = p;
    speakingRef.current = true;
    setSpeaking(true);
    setCaption({ text: p.text, wordIndex: -1 });
    const estSec = estimateSpeechMs(p.text, 1) / 1000;
    captionTimer.current = window.setInterval(() => {
      if (!p.startAt) return;
      const elapsed = ac.currentTime - p.startAt;
      const total = p.streamed ? p.scheduled : Math.max(p.scheduled, estSec);
      const idx = Math.min(p.words - 1, Math.floor((elapsed / Math.max(0.1, total)) * p.words));
      setCaption((c) => (c && c.text === p.text && c.wordIndex !== idx ? { text: p.text, wordIndex: idx } : c));
    }, 80);

    (async () => {
      let at = 0;
      try {
        const res = await fetch(`${TUTOR_HTTP}/tts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: p.text }),
          signal: p.abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`tts ${res.status}`);
        const reader = res.body.getReader();
        let rest = new Uint8Array(0);
        for (;;) {
          const { value, done } = await reader.read();
          if (done || p.finished) break;
          const { samples, rest: r } = pcm16ToFloat(concatBytes(rest, value));
          rest = r;
          if (!samples.length) continue;
          const buf = ac.createBuffer(1, samples.length, sampleRate);
          buf.copyToChannel(samples, 0);
          const src = ac.createBufferSource();
          src.buffer = buf;
          src.connect(ac.destination);
          if (!p.startAt) {
            p.startAt = ac.currentTime + 0.06;
            at = p.startAt;
          }
          if (at < ac.currentTime) at = ac.currentTime + 0.02;
          src.start(at);
          at += buf.duration;
          p.scheduled += buf.duration;
          p.sources.push(src);
        }
        p.streamed = true;
        p.endAt = at;
        // Done once the last scheduled sample has played (re-armed on resume if paused).
        if (!pausedRef.current) p.finishTimer = window.setTimeout(() => finish(p), Math.max(0, (at - ac.currentTime) * 1000) + 40);
      } catch (err) {
        if (!p.abort.signal.aborted) console.warn("[voice] tts failed:", err);
        finish(p);
      }
    })();
  }, [audio, finish, sampleRate]);
  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const stop = useCallback(() => {
    const dropped = queue.current;
    queue.current = [];
    const p = playing.current;
    if (p) {
      p.abort.abort();
      for (const s of p.sources) {
        try {
          s.stop();
        } catch {
          /* already ended */
        }
      }
      finish(p);
    }
    speakingRef.current = false;
    setSpeaking(false);
    for (const d of dropped) d.onEnd?.();
  }, [finish]);

  const speak = useCallback(
    (text: string, onEnd?: () => void): boolean => {
      if (!supported.tts || mutedRef.current) return false;
      queue.current.push({ text, onEnd });
      playNext();
      return true;
    },
    [supported.tts, playNext],
  );
  const estimate = useCallback((text: string) => estimateSpeechMs(text, 1), []);

  // Pausing suspends the audio clock, so scheduled samples hold in place and the
  // caption stops; resuming lets them run on and re-arms the end-of-line timer.
  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
    const p = playing.current;
    if (p?.finishTimer) {
      window.clearTimeout(p.finishTimer);
      p.finishTimer = null;
    }
    void ctx.current?.suspend();
  }, []);
  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    const ac = ctx.current;
    void ac?.resume();
    const p = playing.current;
    if (p && p.streamed && !p.finished && ac) p.finishTimer = window.setTimeout(() => finish(p), Math.max(0, (p.endAt - ac.currentTime) * 1000) + 40);
  }, [finish]);

  const setMutedOn = useCallback(
    (on: boolean) => {
      mutedRef.current = on;
      setMuted(on);
      if (on) {
        stop();
        setCaption(null);
      }
    },
    [stop],
  );

  // ---- Microphone to Nova, through the tutor server.
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; ws: WebSocket; meter: { ctx: AudioContext; timer: number } | null } | null>(null);
  const stopMeter = (m: { ctx: AudioContext; timer: number } | null) => {
    if (!m) return;
    window.clearInterval(m.timer);
    void m.ctx.close();
  };
  const wantListening = useRef(false);
  const startRec = useCallback(async () => {
    const mime = pickRecorderMime();
    if (!mime) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      wantListening.current = false;
      setListening(false);
      return;
    }
    if (!wantListening.current) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    const ws = new WebSocket(`${STT_URL}?language=${encodeURIComponent(optsRef.current.lang ?? "en")}`);
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    // A small level meter on the mic, so the student can see they are being heard.
    let meter: { ctx: AudioContext; timer: number } | null = null;
    try {
      const mctx = new AudioContext();
      const analyser = mctx.createAnalyser();
      analyser.fftSize = 512;
      mctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 6));
      }, 80);
      meter = { ctx: mctx, timer };
    } catch {
      meter = null;
    }
    let heardLines: string[] = [];
    let bargedIn = false;
    const emit = () => {
      const text = heardLines.join(" ").trim();
      heardLines = [];
      bargedIn = false;
      setHeard("");
      if (text) optsRef.current.onUserSpeech(text);
    };
    ws.onmessage = (ev) => {
      const t = readTranscript(String(ev.data));
      if (t.kind === "final") {
        if (t.text) heardLines.push(t.text);
        setHeard([...heardLines].join(" "));
        if (t.endOfSpeech) emit();
      } else if (t.kind === "utterance_end") emit();
      else if (t.kind === "interim") {
        setHeard([...heardLines, t.text].join(" ").trim());
        if (!bargedIn && speakingRef.current && t.text.split(/\s+/).length >= 3) {
          // The student is talking over the tutor: a few real words, so speaker echo does not trip it.
          bargedIn = true;
          stop();
          optsRef.current.onBargeIn();
        }
      }
    };
    ws.onclose = () => {
      if (rec.current?.ws === ws) {
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
        for (const tr of stream.getTracks()) tr.stop();
        stopMeter(meter);
        setLevel(0);
        rec.current = null;
        // Keep listening across a dropped socket.
        if (wantListening.current) window.setTimeout(() => void startRec(), 1000);
      }
    };
    recorder.ondataavailable = (e) => {
      if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };
    ws.onopen = () => recorder.start(250);
    rec.current = { recorder, stream, ws, meter };
  }, [stop]);

  const setListeningOn = useCallback(
    (on: boolean) => {
      wantListening.current = on;
      setListening(on);
      if (on) void startRec();
      else {
        const r = rec.current;
        rec.current = null;
        if (r) {
          try {
            r.recorder.stop();
          } catch {
            /* already stopped */
          }
          for (const t of r.stream.getTracks()) t.stop();
          stopMeter(r.meter);
          r.ws.close();
        }
        setLevel(0);
        setHeard("");
      }
    },
    [startRec],
  );

  useEffect(
    () => () => {
      wantListening.current = false;
      const r = rec.current;
      rec.current = null;
      if (r) {
        try {
          r.recorder.stop();
        } catch {
          /* already stopped */
        }
        for (const t of r.stream.getTracks()) t.stop();
        r.ws.close();
      }
      const p = playing.current;
      if (p) {
        p.abort.abort();
        for (const s of p.sources) {
          try {
            s.stop();
          } catch {
            /* already ended */
          }
        }
      }
      if (captionTimer.current) window.clearInterval(captionTimer.current);
      void ctx.current?.close();
    },
    [],
  );

  return { provider: "deepgram", supported, muted, setMuted: setMutedOn, listening, setListening: setListeningOn, speaking, caption, rate, setRate, speak, estimate, stop, level, heard, paused, pause, resume };
}
