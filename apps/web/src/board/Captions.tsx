"use client";
import { useEffect, useMemo, useState } from "react";

/** Shows the tutor's current line, revealing words at roughly speech pace. */
export function Captions({ text, speed = 1 }: { text: string; speed?: number }) {
  if (!text) return null;
  return <CaptionLine key={text} text={text} speed={speed} />;
}

function CaptionLine({ text, speed }: { text: string; speed: number }) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((k) => (k < words.length ? k + 1 : k)), 170 / speed);
    return () => window.clearInterval(id);
  }, [words.length, speed]);
  return (
    <div className="pointer-events-none absolute bottom-7 left-1/2 z-20 w-[min(760px,80vw)] -translate-x-1/2 text-center">
      <p className="text-[19px] leading-snug text-neutral-800">
        {words.map((w, i) => (
          <span key={i} className={i < n ? "opacity-100" : "opacity-30"} style={{ transition: "opacity 120ms" }}>
            {w}{" "}
          </span>
        ))}
      </p>
    </div>
  );
}
