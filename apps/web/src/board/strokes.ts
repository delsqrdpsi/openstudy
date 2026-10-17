/**
 * Draw-on for everything a hand would draw: sketched diagram strokes,
 * circles and underlines, highlighter sweeps. A plan lists the strokes in
 * drawing order with a time slot each; `renderStrokes` sets each one's
 * progress for a moment in time and reports where the pen tip is, in client
 * pixels, so a pencil can ride along.
 */
export type StrokeKind = "stroke" | "sweep" | "fade";

export interface StrokeStep {
  el: SVGElement;
  kind: StrokeKind;
  /** Path length for strokes, width for sweeps, 0 for fades. */
  len: number;
  /** User-space box of the element, for sweeps. */
  box: DOMRect | null;
  start: number;
  end: number;
}

export interface StrokePlan {
  steps: StrokeStep[];
  total: number;
}

export interface PlanOptions {
  /** Drawing speed, in path pixels per second. */
  pxPerSec?: number;
  minMs?: number;
  maxMs?: number;
}

const GEOMETRY = "path, line, polyline, polygon, circle, ellipse, rect";

function isGeometry(el: Element): el is SVGGeometryElement {
  return "getTotalLength" in el && typeof (el as SVGGeometryElement).getTotalLength === "function";
}

/**
 * Plan the draw-on of what sits under `roots`. Elements marked
 * `data-sweep` are revealed left to right (highlighter); elements marked
 * `data-fade` fade in at the end (diagram labels); every other geometry is
 * stroked along its length. Every element is put in its hidden state here,
 * so call this before the next paint.
 */
export function planStrokes(roots: Element[], opts: PlanOptions = {}): StrokePlan {
  const pxPerSec = opts.pxPerSec ?? 700;
  const minMs = opts.minMs ?? 450;
  const maxMs = opts.maxMs ?? 2800;
  const strokes: Omit<StrokeStep, "start" | "end">[] = [];
  const fades: SVGElement[] = [];
  for (const root of roots) {
    const all: Element[] = root.matches(GEOMETRY) ? [root] : [];
    all.push(...Array.from(root.querySelectorAll(GEOMETRY)));
    for (const el of all) {
      if (!(el instanceof SVGElement)) continue;
      if (el.closest("[data-fade]")) continue;
      if (el.closest("[data-sweep]")) {
        const box = safeBBox(el);
        strokes.push({ el, kind: "sweep", len: box ? box.width : 0, box });
        continue;
      }
      if (!isGeometry(el)) continue;
      let len = 0;
      try {
        len = el.getTotalLength();
      } catch {
        continue;
      }
      if (!Number.isFinite(len) || len <= 0) continue;
      strokes.push({ el, kind: "stroke", len, box: null });
    }
    for (const f of Array.from(root.querySelectorAll<SVGElement>("[data-fade]"))) fades.push(f);
    if (root instanceof SVGElement && root.hasAttribute("data-fade")) fades.push(root);
  }

  const totalLen = strokes.reduce((n, s) => n + s.len, 0);
  const drawMs = Math.min(maxMs, Math.max(minMs, (totalLen / pxPerSec) * 1000));
  const steps: StrokeStep[] = [];
  let t = 0;
  for (const s of strokes) {
    const slot = totalLen > 0 ? Math.max(60, (s.len / totalLen) * drawMs) : drawMs / Math.max(1, strokes.length);
    steps.push({ ...s, start: t, end: t + slot });
    t += slot;
  }
  const fadeMs = fades.length ? 260 : 0;
  for (const el of fades) steps.push({ el, kind: "fade", len: 0, box: null, start: t, end: t + fadeMs });
  const plan = { steps, total: t + fadeMs };
  renderStrokes(plan, 0);
  return plan;
}

/** Set every step's progress for time `t` (ms). Returns the pen tip in client pixels, or null when done. */
export function renderStrokes(plan: StrokePlan, t: number): { x: number; y: number } | null {
  let tip: { x: number; y: number } | null = null;
  for (const s of plan.steps) {
    const p = s.end > s.start ? clamp((t - s.start) / (s.end - s.start)) : 1;
    paint(s, p);
    if (tip || p >= 1 || s.kind === "fade") continue;
    tip = tipOf(s, p);
  }
  if (!tip && t < plan.total && plan.steps.length) {
    const last = plan.steps.filter((s) => s.kind !== "fade").at(-1);
    if (last) tip = tipOf(last, 1);
  }
  return t >= plan.total ? null : tip;
}

/** Everything drawn, no pen. */
export function finishStrokes(plan: StrokePlan) {
  for (const s of plan.steps) paint(s, 1);
}

function paint(s: StrokeStep, p: number) {
  const st = s.el.style;
  if (s.kind === "stroke") {
    st.strokeDasharray = `${s.len}`;
    st.strokeDashoffset = `${s.len * (1 - p)}`;
    if (p >= 1) {
      st.strokeDasharray = "";
      st.strokeDashoffset = "";
    }
  } else if (s.kind === "sweep") {
    st.clipPath = p >= 1 ? "" : `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`;
  } else st.opacity = p >= 1 ? "" : `${p}`;
}

function tipOf(s: StrokeStep, p: number): { x: number; y: number } | null {
  let pt: DOMPoint | null = null;
  const svg = s.el.ownerSVGElement;
  if (!svg) return null;
  if (s.kind === "stroke" && isGeometry(s.el)) {
    try {
      const q = s.el.getPointAtLength(p * s.len);
      pt = new DOMPoint(q.x, q.y);
    } catch {
      return null;
    }
  } else if (s.kind === "sweep" && s.box) {
    pt = new DOMPoint(s.box.x + p * s.box.width, s.box.y + s.box.height * 0.55);
  }
  if (!pt) return null;
  const m = (s.el as SVGGraphicsElement).getScreenCTM();
  if (!m) return null;
  const out = pt.matrixTransform(m);
  return { x: out.x, y: out.y };
}

function safeBBox(el: SVGElement): DOMRect | null {
  try {
    return (el as SVGGraphicsElement).getBBox();
  } catch {
    return null;
  }
}

function clamp(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
