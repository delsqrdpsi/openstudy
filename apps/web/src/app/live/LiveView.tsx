"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveSession, type Speaker } from "@/board/useLiveSession";
import { useVoice } from "@/board/useVoice";
import { LessonShell } from "@/board/LessonShell";
import { UsageBadge } from "@/board/UsageBadge";

/** A live lesson. The intake (topic and materials) arrives from the home page. */
export function LiveView() {
  const params = useSearchParams();
  const liveRef = useRef<ReturnType<typeof useLiveSession> | null>(null);
  const voice = useVoice({
    onUserSpeech: (text) => liveRef.current?.say(text),
    onBargeIn: () => liveRef.current?.interrupt(),
  });
  const { speak, estimate } = voice;
  const speaker = useMemo<Speaker>(() => ({ speak, estimateMs: estimate }), [speak, estimate]);
  const live = useLiveSession({ speaker });
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
    const board = params.get("board");
    if (board) {
      live.start({ resume: board });
      return;
    }
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

  // Keep the saved board's id in the address bar so a reload reopens it.
  useEffect(() => {
    if (live.info?.id && !params.get("board")) {
      const q = new URLSearchParams(window.location.search);
      q.delete("topic");
      q.delete("model");
      q.set("board", live.info.id);
      window.history.replaceState(null, "", `/live?${q.toString()}`);
    }
  }, [live.info?.id, params]);

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
      boardId={live.info?.id ?? null}
      extraControls={
        <>
          <div className="ui-card relative flex items-center gap-0.5 p-1">
            <button
              className={`ui-btn${voice.listening ? " is-on" : ""}`}
              onClick={() => voice.setListening(!voice.listening)}
              disabled={!voice.supported.stt}
              title={voice.supported.stt ? (voice.listening ? "Mic is on. Click to mute." : "Turn the mic on to talk to the tutor") : voice.provider === "deepgram" ? "This browser cannot record audio" : "Speech recognition needs Chrome or Edge, or a Deepgram key"}
              aria-label={voice.listening ? "Mute microphone" : "Unmute microphone"}
            >
              <MicIcon off={!voice.listening} />
            </button>
            <button
              className={`ui-btn${voice.muted ? "" : " is-on"}`}
              onClick={() => voice.setMuted(!voice.muted)}
              disabled={!voice.supported.tts}
              title={voice.muted ? "Tutor voice is off" : "Tutor voice is on"}
              aria-label={voice.muted ? "Unmute tutor" : "Mute tutor"}
            >
              <SpeakerIcon off={voice.muted} />
            </button>
            {voice.provider === "browser" && (
              <button className="ui-btn" onClick={() => setShowVoiceMenu((v) => !v)} aria-label="Voice settings" title="Speech speed">
                {voice.rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×
              </button>
            )}
            {showVoiceMenu && voice.provider === "browser" && (
              <div className="ui-card absolute bottom-12 left-0 flex items-center gap-2 p-2 text-[12px]">
                <span>Speed</span>
                <input type="range" min={0.7} max={1.6} step={0.05} value={voice.rate} onChange={(e) => voice.setRate(Number(e.target.value))} aria-label="Speech speed" />
              </div>
            )}
          </div>
          {live.info && (
            <span className="ui-card flex items-center gap-1 py-1 pl-1 pr-1 text-[12px] text-neutral-500">
              <UsageBadge usage={live.usage} contextWindow={live.info.model === "sonnet" ? 1_000_000 : 200_000} />
              {live.info.brain} ·
              <select
                className="ui-btn h-7 bg-transparent px-1 text-[12px]"
                value={live.info.model}
                onChange={(e) => live.setModel(e.target.value)}
                aria-label="Tutor model"
                title="Switch the tutor's model; applies from the next turn"
              >
                {Array.from(new Set(["sonnet", "opus", "fable", live.info.model])).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              · {voice.provider === "deepgram" ? "aura-2" : "browser voice"}
            </span>
          )}
        </>
      }
    />
  );
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function SpeakerIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10v4h4l5 4V6L8 10H4z" />
      {off ? <path d="M18 9l-4 6M14 9l4 6" /> : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
    </svg>
  );
}
