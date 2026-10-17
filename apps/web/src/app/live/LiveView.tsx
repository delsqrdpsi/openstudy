"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveSession } from "@/board/useLiveSession";
import { LessonShell } from "@/board/LessonShell";

/** A live lesson. The intake (topic and materials) arrives from the home page. */
export function LiveView() {
  const params = useSearchParams();
  const live = useLiveSession();
  const started = useRef(false);

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
      options={live.options}
      writingId={live.writingId}
      statusNote={note}
      onSay={live.say}
      onInterrupt={live.interrupt}
      extraControls={
        live.info ? (
          <span className="ui-card px-3 py-1.5 text-[12px] text-neutral-500">
            {live.info.brain} · {live.info.model}
          </span>
        ) : null
      }
    />
  );
}
