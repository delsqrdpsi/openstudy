"use client";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef } from "react";
import type { AnnotationBlock, BoardState, ContentBlock } from "@openstudy/shared";
import { DEFAULT_LAYOUT, isContentBlock, layoutColumns } from "@openstudy/shared";
import { useViewport } from "./useViewport";
import { HtmlBlock } from "./blocks/HtmlBlock";
import { SvgBlock } from "./blocks/SvgBlock";
import { ImageBlock } from "./blocks/ImageBlock";
import { AnnotationLayer } from "./blocks/AnnotationLayer";

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
  const { camera, panning, setScaleCentered, fitRect, revealRect, userMovedRecently } = useViewport(viewportRef);

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

  // Follow the tutor: reveal the focused block unless the user just moved.
  const lastFocus = useRef<string | null>(null);
  const lastFocusHeight = useRef(0);
  useLayoutEffect(() => {
    if (!follow || !state.focusId) return;
    const p = layout.placements.get(state.focusId);
    if (!p) return;
    const grew = state.focusId === lastFocus.current && p.height > lastFocusHeight.current + 8;
    if (state.focusId !== lastFocus.current || grew) {
      lastFocus.current = state.focusId;
      lastFocusHeight.current = p.height;
      if (!userMovedRecently()) revealRect(p.x, p.y, p.width, p.height);
    }
  }, [follow, state.focusId, layout, revealRect, userMovedRecently]);

  useEffect(() => onScaleChange?.(camera.scale), [camera.scale, onScaleChange]);

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
      <div className="wb-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
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

function BlockView({ block, writing }: { block: ContentBlock; writing: boolean }) {
  switch (block.type) {
    case "html":
      return <HtmlBlock block={block} writing={writing} />;
    case "svg":
      return <SvgBlock block={block} />;
    case "image":
      return <ImageBlock block={block} />;
  }
}
