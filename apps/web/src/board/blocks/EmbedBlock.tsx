"use client";
import { useEffect, useRef, useState } from "react";
import type { EmbedBlock as EmbedBlockT } from "@openstudy/shared";

export const EMBED_W = 640;
const HANDLE_H = 30;
const MIN_H = 160;
const MAX_H = 1400;

/**
 * An interactive model on the board: a self-contained page (an Anatomy
 * figure) in a sandboxed frame. Scripts run; nothing else is allowed.
 * Wheel events over the frame scroll the page inside it, so the frame
 * carries a small handle strip for panning the board. The page reports its
 * own height (the server adds a reporter to every figure page), and the
 * frame grows to fit so the whole model shows.
 */
export function EmbedBlock({ block }: { block: EmbedBlockT }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(block.height);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const data = e.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== "openstudy:figure-size" || typeof data.height !== "number") return;
      const h = Math.min(MAX_H, Math.max(MIN_H, Math.ceil(data.height))) + HANDLE_H;
      setHeight((prev) => (Math.abs(prev - h) < 2 ? prev : h));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div data-block-id={block.id} style={{ width: EMBED_W }}>
      <div className="wb-embed" style={{ height }}>
        <div className="wb-embed-handle" title="Drag here to move the board">
          <span>{block.title ?? "Interactive model"}</span>
          <a href={block.src} target="_blank" rel="noreferrer" className="wb-embed-open" title="Open full size">
            ↗
          </a>
        </div>
        <iframe ref={frame} src={block.src} title={block.title ?? "Interactive model"} sandbox="allow-scripts" loading="lazy" style={{ height: height - HANDLE_H }} />
      </div>
      {block.caption && <div className="wb-caption">{block.caption}</div>}
    </div>
  );
}
