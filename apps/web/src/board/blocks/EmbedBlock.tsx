"use client";
import type { EmbedBlock as EmbedBlockT } from "@openstudy/shared";

export const EMBED_W = 560;

/**
 * An interactive model on the board: a self-contained page (an Anatomy
 * figure) in a sandboxed frame. Scripts run; nothing else is allowed.
 * Wheel events over the frame scroll the page inside it, so the frame
 * carries a small handle strip for panning the board.
 */
export function EmbedBlock({ block }: { block: EmbedBlockT }) {
  return (
    <div data-block-id={block.id} style={{ width: EMBED_W }}>
      <div className="wb-embed" style={{ height: block.height }}>
        <div className="wb-embed-handle" title="Drag here to move the board">
          <span>{block.title ?? "Interactive model"}</span>
          <a href={block.src} target="_blank" rel="noreferrer" className="wb-embed-open" title="Open full size">
            ↗
          </a>
        </div>
        <iframe src={block.src} title={block.title ?? "Interactive model"} sandbox="allow-scripts" loading="lazy" />
      </div>
      {block.caption && <div className="wb-caption">{block.caption}</div>}
    </div>
  );
}
