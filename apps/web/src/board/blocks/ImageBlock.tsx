"use client";
import { useState } from "react";
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
  // The picture's drawn size, once it has loaded. The frame shrinks to it so
  // marks placed by position (at=right) land on the picture, not beside it.
  const [fit, setFit] = useState<{ url: string; w: number; h: number } | null>(null);
  const size = fit && fit.url === block.url ? fit : { w: IMAGE_W, h: IMAGE_H };
  const measure = (img: HTMLImageElement | null) => {
    const url = block.url;
    if (!url || !img || !img.complete || !img.naturalWidth || !img.naturalHeight) return;
    const s = Math.min(1, IMAGE_W / img.naturalWidth, IMAGE_H / img.naturalHeight);
    const w = Math.round(img.naturalWidth * s);
    const h = Math.round(img.naturalHeight * s);
    setFit((prev) => (prev && prev.url === url && prev.w === w && prev.h === h ? prev : { url, w, h }));
  };
  return (
    <div data-block-id={block.id} style={{ width: IMAGE_W }}>
      <div data-frame="" style={{ width: size.w, height: size.h, position: "relative" }}>
        {block.status === "ready" && block.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={measure}
            src={block.url}
            alt={block.prompt}
            className="wb-enter"
            onLoad={(e) => measure(e.currentTarget)}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", objectPosition: "left top", mixBlendMode: "multiply" }}
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
