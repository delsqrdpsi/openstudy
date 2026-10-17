"use client";
import { useMemo } from "react";
import type { AnnotationBlock } from "@openstudy/shared";
import { ANNOTATION_COLORS } from "@openstudy/shared";
import { hashId, markerPath, measureMatch, seeded, union, wavyUnderline, wobblyEllipse, type Rect } from "../annotations";

interface Props {
  annotations: AnnotationBlock[];
  /** The rendered target block element. */
  targetEl: HTMLElement | null;
  scale: number;
  /** Changes whenever the target's content or size changes, to re-measure. */
  version: number;
}

type Drawn =
  | { id: string; kind: "highlight"; color: string; paths: string[] }
  | { id: string; kind: "circle"; color: string; d: string; length: number }
  | { id: string; kind: "underline"; color: string; paths: { d: string; length: number }[] };

export function AnnotationLayer({ annotations, targetEl, scale, version }: Props) {
  const drawn = useMemo<Drawn[]>(() => {
    const out: Drawn[] = [];
    if (!targetEl) return out;
    for (const a of annotations) {
      let rects: Rect[] = [];
      if (a.region) {
        const r = targetEl.getBoundingClientRect();
        const W = r.width / scale;
        const H = r.height / scale;
        rects = [{ x: a.region.x * W, y: a.region.y * H, w: a.region.w * W, h: a.region.h * H }];
      } else if (a.match) rects = measureMatch(targetEl, a.match, scale);
      if (!rects.length) {
        // Fall back to the whole block so the gesture still lands somewhere.
        const r = targetEl.getBoundingClientRect();
        rects = [{ x: 0, y: 0, w: r.width / scale, h: r.height / scale }];
      }
      const rnd = seeded(hashId(a.id));
      const color = a.color ?? ANNOTATION_COLORS[a.kind];
      if (a.kind === "highlight") out.push({ id: a.id, kind: "highlight", color, paths: rects.map((r) => markerPath(r, rnd)) });
      else if (a.kind === "circle") {
        const e = wobblyEllipse(union(rects), rnd);
        out.push({ id: a.id, kind: "circle", color, d: e.d, length: e.length });
      } else out.push({ id: a.id, kind: "underline", color, paths: rects.map((r) => wavyUnderline(r, rnd)) });
    }
    return out;
    // version is a re-measure trigger from the ResizeObserver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, targetEl, scale, version]);

  if (!drawn.length) return null;
  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
      aria-hidden
    >
      {drawn.map((d) =>
        d.kind === "highlight" ? (
          <g key={d.id} className="wb-anno-fill" data-anno-id={d.id} data-sweep="" style={{ mixBlendMode: "multiply" }}>
            {d.paths.map((p, i) => (
              <path key={i} d={p} fill={d.color} />
            ))}
          </g>
        ) : d.kind === "circle" ? (
          <path
            key={d.id}
            className="wb-anno-stroke"
            data-anno-id={d.id}
            d={d.d}
            fill="none"
            stroke={d.color}
            strokeWidth={3}
            strokeLinecap="round"
          />
        ) : (
          <g key={d.id} data-anno-id={d.id}>
            {d.paths.map((p, i) => (
              <path
                key={i}
                className="wb-anno-stroke"
                d={p.d}
                fill="none"
                stroke={d.color}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            ))}
          </g>
        ),
      )}
    </svg>
  );
}
