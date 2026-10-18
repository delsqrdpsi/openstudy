"use client";
import type { ImageBlock as ImageBlockT } from "@openstudy/shared";

export const IMAGE_W = 528;
export const IMAGE_H = 288;

// A continuous scribble the pencil traces while the picture is generated.
const SCRIBBLE =
  "M60 150 C 90 70, 150 70, 180 150 S 270 230, 300 150 S 390 70, 420 150 S 480 210, 470 150 C 460 110, 400 110, 380 150 S 320 200, 290 150 S 230 100, 200 150 S 140 210, 110 150 S 70 110, 60 150 Z";

/** Loader: a soft frame with a scribble being drawn and undrawn. */
function Sketching() {
  return (
    <div className="wb-sketching" aria-label="Drawing">
      <svg viewBox={`0 0 ${IMAGE_W} ${IMAGE_H}`}>
        <path className="scribble" d={SCRIBBLE} fill="none" />
      </svg>
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
          <div className="wb-caption" style={{ padding: "12px 14px", border: "1.5px dashed rgba(31,42,55,0.25)", borderRadius: 10 }}>
            Couldn&apos;t draw this one.
          </div>
        ) : (
          <Sketching />
        )}
      </div>
      {block.caption && <div className="wb-caption">{block.caption}</div>}
    </div>
  );
}
