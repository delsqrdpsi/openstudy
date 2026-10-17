"use client";
import { useEffect, useState } from "react";
import { TUTOR_HTTP } from "./useLiveSession";
import { useBrowserVoice } from "./useBrowserVoice";
import { useDeepgramVoice } from "./useDeepgramVoice";

/** What any voice gives the lesson, hosted or built into the browser. */
export interface VoiceApi {
  provider: "browser" | "deepgram";
  supported: { tts: boolean; stt: boolean };
  muted: boolean;
  setMuted: (on: boolean) => void;
  listening: boolean;
  setListening: (on: boolean) => void;
  speaking: boolean;
  caption: Caption | null;
  rate: number;
  setRate: (r: number) => void;
  /** Say a line; `onEnd` fires when it has been heard or cut off. False when nothing will be said. */
  speak: (text: string, onEnd?: () => void) => boolean;
  /** How long a line takes to say, in ms. */
  estimate: (text: string) => number;
  /** Stop now and drop what is queued. */
  stop: () => void;
}

export interface VoiceOptions {
  /** Called with the final transcript of something the student said. */
  onUserSpeech: (text: string) => void;
  /** Called the moment the student starts talking over the tutor. */
  onBargeIn: () => void;
  lang?: string;
}

export interface Caption {
  text: string;
  /** Index of the word currently being spoken; -1 before start. */
  wordIndex: number;
}

export type VoiceConfig = { provider: "browser" } | { provider: "deepgram"; tts: string; stt: string; sampleRate: number };

/** The tutor server says which voice is set up (a Deepgram key, or none). */
export function useVoiceConfig(): VoiceConfig | null {
  const [cfg, setCfg] = useState<VoiceConfig | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${TUTOR_HTTP}/voice`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: VoiceConfig | null) => {
        if (alive) setCfg(c?.provider === "deepgram" ? c : { provider: "browser" });
      })
      .catch(() => {
        if (alive) setCfg({ provider: "browser" });
      });
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}

/** The voice for a live lesson: Deepgram when the server has a key, else the browser's own. */
export function useVoice(opts: VoiceOptions): VoiceApi {
  const cfg = useVoiceConfig();
  const browser = useBrowserVoice(opts);
  const hosted = useDeepgramVoice(opts, cfg?.provider === "deepgram" ? cfg : null);
  return cfg?.provider === "deepgram" ? hosted : browser;
}
