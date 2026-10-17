"use client";
import { useMemo } from "react";
import type { ImageBlock as ImageBlockT } from "@openstudy/shared";
import { hashId, seeded } from "../annotations";

export const IMAGE_W = 528;
export const IMAGE_H = 288;

const PASTELS = ["#f6a5c0", "#9ad7f0", "#c4b5fd", "#a7e3b6", "#ffd68a", "#f9b4a3"];

export function ImageBlock({ block }: { block: ImageBlockT }) {
  const dots = useMemo(() => {
    const rnd = seeded(hashId(block.id));
    return Array.from({ length: 70 }, (_, i) => {
      // Cluster into a soft blob near the centre
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 0.42;
      return {
        key: i,
        left: `${50 + Math.cos(a) * r * 100 * (IMAGE_H / IMAGE_W)}%`,
        top: `${50 + Math.sin(a) * r * 100}%`,
        color: PASTELS[i % PASTELS.length],
        dx: `${(rnd() - 0.5) * 14}px`,
        dy: `${(rnd() - 0.5) * 14}px`,
        delay: `${-rnd() * 3}s`,
      };
    });
  }, [block.id]);

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
          <div className="wb-dotcloud" aria-label="Sketching...">
            {dots.map((d) => (
              <span
                key={d.key}
                style={{ left: d.left, top: d.top, background: d.color, animationDelay: d.delay, ["--dx" as string]: d.dx, ["--dy" as string]: d.dy }}
              />
            ))}
          </div>
        )}
      </div>
      {block.caption && <div className="wb-caption">{block.caption}</div>}
    </div>
  );
}
