"use client";
import type { ImageBlock as ImageBlockT } from "@openstudy/shared";

export const IMAGE_W = 528;
export const IMAGE_H = 288;

/** While a picture is being drawn, a pencil hatches the empty frame. */
function Sketching() {
  const lines = Array.from({ length: 9 }, (_, i) => {
    const x = 40 + i * 52;
    return <line key={i} className="hatch" x1={x} y1={34} x2={x - 120} y2={254} style={{ animationDelay: `${i * 0.12}s` }} />;
  });
  return (
    <div className="wb-sketching" aria-label="Sketching">
      <svg viewBox={`0 0 ${IMAGE_W} ${IMAGE_H}`}>{lines}</svg>
      <span className="label">sketching...</span>
    </div>
  );
}

export function ImageBlock({ block }: { block: ImageBlockT }) {
  return (
    <div data-block-id={block.id} style={{ width: IMAGE_W }}>
      <div style={{ width: IMAGE_W, height: IMAGE_H, position: "relative" }}>
        {block.status === "ready" && block.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={block.url}
            alt={block.prompt}
            className="wb-enter"
            style={{ display: "block", maxWidth: IMAGE_W, maxHeight: IMAGE_H, objectFit: "contain", mixBlendMode: "multiply" }}
            draggable={false}
          />
        ) : block.status === "failed" ? (
          <div className="wb-caption" style={{ padding: 12, border: "1.5px dashed #c9c9c9", borderRadius: 8 }}>
            Couldn&apos;t draw this one. {block.prompt}
          </div>
        ) : (
          <Sketching />
        )}
      </div>
      {block.caption && <div className="wb-caption">{block.caption}</div>}
    </div>
  );
}
