"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BoardState, TurnState } from "@openstudy/shared";
import { Board, type BoardHandle } from "./Board";
import type { TranscriptEntry } from "@/lib/transcript";

const PANEL_KEY = "openstudy.chatPanel";

interface Props {
  title: string;
  state: BoardState;
  turn: TurnState;
  transcript: TranscriptEntry[];
  writingId?: string | null;
  statusNote?: string | null;
  /** Student input. Omit for read-only playback. */
  onSay?: (text: string) => void;
  onInterrupt?: () => void;
  /** Extra controls rendered in the bottom-left cluster (playback, voice). */
  extraControls?: React.ReactNode;
  /** Controls inside the input bar, next to Send (the mic). */
  inputControls?: React.ReactNode;
  /** Live words from speech recognition, shown above the input while the student talks. */
  hearing?: string | null;
  /** The lesson is paused: shown as a banner, and the input says so. */
  paused?: boolean;
  /** Spoken caption with word progress; falls back to the last tutor line. */
  caption?: { text: string; wordIndex: number } | null;
  /** Saved board id, enables the export button. */
  boardId?: string | null;
}

/**
 * The lesson layout: board in the middle, chat history on the right,
 * keypoints bottom-right of the board, question options and the input bar
 * along the bottom. Shared by live lessons and fixture playback.
 */
export function LessonShell({ title, state, turn, transcript, writingId, statusNote, onSay, onInterrupt, extraControls, inputControls, hearing, paused, caption, boardId }: Props) {
  const board = useRef<BoardHandle>(null);
  const [scale, setScale] = useState(1);
  const [follow, setFollow] = useState(true);
  const [panel, setPanel] = useState(true);
  const [draft, setDraft] = useState("");
  const onScale = useCallback((s: number) => setScale(s), []);
  const listRef = useRef<HTMLDivElement>(null);

  // Chat panel: remember the last choice; first visit on a narrow window starts collapsed.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(PANEL_KEY);
    } catch {
      /* storage unavailable */
    }
    // Reads browser-only state once after hydration, so the server and first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "0" || saved === "1") setPanel(saved === "1");
    else if (window.innerWidth < 960) setPanel(false);
  }, []);
  const showPanel = (on: boolean) => {
    setPanel(on);
    try {
      window.localStorage.setItem(PANEL_KEY, on ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  const submit = (text: string) => {
    if (!onSay) return;
    onSay(text);
    setDraft("");
  };

  const busy = turn === "thinking" || turn === "speaking";
  const lastTutor = [...transcript].reverse().find((e) => e.kind === "tutor");
  const currentSection = state.sections[state.sections.length - 1];

  return (
    <main className="flex h-full w-full overflow-hidden" data-turn={turn}>
      <section className="relative min-w-0 flex-1">
        <Board ref={board} state={state} writingId={writingId} follow={follow} onScaleChange={onScale} />

        {/* top bar */}
        <div className="pointer-events-none absolute left-4 right-4 top-4 z-20 flex flex-wrap items-start justify-between gap-3">
          <div className="ui-card pointer-events-auto flex items-center gap-1 p-1 pr-3">
            <Link href="/" className="ui-btn" aria-label="Close lesson" title="Back to start">
              ✕
            </Link>
            <span className="max-w-[40vw] truncate text-sm font-medium">{title || "Untitled lesson"}</span>
          </div>
          <div className="ui-card pointer-events-auto flex items-center gap-0.5 p-1">
            <button className="ui-btn" onClick={() => board.current?.zoomTo(scale / 1.2)} aria-label="Zoom out">−</button>
            <button className="ui-btn min-w-14 tabular-nums" onClick={() => board.current?.zoomTo(1)} title="Zoom to 100%">
              {Math.round(scale * 100)}%
            </button>
            <button className="ui-btn" onClick={() => board.current?.zoomTo(scale * 1.2)} aria-label="Zoom in">+</button>
            <span className="mx-1 h-5 w-px bg-neutral-200" />
            <button className="ui-btn" onClick={() => board.current?.fitAll()} aria-label="Fit board" title="Fit the whole board">⤢</button>
            {boardId && (
              <a className="ui-btn" href={`/print/${boardId}`} target="_blank" rel="noreferrer" aria-label="Export board" title="Print or save the board as PDF">
                ⤓
              </a>
            )}
            <button className={`ui-btn${follow ? " is-on" : ""}`} onClick={() => setFollow((f) => !f)} title="Camera follows the tutor">
              Follow
            </button>
            <button className={`ui-btn${panel ? " is-on" : ""}`} onClick={() => showPanel(!panel)} aria-label="Toggle chat history" title={panel ? "Hide chat history" : "Show chat history"} aria-expanded={panel}>
              ☰
            </button>
          </div>
        </div>

        {/* collapsed chat panel: tab on the right edge to reopen it */}
        {!panel && (
          <button
            className="ui-card pointer-events-auto absolute right-0 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1.5 rounded-r-none px-2.5 py-2 text-[12px] font-medium text-neutral-600 hover:text-[var(--ink)]"
            onClick={() => showPanel(true)}
            aria-label="Show chat history"
            title="Show chat history"
          >
            <span aria-hidden>‹</span>
            <span>Chat</span>
            {transcript.length > 0 && <span className="rounded-full bg-neutral-100 px-1.5 text-[11px] tabular-nums text-neutral-500">{transcript.length}</span>}
          </button>
        )}

        {/* keypoints */}
        {state.sections.length > 0 && (
          <aside className="pointer-events-none absolute bottom-28 right-4 z-20 w-64 text-right">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Keypoints {Math.max(0, state.sections.length - (turn === "done" ? 0 : 1))} / {state.sections.length}
            </div>
            <ol className="space-y-1.5">
              {state.sections.map((s, i) => {
                const current = s === currentSection && turn !== "done";
                const done = turn === "done" || i < state.sections.length - 1;
                return (
                  <li key={i} className={`flex items-start justify-end gap-2 text-[13px] leading-snug ${current ? "font-medium text-[var(--ink)]" : done ? "text-neutral-500" : "text-neutral-400"}`}>
                    <span>{s}</span>
                    <span className={`mt-1 inline-block h-3 w-3 shrink-0 rounded-full border-2 ${current ? "border-[var(--coral)] bg-[var(--coral)]" : done ? "border-[var(--teal)] bg-[var(--teal)]" : "border-neutral-300"}`} />
                  </li>
                );
              })}
            </ol>
          </aside>
        )}

        {/* current line + options + input */}
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-20 flex flex-col items-center gap-3">
          {caption ? (
            <p className="max-w-[760px] rounded-2xl bg-[rgba(246,247,244,0.85)] px-4 py-1.5 text-center text-[17px] leading-snug text-[var(--ink)] backdrop-blur-sm">
              {caption.text.split(/\s+/).map((w, i) => (
                <span key={i} className={i <= caption.wordIndex ? "opacity-100" : "opacity-35"} style={{ transition: "opacity 80ms" }}>
                  {w}{" "}
                </span>
              ))}
            </p>
          ) : (
            lastTutor &&
            turn !== "idle" && (
              <p className="max-w-[760px] rounded-2xl bg-[rgba(246,247,244,0.85)] px-4 py-1.5 text-center text-[17px] leading-snug text-[var(--ink)] backdrop-blur-sm">{lastTutor.text.split(/(?<=[.?!])\s+/).slice(-2).join(" ")}</p>
            )
          )}
          {paused && (
            <div className="pointer-events-auto rounded-full bg-[var(--ink)] px-4 py-1.5 text-[13px] font-medium text-white">Lesson paused. Press play to carry on.</div>
          )}
          <div className="flex w-full items-end justify-between gap-3">
            <div className="pointer-events-auto flex items-center gap-2">{extraControls}</div>
            {onSay ? (
              <div className="pointer-events-auto flex w-[min(640px,100%)] flex-col items-stretch gap-1.5">
              {hearing && (
                <div className="ui-card self-end max-w-full truncate px-3 py-1.5 text-[14px] italic text-neutral-600" aria-live="polite">
                  {hearing}
                </div>
              )}
              <form
                className="ui-card flex w-full items-center gap-2 p-1.5 pl-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(draft);
                }}
              >
                <span className={busy ? "ui-pulse" : "h-2 w-2 rounded-full bg-neutral-300"} aria-hidden />
                <input
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-neutral-400"
                  placeholder={paused ? "Paused. Type to ask something, or press play" : busy ? "Type to interrupt..." : "Your answer, or a question"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="Message the tutor"
                />
                {busy && onInterrupt && (
                  <button type="button" className="ui-btn" onClick={onInterrupt} title="Stop the tutor">
                    ◼
                  </button>
                )}
                {inputControls}
                <button type="submit" className="ui-btn primary" aria-label="Send">
                  ↑
                </button>
              </form>
              </div>
            ) : (
              <span />
            )}
          </div>
          {statusNote && <div className="pointer-events-auto rounded-full bg-[var(--ink)] px-4 py-1.5 text-[13px] text-white">{statusNote}</div>}
        </div>
      </section>

      {/* chat history */}
      {panel && (
        <aside className="flex w-[360px] shrink-0 flex-col border-l border-[var(--panel-border)] bg-[var(--panel)]">
          <header className="flex items-center justify-between py-3 pl-5 pr-3">
            <h2 className="text-[15px] font-semibold">Chat history</h2>
            <span className="flex items-center gap-2 text-[12px] text-neutral-500">
              {busy && <span className="ui-pulse" />}
              {turn === "thinking" ? "thinking" : turn === "speaking" ? "teaching" : turn === "waiting" ? "your turn" : turn === "done" ? "lesson complete" : ""}
              <button className="ui-btn ml-1" onClick={() => showPanel(false)} aria-label="Hide chat history" title="Hide chat history">
                ›
              </button>
            </span>
          </header>
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-5 pb-6">
            {transcript.map((e, i) =>
              e.kind === "tutor" ? (
                <p key={i} className="text-[14px] leading-relaxed text-[var(--ink)]">{e.text}</p>
              ) : e.kind === "user" ? (
                <p key={i} className="ml-8 rounded-2xl rounded-tr-sm bg-neutral-100 px-3.5 py-2 text-[14px] leading-relaxed">{e.text}</p>
              ) : e.kind === "section" ? (
                <div key={i} className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--teal)]">{e.title}</div>
              ) : (
                <div key={i} className="flex items-baseline gap-2 text-[12px] text-neutral-500">
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">{e.label}</span>
                  {e.detail && <span className="truncate">{e.detail}</span>}
                </div>
              ),
            )}
          </div>
        </aside>
      )}
    </main>
  );
}
