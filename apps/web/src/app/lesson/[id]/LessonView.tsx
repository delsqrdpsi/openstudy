"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LessonFixture } from "@openstudy/shared";
import { Board, type BoardHandle } from "@/board/Board";
import { usePlayer } from "@/board/usePlayer";
import { Captions } from "@/board/Captions";
import { Avatar } from "@/board/Avatar";

export function LessonView({ fixture }: { fixture: LessonFixture }) {
  const player = usePlayer(fixture);
  const board = useRef<BoardHandle>(null);
  const [scale, setScale] = useState(1);
  const [follow, setFollow] = useState(true);
  const onScale = useCallback((s: number) => setScale(s), []);

  // Autoplay unless the URL says otherwise (tests use ?autoplay=0&finish=1).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("finish") === "1") player.finish();
    else if (q.get("autoplay") !== "0") player.setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = Math.round(scale * 100);
  const speaking = player.playing && player.state.caption.length > 0;

  return (
    <main className="relative h-full w-full overflow-hidden">
      <Board ref={board} state={player.state} writingId={player.writingId} follow={follow} onScaleChange={onScale} />

      {/* top-left: home + title */}
      <div className="pointer-events-none absolute left-5 top-5 z-20 flex items-center gap-3">
        <Link href="/" className="pointer-events-auto rounded-full bg-white px-3 py-2 text-sm font-medium shadow-[0_4px_24px_rgba(0,0,0,0.1)] hover:bg-neutral-50">
          ← Boards
        </Link>
        <div className="rounded-full bg-white/80 px-3 py-1 text-sm text-neutral-600">{fixture.title}</div>
      </div>

      {/* top-right: zoom */}
      <div className="absolute right-5 top-5 z-20 flex items-center gap-1 rounded-full bg-white p-1 shadow-[0_4px_24px_rgba(0,0,0,0.1)]">
        <Btn onClick={() => board.current?.zoomTo(scale / 1.2)} label="Zoom out">−</Btn>
        <button className="min-w-14 rounded-full px-2 py-1 text-sm tabular-nums hover:bg-neutral-100" onClick={() => board.current?.zoomTo(1)} title="Zoom to 100%">
          {pct}%
        </button>
        <Btn onClick={() => board.current?.zoomTo(scale * 1.2)} label="Zoom in">+</Btn>
        <Btn onClick={() => board.current?.fitAll()} label="Fit board">⤢</Btn>
      </div>

      <Avatar speaking={speaking} />
      <Captions text={player.state.caption} speed={player.speed} />

      {/* bottom-right: playback (stands in for the mic and chat controls) */}
      <div className="absolute bottom-6 right-6 z-20 flex items-center gap-2 rounded-full bg-white p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.1)]">
        <button
          className={`rounded-full px-3 py-1.5 text-sm ${follow ? "bg-sky-100 text-sky-700" : "hover:bg-neutral-100"}`}
          onClick={() => setFollow((f) => !f)}
          title="Camera follows the tutor"
        >
          Follow
        </button>
        <select
          className="rounded-full bg-transparent px-2 py-1 text-sm"
          value={player.speed}
          onChange={(e) => player.setSpeed(Number(e.target.value))}
          aria-label="Playback speed"
        >
          {[0.5, 1, 1.5, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <Btn onClick={() => player.reset()} label="Restart">↺</Btn>
        <button
          className="h-10 w-10 rounded-full bg-sky-500 text-white hover:bg-sky-600"
          onClick={() => player.setPlaying(!player.playing)}
          aria-label={player.playing ? "Pause" : "Play"}
        >
          {player.playing ? "❚❚" : "▶"}
        </button>
        <Btn onClick={() => player.finish()} label="Skip to end">⏭</Btn>
      </div>

      {/* progress hairline */}
      <div className="pointer-events-none absolute bottom-0 left-0 z-20 h-0.5 bg-sky-400" style={{ width: `${player.total ? (100 * player.position) / player.total : 0}%` }} />
    </main>
  );
}

function Btn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button className="h-9 w-9 rounded-full text-lg leading-none hover:bg-neutral-100" onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}
