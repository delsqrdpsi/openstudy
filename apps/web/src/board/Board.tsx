"use client";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef } from "react";
import type { AnnotationBlock, BoardState, ContentBlock } from "@openstudy/shared";
import { DEFAULT_LAYOUT, isContentBlock, layoutColumns } from "@openstudy/shared";
import { useViewport } from "./useViewport";
import { HtmlBlock } from "./blocks/HtmlBlock";
import { SvgBlock } from "./blocks/SvgBlock";
import { ImageBlock } from "./blocks/ImageBlock";
import { EmbedBlock } from "./blocks/EmbedBlock";
import { PageBlock } from "./blocks/PageBlock";
import { AnnotationLayer } from "./blocks/AnnotationLayer";
import { finishStrokes, planStrokes, renderStrokes, type StrokePlan } from "./strokes";

export interface BoardHandle {
  zoomTo: (scale: number) => void;
  fitAll: () => void;
  scale: number;
}

interface Props {
  state: BoardState;
  /** Id of the html block currently being streamed, for the caret. */
  writingId?: string | null;
  follow: boolean;
  onScaleChange?: (scale: number) => void;
}

export const Board = forwardRef<BoardHandle, Props>(function Board({ state, writingId, follow, onScaleChange }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const { camera, panning, setScaleCentered, fitRect, focusRect, userMovedRecently } = useViewport(viewportRef);
  const scaleRef = useRef(camera.scale);
  useLayoutEffect(() => {
    scaleRef.current = camera.scale;
  }, [camera.scale]);

  const content = useMemo(() => state.blocks.filter(isContentBlock), [state.blocks]);
  const annotationsByTarget = useMemo(() => {
    const m = new Map<string, AnnotationBlock[]>();
    for (const b of state.blocks) {
      if (b.type !== "annotation") continue;
      const list = m.get(b.target) ?? [];
      list.push(b);
      m.set(b.target, list);
    }
    return m;
  }, [state.blocks]);

  // Measured heights drive the column layout.
  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  const [versions, setVersions] = useState<Map<string, number>>(new Map());
  const [targets, setTargets] = useState<Map<string, HTMLElement>>(new Map());
  const observer = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    observer.current = new ResizeObserver((entries) => {
      setHeights((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.itemId;
          if (!id) continue;
          const h = Math.ceil(e.contentRect.height);
          if (next.get(id) !== h) {
            next.set(id, h);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setVersions((prev) => {
        const next = new Map(prev);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.itemId;
          if (id) next.set(id, (next.get(id) ?? 0) + 1);
        }
        return next;
      });
    });
    return () => observer.current?.disconnect();
  }, []);

  // One stable ref callback for every item. React 19 calls the returned
  // cleanup on unmount, so we never need a per-id closure (which would be a
  // new function each render and re-run on every commit).
  const attach = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const id = el.dataset.itemId!;
    observer.current?.observe(el);
    setTargets((prev) => {
      if (prev.get(id) === el) return prev;
      const next = new Map(prev);
      next.set(id, el);
      return next;
    });
    return () => {
      observer.current?.unobserve(el);
      setTargets((prev) => {
        if (prev.get(id) !== el) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };
  }, []);

  const layout = useMemo(() => layoutColumns(content, heights, DEFAULT_LAYOUT), [content, heights]);

  // Follow the tutor: frame the block it is writing or pointing at, unless the student just moved the camera.
  const lastFocus = useRef<string | null>(null);
  const lastFocusHeight = useRef(0);
  const pendingFocus = useRef(false);
  // A new mark (highlight, circle, underline) on the focused block counts as pointing at it again.
  const focusKey = state.focusId ? `${state.focusId}:${annotationsByTarget.get(state.focusId)?.length ?? 0}` : null;
  useLayoutEffect(() => {
    if (!follow || !state.focusId || !focusKey) return;
    const p = layout.placements.get(state.focusId);
    if (!p) return;
    const changed = focusKey !== lastFocus.current;
    const grew = !changed && p.height > lastFocusHeight.current + 8;
    if (!changed && !grew && !pendingFocus.current) return;
    lastFocus.current = focusKey;
    lastFocusHeight.current = p.height;
    if (userMovedRecently()) {
      // Come back to it once the student lets go of the camera.
      pendingFocus.current = true;
      return;
    }
    pendingFocus.current = false;
    // Wide blocks (tables, models) are measured; columns are not wider than their blocks.
    const el = targets.get(state.focusId);
    const width = el ? Math.max(p.width, el.offsetWidth) : p.width;
    focusRect(p.x, p.y, width, p.height, writingId === state.focusId);
  }, [follow, state.focusId, focusKey, layout, focusRect, userMovedRecently, writingId, targets]);

  // A focus that arrived while the student held the camera is honoured once they let go.
  useEffect(() => {
    if (!follow) return;
    const t = window.setInterval(() => {
      if (!pendingFocus.current || userMovedRecently() || !state.focusId) return;
      const p = layout.placements.get(state.focusId);
      if (!p) return;
      pendingFocus.current = false;
      const el = targets.get(state.focusId);
      focusRect(p.x, p.y, el ? Math.max(p.width, el.offsetWidth) : p.width, p.height, writingId === state.focusId);
    }, 1000);
    return () => window.clearInterval(t);
  }, [follow, state.focusId, layout, focusRect, userMovedRecently, writingId, targets]);

  useEffect(() => onScaleChange?.(camera.scale), [camera.scale, onScaleChange]);

  // Strokes are drawn one plan at a time, in the order they appeared.
  const plans = useRef<{ plan: StrokePlan; started: number }[]>([]);
  const raf = useRef(0);
  const runPlans = useCallback(() => {
    if (raf.current) return;
    const step = () => {
      const q = plans.current;
      if (!q.length) {
        raf.current = 0;
        return;
      }
      const now = performance.now();
      const speed = q.length > 2 ? 2 : 1; // behind: draw faster
      const cur = q[0];
      if (!cur.started) cur.started = now;
      const tip = renderStrokes(cur.plan, (now - cur.started) * speed);
      if (!tip) {
        finishStrokes(cur.plan);
        q.shift();
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // New diagrams and annotations get drawn on. Before the next paint so nothing flashes.
  const seen = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    const drawable = state.blocks.filter((b) => b.type === "svg" || b.type === "annotation");
    if (!seen.current) {
      // First paint (or a reopened board): everything is already drawn.
      seen.current = new Set(drawable.map((b) => b.id));
      return;
    }
    const world = worldRef.current;
    if (!world) return;
    const fresh = drawable.filter((b) => !seen.current!.has(b.id));
    if (!fresh.length) return;
    if (fresh.length > 4) {
      // A replay, not a tutor drawing: land it all at once.
      for (const b of fresh) seen.current.add(b.id);
      return;
    }
    for (const b of fresh) {
      const sel = b.type === "svg" ? `[data-item-id="${CSS.escape(b.id)}"] svg` : `[data-anno-id="${CSS.escape(b.id)}"]`;
      const roots = Array.from(world.querySelectorAll(sel));
      if (!roots.length) continue; // not rendered yet (annotation waiting for its target); try next commit
      seen.current.add(b.id);
      plans.current.push({ plan: planStrokes(b.type === "svg" ? roots.slice(0, 1) : roots), started: 0 });
    }
    if (plans.current.length) runPlans();
    // targets: annotation overlays render once their target element is known.
  }, [state.blocks, targets, runPlans]);

  useImperativeHandle(
    ref,
    () => ({
      zoomTo: setScaleCentered,
      fitAll: () => fitRect(0, 0, Math.max(layout.width, 600), Math.max(layout.height, 400)),
      scale: camera.scale,
    }),
    [setScaleCentered, fitRect, layout.width, layout.height, camera.scale],
  );

  return (
    <div ref={viewportRef} className={`wb-viewport wb-paper${panning ? " is-panning" : ""}`}>
      <div ref={worldRef} className="wb-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
        {content.map((block) => {
          const p = layout.placements.get(block.id);
          if (!p) return null;
          const annos = annotationsByTarget.get(block.id);
          return (
            <div
              key={block.id}
              ref={attach}
              data-item-id={block.id}
              className="wb-item wb-item-enter"
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: block.type === "html" ? p.width : undefined }}
            >
              <div style={{ position: "relative" }}>
                <BlockView block={block} writing={writingId === block.id} />
                {annos && (
                  <AnnotationLayer
                    annotations={annos}
                    targetEl={targets.get(block.id) ?? null}
                    scale={camera.scale}
                    version={versions.get(block.id) ?? 0}
                    boxes={block.type === "page" ? block.boxes : undefined}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/** The last non-empty text node under `root`, where the writing currently ends. */

function BlockView({ block, writing }: { block: ContentBlock; writing: boolean }) {
  switch (block.type) {
    case "html":
      return <HtmlBlock block={block} writing={writing} />;
    case "svg":
      return <SvgBlock block={block} />;
    case "image":
      return <ImageBlock block={block} />;
    case "embed":
      return <EmbedBlock block={block} />;
    case "page":
      return <PageBlock block={block} />;
  }
}
