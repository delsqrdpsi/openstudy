"use client";
import { memo, useMemo } from "react";
import type { AnnotationBlock } from "@openstudy/shared";
import { ANNOTATION_COLORS } from "@openstudy/shared";
import { hashId, markerPath, measureMatch, rectsForBoxes, sameList, seeded, union, wavyUnderline, wobblyEllipse, type Rect } from "../annotations";
import type { TextBox } from "@openstudy/shared";

interface Props {
  annotations: AnnotationBlock[];
  /** The rendered target block element. */
  targetEl: HTMLElement | null;
  /** Changes whenever the target's content or size changes, to re-measure. */
  version: number;
  /** For page blocks: positioned text, so marks land on words of the page image. */
  boxes?: TextBox[];
}

type Drawn =
  | { id: string; kind: "highlight"; color: string; paths: string[] }
  | { id: string; kind: "circle"; color: string; d: string; length: number }
  | { id: string; kind: "underline"; color: string; paths: { d: string; length: number }[] };

/**
 * Marks over one block. Everything is measured in the block's own unscaled
 * pixels: layout sizes come from offsetWidth/offsetHeight, and the screen
 * rects of matched text are divided by the block's on-screen scale, read off
 * the element itself. So zooming the camera never re-measures.
 */
function AnnotationLayerView({ annotations, targetEl, version, boxes }: Props) {
  const drawn = useMemo<Drawn[]>(() => {
    const out: Drawn[] = [];
    if (!targetEl) return out;
    const W = targetEl.offsetWidth;
    const H = targetEl.offsetHeight;
    // The camera's zoom, as it applies to this element right now.
    const onScreen = targetEl.getBoundingClientRect().width;
    const scale = W > 0 && onScreen > 0 ? onScreen / W : 1;
    for (const a of annotations) {
      let rects: Rect[] = [];
      if (a.region) rects = [{ x: a.region.x * W, y: a.region.y * H, w: a.region.w * W, h: a.region.h * H }];
      else if (a.match && boxes) rects = rectsForBoxes(boxes, a.match, W, H);
      else if (a.match) rects = measureMatch(targetEl, a.match, scale);
      // No match: skip the mark. A highlight over the whole block is worse than none.
      if (!rects.length) continue;
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
  }, [annotations, targetEl, version, boxes]);

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

// The list is rebuilt on every board change; re-measure only when its marks, the block or its size change.
export const AnnotationLayer = memo(AnnotationLayerView, (a, b) => a.targetEl === b.targetEl && a.version === b.version && a.boxes === b.boxes && sameList(a.annotations, b.annotations));
