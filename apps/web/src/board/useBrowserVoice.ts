"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { estimateSpeechMs } from "./pacer";
import type { VoiceApi, VoiceOptions } from "./useVoice";

/**
 * Voice in the browser, no keys and no server: speech synthesis for the
 * tutor, speech recognition for the student, and barge-in (the student
 * starting to talk stops the tutor). Word boundaries from the synthesiser
 * drive the spoken / upcoming caption styling.
 */

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function getRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useBrowserVoice(opts: VoiceOptions): VoiceApi {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const [supported, setSupported] = useState({ tts: false, stt: false });
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState<VoiceApi["caption"]>(null);
  const [rate, setRate] = useState(1.05);
  const [heard, setHeard] = useState("");
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [micError, setMicError] = useState<string | null>(null);

  const queue = useRef<{ text: string; onEnd?: () => void }[]>([]);
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const currentEnd = useRef<(() => void) | null>(null);
  const mutedRef = useRef(muted);
  const rateRef = useRef(rate);
  const speakingRef = useRef(false);
  const rec = useRef<Recognition | null>(null);
  const wantListening = useRef(false);
  const playNextRef = useRef<() => void>(() => {});

  useEffect(() => {
    // Detected after mount so server and client render the same markup.
    const id = window.setTimeout(() => setSupported({ tts: "speechSynthesis" in window, stt: !!getRecognitionCtor() }), 0);
    return () => window.clearTimeout(id);
  }, []);
  /** Cut the tutor's voice now and drop anything queued. Leaves a pause as it is. */
  const halt = useCallback(() => {
    const dropped = queue.current;
    queue.current = [];
    const end = currentEnd.current;
    currentEnd.current = null;
    current.current = null;
    speakingRef.current = false;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    // Whoever was waiting on these lines must not wait forever.
    end?.();
    for (const d of dropped) d.onEnd?.();
  }, []);

  /** Stop the tutor's voice and end a pause, so the next line is heard. */
  const stop = useCallback(() => {
    halt();
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      // Chrome stays paused across cancel(); without this the next line would be silent.
      window.speechSynthesis?.resume();
    }
  }, [halt]);

  const setMutedOn = useCallback(
    (on: boolean) => {
      mutedRef.current = on;
      setMuted(on);
      if (on) {
        halt();
        setCaption(null);
      }
    },
    [halt],
  );
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  const pickVoice = useCallback(() => {
    const voices = window.speechSynthesis.getVoices();
    const lang = optsRef.current.lang ?? "en";
    const preferred = ["Google US English", "Samantha", "Microsoft Aria", "Microsoft Jenny", "Daniel", "Karen"];
    for (const name of preferred) {
      const v = voices.find((x) => x.name.includes(name) && x.lang.startsWith(lang));
      if (v) return v;
    }
    return voices.find((v) => v.lang.startsWith(lang) && !v.localService) ?? voices.find((v) => v.lang.startsWith(lang)) ?? null;
  }, []);

  const playNext = useCallback(() => {
    if (speakingRef.current || mutedRef.current) return;
    const item = queue.current.shift();
    if (!item) {
      setSpeaking(false);
      return;
    }
    const text = item.text;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rateRef.current;
    u.pitch = 1;
    const v = pickVoice();
    if (v) u.voice = v;
    const words = text.split(/\s+/);
    // char offsets of each word, so onboundary can map charIndex to a word
    const offsets: number[] = [];
    let pos = 0;
    for (const w of words) {
      const i = text.indexOf(w, pos);
      offsets.push(i);
      pos = i + w.length;
    }
    setCaption({ text, wordIndex: -1 });
    u.onboundary = (e) => {
      if (e.name !== "word") return;
      let idx = 0;
      for (let i = 0; i < offsets.length; i++) if (offsets[i] <= e.charIndex) idx = i;
      setCaption({ text, wordIndex: idx });
    };
    const done = () => {
      if (current.current !== u) return;
      current.current = null;
      currentEnd.current = null;
      speakingRef.current = false;
      setCaption((c) => (c && c.text === text ? { text, wordIndex: words.length } : c));
      item.onEnd?.();
      playNextRef.current();
    };
    u.onend = done;
    u.onerror = done;
    current.current = u;
    currentEnd.current = item.onEnd ?? null;
    speakingRef.current = true;
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }, [pickVoice]);
  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  /**
   * Queue a line of narration. `onEnd` fires when it has been spoken (or cut
   * off). Returns false when nothing will be said (no synthesiser, or muted),
   * so the caller can keep time on its own.
   */
  const speak = useCallback(
    (text: string, onEnd?: () => void): boolean => {
      if (!supported.tts || mutedRef.current) return false;
      queue.current.push({ text, onEnd });
      playNext();
      return true;
    },
    [supported.tts, playNext],
  );

  /** How long a line takes to say at the current speed. */
  const estimate = useCallback((text: string) => estimateSpeechMs(text, rateRef.current), []);

  // Speech recognition with auto-restart while listening is on.
  const startRec = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = optsRef.current.lang ?? "en-US";
    let bargedIn = false;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0].transcript;
        if (res.isFinal) {
          bargedIn = false;
          const clean = t.trim();
          setHeard("");
          if (clean) optsRef.current.onUserSpeech(clean);
        } else interim += t;
      }
      setHeard(interim.trim());
      // Barge-in: a few real words while the tutor talks. Short fragments are
      // ignored so the speaker echo does not trip it.
      if (!bargedIn && speakingRef.current && interim.trim().split(/\s+/).length >= 3) {
        // The lesson drops its queue first, so stopping the voice cannot start the next line.
        bargedIn = true;
        optsRef.current.onBargeIn();
        stop();
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantListening.current = false;
        setListening(false);
        setMicError("The microphone is blocked. Allow it for this site to talk to the tutor.");
      }
    };
    r.onend = () => {
      if (wantListening.current) {
        try {
          r.start();
        } catch {
          /* already started */
        }
      }
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      /* ignore */
    }
  }, [stop]);

  const setListeningOn = useCallback(
    (on: boolean) => {
      wantListening.current = on;
      setListening(on);
      if (on) {
        setMicError(null);
        startRec();
      }
      else {
        rec.current?.abort();
        rec.current = null;
      }
    },
    [startRec],
  );

  useEffect(
    () => () => {
      wantListening.current = false;
      rec.current?.abort();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
    window.speechSynthesis?.pause();
  }, []);
  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    window.speechSynthesis?.resume();
  }, []);

  /**
   * Called from a click: some browsers only let speech start inside a
   * gesture, so say nothing once to open the way for the lesson's lines.
   */
  const unlock = useCallback(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || synth.speaking || synth.pending) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
    } catch {
      /* no synthesiser */
    }
  }, []);

  return { provider: "browser", supported, muted, setMuted: setMutedOn, listening, setListening: setListeningOn, speaking, caption, rate, setRate, speak, estimate, stop, level: 0, heard, paused, pause, resume, unlock, micError };
}
