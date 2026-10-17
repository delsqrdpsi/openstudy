"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.15;
export const MAX_SCALE = 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Pan and zoom for the board. One transform on the world element. Wheel pans,
 * ctrl/cmd+wheel (and trackpad pinch, which browsers report as ctrl+wheel)
 * zooms around the cursor. Drag pans when it starts on paper, when space is
 * held, or with the middle button, so text in blocks stays selectable.
 */
export function useViewport(viewportRef: React.RefObject<HTMLDivElement | null>) {
  const [camera, setCamera] = useState<Camera>({ x: 80, y: 80, scale: 1 });
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  const [panning, setPanning] = useState(false);
  const spaceHeld = useRef(false);
  const userMovedAt = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const markUserMove = () => {
    userMovedAt.current = performance.now();
  };

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    setCamera((c) => {
      const scale = clamp(c.scale * factor, MIN_SCALE, MAX_SCALE);
      const k = scale / c.scale;
      return { scale, x: px - (px - c.x) * k, y: py - (py - c.y) * k };
    });
  }, [viewportRef]);

  const setScaleCentered = useCallback((scale: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const c = cameraRef.current;
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, scale / c.scale);
    markUserMove();
  }, [viewportRef, zoomAt]);

  const animRef = useRef<number | null>(null);
  const animateTo = useCallback((target: Camera, ms = 420) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const from = cameraRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const next = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        scale: from.scale + (target.scale - from.scale) * e,
      };
      cameraRef.current = next;
      setCamera(next);
      if (t < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  /** Fit a world rectangle into the viewport with padding. */
  const fitRect = useCallback((wx: number, wy: number, ww: number, wh: number, pad = 60, animate = true) => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const scale = clamp(Math.min((r.width - pad * 2) / Math.max(ww, 1), (r.height - pad * 2) / Math.max(wh, 1)), MIN_SCALE, MAX_SCALE);
    const x = (r.width - ww * scale) / 2 - wx * scale;
    const y = (r.height - wh * scale) / 2 - wy * scale;
    if (animate) animateTo({ x, y, scale });
    else setCamera({ x, y, scale });
  }, [viewportRef, animateTo]);

  /**
   * Pan so a world rect is visible, keeping scale. Used by follow-tutor.
   * Prefers keeping the left edge of the board in view, so earlier columns
   * stay readable while the tutor writes further right.
   */
  const revealRect = useCallback((wx: number, wy: number, ww: number, wh: number, pad = 80) => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const c = cameraRef.current;
    const sx = wx * c.scale + c.x;
    const sy = wy * c.scale + c.y;
    const sw = ww * c.scale;
    const sh = wh * c.scale;
    let x = c.x;
    let y = c.y;
    const fitsFromOrigin = (wx + ww) * c.scale + pad * 2 <= r.width;
    if (fitsFromOrigin) x = Math.min(c.x, pad) === c.x && sx >= pad && sx + sw <= r.width - pad ? c.x : pad;
    else if (sx < pad) x = c.x + (pad - sx);
    else if (sx + sw > r.width - pad) x = c.x + (r.width - pad - (sx + sw));
    if (sy < pad) y = c.y + (pad - sy);
    else if (sy + sh > r.height - pad) y = c.y + (r.height - pad - (sy + sh));
    if (sh > r.height - pad * 2) y = c.y + (pad - sy); // tall block: show its top
    if (x === c.x && y === c.y) return;
    animateTo({ x, y, scale: c.scale });
  }, [viewportRef, animateTo]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      markUserMove();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0022);
        zoomAt(e.clientX, e.clientY, factor);
      } else {
        setCamera((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceHeld.current = e.type === "keydown";
        if (e.type === "keydown") e.preventDefault();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = Array.from(pointers.current.values());
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        drag.current = null;
        return;
      }
      const onText = (e.target as HTMLElement).closest?.(".wb-html, button, input, textarea, a");
      const wantsPan = e.button === 1 || spaceHeld.current || !onText || e.pointerType === "touch";
      if (!wantsPan) return;
      drag.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      setPanning(true);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && pointers.current.size === 2) {
        const [a, b] = Array.from(pointers.current.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const factor = dist / pinch.current.dist;
        zoomAt(cx, cy, factor);
        setCamera((c) => ({ ...c, x: c.x + (cx - pinch.current!.cx), y: c.y + (cy - pinch.current!.cy) }));
        pinch.current = { dist, cx, cy };
        markUserMove();
        return;
      }
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      drag.current = { x: e.clientX, y: e.clientY };
      if (dx || dy) markUserMove();
      setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (drag.current) {
        drag.current = null;
        setPanning(false);
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [viewportRef, zoomAt]);

  const userMovedRecently = (ms = 4000) => performance.now() - userMovedAt.current < ms;

  return { camera, panning, setScaleCentered, fitRect, revealRect, userMovedRecently };
}
