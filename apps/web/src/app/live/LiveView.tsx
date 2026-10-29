"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { goOnRequest, paceRequest, pauseRequest } from "@openstudy/shared";
import { useLiveSession, type Offer, type Speaker } from "@/board/useLiveSession";
import { isBoardId, newBoardId } from "@/board/liveProtocol";
import { useVoice } from "@/board/useVoice";
import { LessonShell } from "@/board/LessonShell";
import { UsageBadge } from "@/board/UsageBadge";
import { useBrainModels } from "@/board/useBrainModels";

const RATE_KEY = "openstudy.speechRate";
/** Aura-2's range; the browser voice takes the same so the slider means one thing. */
const RATE_MIN = 0.7;
const RATE_MAX = 1.5;

/** A live lesson. The intake (topic and materials) arrives from the home page. */
export function LiveView() {
  const params = useSearchParams();
  const liveRef = useRef<ReturnType<typeof useLiveSession> | null>(null);
  // The mic goes through the same paths as typing and the Stop button (set below, once they exist).
  const sayRef = useRef<(text: string) => void>(() => {});
  const interruptRef = useRef<() => void>(() => {});
  const voice = useVoice({
    onUserSpeech: (text) => sayRef.current(text),
    onBargeIn: () => interruptRef.current(),
  });
  const { speak, estimate } = voice;
  const speaker = useMemo<Speaker>(() => ({ speak, estimateMs: estimate }), [speak, estimate]);
  const live = useLiveSession({ speaker });
  const { models } = useBrainModels();
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const started = useRef(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const speedButton = useRef<HTMLButtonElement>(null);

  // Pause holds the voice and the board together; play carries on from the same word.
  const { pause: pauseVoice, resume: resumeVoice, paused } = voice;
  const togglePause = useCallback(() => {
    if (paused) {
      resumeVoice();
      liveRef.current?.resume();
    } else {
      pauseVoice();
      liveRef.current?.pause();
    }
  }, [paused, pauseVoice, resumeVoice]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== "Space" || !e.shiftKey || t?.closest("input, textarea, select")) return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause]);

  // Stop: the lesson drops what is queued first, then the voice stops. In the
  // other order the voice's end-of-line would start the next queued line.
  // Stopping also ends a pause.
  const stopVoice = voice.stop;
  const interrupt = useCallback(() => {
    liveRef.current?.interrupt();
    stopVoice();
  }, [stopVoice]);
  const say = useCallback(
    (text: string) => {
      const l = liveRef.current;
      if (!l) return;
      const busy = l.turn === "thinking" || l.turn === "speaking";
      if (busy && pauseRequest(text)) {
        // "Wait" or "slow down" over the tutor holds the lesson where it is rather
        // than cutting it off: nothing is lost, and play (or "go on") carries on
        // from the same word. A slow-down is also kept for the rest of the lesson.
        pauseVoice();
        l.pause();
        l.pace(text, paceRequest(text) === "slow");
        return;
      }
      if (goOnRequest(text)) {
        // A bare "ok" or "go on" is the go-ahead, not an answer: un-pause, or end a wait.
        if (paused) {
          resumeVoice();
          l.resume();
          return;
        }
        if (l.hold) {
          l.goOn();
          return;
        }
      }
      // Answering while the tutor is still going cuts it off, the same as Stop, so
      // what was not heard comes off the board. Speaking or typing while paused
      // un-pauses: the student has moved on.
      if (busy) l.interrupt();
      l.say(text);
      stopVoice();
    },
    [stopVoice, pauseVoice, resumeVoice, paused],
  );
  useEffect(() => {
    sayRef.current = say;
    interruptRef.current = interrupt;
  }, [say, interrupt]);

  // Another tab took the lesson over: this one goes quiet and lets go of the mic.
  const { setListening } = voice;
  useEffect(() => {
    if (!live.superseded) return;
    stopVoice();
    setListening(false);
  }, [live.superseded, stopVoice, setListening]);

  // A reloaded page may not play sound until the student clicks. Until then the
  // lesson waits, instead of racing through lines nobody hears.
  const [sound, setSound] = useState<"unknown" | "locked" | "ok">("unknown");
  useEffect(() => {
    const id = window.setTimeout(() => {
      const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
      setSound(ua && !ua.hasBeenActive ? "locked" : "ok");
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  const { unlock } = voice;
  const startSound = useCallback(() => {
    unlock();
    setSound("ok");
  }, [unlock]);
  useEffect(() => {
    if (sound !== "locked") return;
    const onGesture = (e: Event) => {
      // Only a gesture that lets audio start counts (not Escape, Tab or a modifier).
      const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
      if (ua && !ua.isActive) return;
      if (e instanceof KeyboardEvent && (e.key === "Escape" || e.key === "Tab")) return;
      startSound();
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    return () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    };
  }, [sound, startSound]);
  const { holdBack } = live;
  const waitingForSound = sound === "unknown" || (sound === "locked" && !voice.muted);
  useEffect(() => {
    holdBack(waitingForSound);
  }, [holdBack, waitingForSound]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const board = params.get("board");
    const topic = params.get("topic");
    // Reopening a saved board (from the list on the home page).
    if (isBoardId(board) && !topic) {
      live.start({ resume: board });
      return;
    }
    let materials: { name: string; text: string }[] = [];
    try {
      const raw = sessionStorage.getItem("openstudy.materials");
      if (raw) materials = JSON.parse(raw);
    } catch {
      /* no materials */
    }
    let sources: string[] = [];
    try {
      const raw = sessionStorage.getItem("openstudy.sources");
      if (raw) sources = JSON.parse(raw);
    } catch {
      /* none */
    }
    // The board gets its id here, and the address bar has it at once: a reload
    // before the server answers sends the same id, and the server reopens that
    // board if it got as far as creating it, or starts it if not.
    const id = isBoardId(board) ? board : newBoardId();
    if (id !== board) {
      const q = new URLSearchParams(window.location.search);
      q.set("board", id);
      window.history.replaceState(null, "", `/live?${q.toString()}`);
    }
    live.start({ id, topic: topic || "Help me learn something new", materials, model: params.get("model") ?? undefined, sources });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the server has the board, the address is just the board: a reload resumes it.
  const boardId = live.info?.id;
  useEffect(() => {
    if (!boardId) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("board") === boardId && !q.has("topic") && !q.has("model")) return;
    q.delete("topic");
    q.delete("model");
    q.set("board", boardId);
    window.history.replaceState(null, "", `/live?${q.toString()}`);
  }, [boardId]);

  // The speed is remembered across lessons, for whichever voice is in use.
  const { setRate, provider } = voice;
  useEffect(() => {
    let saved = NaN;
    try {
      saved = Number(window.localStorage.getItem(RATE_KEY));
    } catch {
      /* storage unavailable */
    }
    // Applied once the voice is known, so the saved speed reaches the hosted voice too.
    if (saved >= RATE_MIN && saved <= RATE_MAX) setRate(saved);
  }, [setRate, provider]);
  const onRate = (r: number) => {
    setRate(r);
    try {
      window.localStorage.setItem(RATE_KEY, String(r));
    } catch {
      /* storage unavailable */
    }
  };

  // The speed popover closes on Escape and gives focus back to its button.
  useEffect(() => {
    if (!showVoiceMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setShowVoiceMenu(false);
      speedButton.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showVoiceMenu]);

  const note = live.superseded
    ? "This lesson is open in another tab. Reload this page to carry on here."
    : live.status === "reconnecting"
      ? "Reconnecting to the tutor..."
      : (live.error ?? voice.micError ?? (live.status === "connecting" ? "Connecting to the tutor..." : null));

  const notices =
    sound === "locked" && !voice.muted && !live.superseded ? (
      <button type="button" className="ui-card pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium" onClick={startSound}>
        <SpeakerIcon off={false} />
        Click to start sound
      </button>
    ) : live.offer && !live.superseded ? (
      <OfferCard offer={live.offer} disabled={!live.connected} onAnswer={live.answerOffer} />
    ) : null;

  return (
    <LessonShell
      title={live.state.title}
      state={live.state}
      turn={live.turn}
      transcript={live.transcript}
      options={live.options}
      writingId={live.writingId}
      statusNote={note}
      onSay={say}
      onInterrupt={interrupt}
      caption={voice.caption}
      boardId={live.info?.id ?? null}
      paused={paused}
      hearing={voice.listening && voice.heard ? voice.heard : null}
      notices={notices}
      hold={live.hold}
      onGoOn={live.goOn}
      inputControls={
        <button
          type="button"
          className={`ui-btn relative${voice.listening ? " is-on" : ""}`}
          onClick={() => voice.setListening(!voice.listening)}
          disabled={!voice.supported.stt || live.superseded}
          title={voice.supported.stt ? (voice.listening ? "Listening. Click to mute the mic." : "Turn the mic on to talk to the tutor") : voice.provider === "deepgram" ? "This browser cannot record audio" : "Speech recognition needs Chrome or Edge, or a Deepgram key"}
          aria-label={voice.listening ? "Mute microphone" : "Unmute microphone"}
          aria-pressed={voice.listening}
        >
          {voice.listening && (
            // A ring that swells with your voice, so you can see you are being heard.
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[9px] border-2 border-[var(--teal)]"
              style={{ opacity: 0.25 + voice.level * 0.75, transform: `scale(${1 + voice.level * 0.35})`, transition: "transform 80ms linear, opacity 80ms linear" }}
            />
          )}
          <MicIcon off={!voice.listening} />
        </button>
      }
      extraControls={
        <>
          <div className="ui-card relative flex items-center gap-0.5 p-1">
            <button
              className={`ui-btn${paused ? " is-on" : ""}`}
              onClick={togglePause}
              title={paused ? "Play the lesson (Shift+Space)" : "Pause the lesson (Shift+Space)"}
              aria-label="Pause lesson"
              aria-pressed={paused}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
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
            <button
              ref={speedButton}
              className="ui-btn"
              onClick={() => setShowVoiceMenu((v) => !v)}
              aria-label="Voice settings"
              title="Speech speed"
              aria-expanded={showVoiceMenu}
              aria-controls="voice-speed"
            >
              {voice.rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×
            </button>
            {showVoiceMenu && (
              <div id="voice-speed" className="ui-card absolute bottom-12 left-0 flex items-center gap-2 p-2 text-[12px]">
                <span>Speed</span>
                <input type="range" min={RATE_MIN} max={RATE_MAX} step={0.05} value={voice.rate} onChange={(e) => onRate(Number(e.target.value))} aria-label="Speech speed" />
                <button type="button" className="ui-btn px-2" onClick={() => onRate(1)} title="Back to normal speed">
                  1×
                </button>
              </div>
            )}
          </div>
          {live.info && (
            <span className="ui-card flex items-center gap-1 whitespace-nowrap py-1 pl-1 pr-3 text-[12px] text-neutral-500">
              <UsageBadge usage={live.usage} contextWindow={live.usage?.tutor.contextWindow ?? (live.info.model === "sonnet" ? 1_000_000 : 200_000)} />
              {live.info.brain} ·
              <select
                className="ui-btn h-7 bg-transparent px-1 text-[12px]"
                value={live.info.model}
                onChange={(e) => live.setModel(e.target.value)}
                aria-label="Tutor model"
                title="Switch the tutor's model; applies from the next turn"
              >
                {Array.from(new Set([...models.map((m) => m.id), live.info.model])).map((m) => (
                  <option key={m} value={m}>
                    {m || "default"}
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

/**
 * The tutor offering to build an interactive model. A card, not a dialog: the
 * lesson carries on around it, and nothing starts until the student says so.
 */
function OfferCard({ offer, disabled, onAnswer }: { offer: Offer; disabled: boolean; onAnswer: (accept: boolean) => void }) {
  return (
    <section className="ui-card pointer-events-auto flex w-[min(520px,100%)] flex-col gap-2 px-4 py-3 text-[13px]" aria-label="Offer from the tutor" aria-live="polite">
      <p className="font-medium text-[var(--ink)]">Build an interactive model?</p>
      {/* Plain text, verbatim: it comes from the model. */}
      <p className="whitespace-pre-wrap break-words text-[var(--ink)]">{offer.concept}</p>
      {offer.detail && <p className="text-neutral-500">{offer.detail}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="ui-btn px-3" onClick={() => onAnswer(false)} disabled={disabled}>
          Not now
        </button>
        <button type="button" className="ui-btn primary px-3" onClick={() => onAnswer(true)} disabled={disabled}>
          Build it
        </button>
      </div>
    </section>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 5v14l12-7z" />
    </svg>
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
