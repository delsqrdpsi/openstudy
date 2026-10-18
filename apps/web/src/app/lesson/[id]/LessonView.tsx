"use client";
import { useEffect, useMemo } from "react";
import type { LessonFixture } from "@openstudy/shared";
import { usePlayer } from "@/board/usePlayer";
import { LessonShell } from "@/board/LessonShell";
import { entryFromEvent, pushEntry, type TranscriptEntry } from "@/lib/transcript";

export function LessonView({ fixture }: { fixture: LessonFixture }) {
  const player = usePlayer(fixture);

  // Autoplay unless the URL says otherwise (tests use ?autoplay=0 and ?finish=1).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("finish") === "1") player.finish();
    else if (q.get("autoplay") !== "0") player.setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Transcript derived from the events played so far. Keyed on how many have
  // played, not the clock: the position moves every frame, the count only when
  // something lands, so the chat is not rebuilt (and re-scrolled) 60 times a second.
  const played = playedCount(fixture.events, player.position);
  const transcript = useMemo(() => {
    let list: TranscriptEntry[] = [];
    for (let i = 0; i < played; i++) {
      const entry = entryFromEvent(fixture.events[i].event);
      if (entry) list = pushEntry(list, entry);
    }
    return list;
  }, [fixture.events, played]);

  const turn = player.playing ? "speaking" : player.position >= player.total ? "done" : "idle";

  return (
    <LessonShell
      title={fixture.title}
      state={player.state}
      turn={turn}
      transcript={transcript}
      writingId={player.writingId}
      extraControls={
        <div className="ui-card flex items-center gap-1 p-1">
          <button className="ui-btn primary" onClick={() => player.setPlaying(!player.playing)} aria-label={player.playing ? "Pause" : "Play"}>
            {player.playing ? "❚❚" : "▶"}
          </button>
          <select className="ui-btn bg-transparent" value={player.speed} onChange={(e) => player.setSpeed(Number(e.target.value))} aria-label="Playback speed">
            {[0.5, 1, 1.5, 2, 4].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button className="ui-btn" onClick={() => player.reset()} aria-label="Restart">↺</button>
          <button className="ui-btn" onClick={() => player.finish()} aria-label="Skip to end">⏭</button>
          <span className="px-2 text-[12px] tabular-nums text-neutral-400">{Math.round((100 * player.position) / Math.max(1, player.total))}%</span>
        </div>
      }
    />
  );
}

/** Events at or before `position` (events are in time order): a binary search, run every frame. */
function playedCount(events: { at: number }[], position: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].at <= position) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
