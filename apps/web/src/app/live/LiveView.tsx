"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveSession } from "@/board/useLiveSession";
import { useVoice } from "@/board/useVoice";
import { LessonShell } from "@/board/LessonShell";

/** A live lesson. The intake (topic and materials) arrives from the home page. */
export function LiveView() {
  const params = useSearchParams();
  const liveRef = useRef<ReturnType<typeof useLiveSession> | null>(null);
  const voice = useVoice({
    onUserSpeech: (text) => liveRef.current?.say(text),
    onBargeIn: () => liveRef.current?.interrupt(),
  });
  const speak = voice.speak;
  const onSay = useCallback((text: string) => speak(text), [speak]);
  const live = useLiveSession({ onSay });
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const started = useRef(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);

  // When the tutor is cut off by typing, stop its voice too.
  const stopVoice = voice.stop;
  const interrupt = useCallback(() => {
    stopVoice();
    live.interrupt();
  }, [stopVoice, live]);
  const say = useCallback(
    (text: string) => {
      if (live.turn === "thinking" || live.turn === "speaking") stopVoice();
      live.say(text);
    },
    [live, stopVoice],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const topic = params.get("topic") ?? "";
    let materials: { name: string; text: string }[] = [];
    try {
      const raw = sessionStorage.getItem("openstudy.materials");
      if (raw) materials = JSON.parse(raw);
    } catch {
      /* no materials */
    }
    live.start({ topic: topic || "Help me learn something new", materials, model: params.get("model") ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const note = live.error ?? (!live.connected ? "Connecting to the tutor..." : null);

  return (
    <LessonShell
      title={live.state.title}
      state={live.state}
      turn={live.turn}
      transcript={live.transcript}
      writingId={live.writingId}
      statusNote={note}
      onSay={say}
      onInterrupt={interrupt}
      caption={voice.caption}
      extraControls={
        <>
          <div className="ui-card relative flex items-center gap-0.5 p-1">
            <button
              className={`ui-btn${voice.listening ? " is-on" : ""}`}
              onClick={() => voice.setListening(!voice.listening)}
              disabled={!voice.supported.stt}
              title={voice.supported.stt ? (voice.listening ? "Mic is on. Click to mute." : "Turn the mic on to talk to the tutor") : "Speech recognition needs Chrome or Edge"}
              aria-label={voice.listening ? "Mute microphone" : "Unmute microphone"}
            >
              {voice.listening ? "🎙" : "🎙̸"}
            </button>
            <button
              className={`ui-btn${voice.muted ? "" : " is-on"}`}
              onClick={() => voice.setMuted(!voice.muted)}
              disabled={!voice.supported.tts}
              title={voice.muted ? "Tutor voice is off" : "Tutor voice is on"}
              aria-label={voice.muted ? "Unmute tutor" : "Mute tutor"}
            >
              {voice.muted ? "🔇" : "🔊"}
            </button>
            <button className="ui-btn" onClick={() => setShowVoiceMenu((v) => !v)} aria-label="Voice settings" title="Speech speed">
              {voice.rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×
            </button>
            {showVoiceMenu && (
              <div className="ui-card absolute bottom-12 left-0 flex items-center gap-2 p-2 text-[12px]">
                <span>Speed</span>
                <input type="range" min={0.7} max={1.6} step={0.05} value={voice.rate} onChange={(e) => voice.setRate(Number(e.target.value))} aria-label="Speech speed" />
              </div>
            )}
          </div>
          {live.info && (
            <span className="ui-card px-3 py-1.5 text-[12px] text-neutral-500">
              {live.info.brain} · {live.info.model}
            </span>
          )}
        </>
      }
    />
  );
}
