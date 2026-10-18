/**
 * Geometry for hand-drawn annotations. All coordinates are in the target
 * block's local space (unscaled CSS pixels), so the overlay SVG can sit on
 * top of the block and inherit the world transform.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Deterministic pseudo-random so a given annotation always looks the same. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Fold text so a tutor's "match" finds the board text even when quotes,
 * dashes, case or spacing differ. Returns the folded string and, for each
 * folded character, its index in the original.
 */
export function foldText(s: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < s.length; i++) {
    let c = s[i].toLowerCase();
    if (/[\u2018\u2019\u201a\u2032`]/.test(c)) c = "'";
    else if (/[\u201c\u201d\u201e\u2033]/.test(c)) c = '"';
    else if (/[\u2010-\u2015\u2212]/.test(c)) c = "-";
    else if (/[\u00a0\s]/.test(c)) c = " ";
    if (c === " ") {
      if (lastSpace) continue;
      lastSpace = true;
    } else lastSpace = false;
    folded += c;
    map.push(i);
  }
  return { folded: folded.replace(/ $/, ""), map };
}

/** Locate `match` in `text` tolerantly. Returns original [start, end) or null. */
export function findMatch(text: string, match: string): [number, number] | null {
  const exact = text.indexOf(match);
  if (exact !== -1) return [exact, exact + match.length];
  const t = foldText(text);
  const m = foldText(match).folded.trim();
  if (!m) return null;
  let idx = t.folded.indexOf(m);
  if (idx === -1) {
    // last resort: ignore punctuation entirely
    const strip = (x: string) => x.replace(/[^a-z0-9 ]/g, "");
    const tt = strip(t.folded);
    const mm = strip(m);
    if (!mm || mm.length < 3) return null;
    const j = tt.indexOf(mm);
    if (j === -1) return null;
    // map back through the characters that survived stripping
    const survivors: number[] = [];
    for (let i = 0; i < t.folded.length; i++) if (/[a-z0-9 ]/.test(t.folded[i])) survivors.push(i);
    idx = survivors[j];
    const endF = survivors[Math.min(survivors.length - 1, j + mm.length - 1)];
    return [t.map[idx], t.map[endF] + 1];
  }
  return [t.map[idx], t.map[idx + m.length - 1] + 1];
}

/**
 * Find `match` in the text content of `root` and return the client rects of
 * each rendered line, converted to root-local unscaled coordinates. Empty
 * when the phrase is not on the block: the caller then skips the mark
 * rather than painting the whole block.
 */
export function measureMatch(root: HTMLElement, match: string, scale: number): Rect[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let full = "";
  const starts: number[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    starts.push(full.length);
    full += t.data;
    nodes.push(t);
  }
  const found = findMatch(full, match);
  if (!found) return [];
  const [idx, end] = found;
  const locate = (pos: number, preferEnd: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const s = starts[i];
      if (pos > s || (pos === s && (!preferEnd || i === 0))) return { node: nodes[i], offset: pos - s };
    }
    return { node: nodes[0], offset: 0 };
  };
  const a = locate(idx, false);
  const b = locate(end, true);
  const range = document.createRange();
  range.setStart(a.node, Math.min(a.offset, a.node.data.length));
  range.setEnd(b.node, Math.min(b.offset, b.node.data.length));
  const base = root.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue;
    rects.push({ x: (r.left - base.left) / scale, y: (r.top - base.top) / scale, w: r.width / scale, h: r.height / scale });
  }
  return mergeLineRects(rects);
}

/** Merge rects that sit on the same line (inline children produce several). */
function mergeLineRects(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < 4) {
      const x = Math.min(last.x, r.x);
      const right = Math.max(last.x + last.w, r.x + r.w);
      last.x = x;
      last.w = right - x;
      last.h = Math.max(last.h, r.h);
    } else out.push({ ...r });
  }
  return out;
}

export function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** A highlighter stroke: a slightly skewed band, a touch taller than the text, with soft ends. */
export function markerPath(r: Rect, rnd: () => number): string {
  const pad = -r.h * 0.06;
  const x0 = r.x - 6;
  const x1 = r.x + r.w + 6;
  const y0 = r.y + pad;
  const y1 = r.y + r.h - pad;
  const j = () => (rnd() - 0.5) * 3;
  return `M${x0 + 4 + j()} ${y0 + j()} L${x1 + j()} ${y0 + 2 + j()} Q${x1 + 6} ${(y0 + y1) / 2} ${x1 - 3 + j()} ${y1 + j()} L${x0 + j()} ${y1 - 2 + j()} Q${x0 - 5} ${(y0 + y1) / 2} ${x0 + 4} ${y0} Z`;
}

/** A hand-drawn ellipse that overshoots its start a little, like a real pen. */
export function wobblyEllipse(r: Rect, rnd: () => number): { d: string; length: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2 + Math.max(10, r.h * 0.35);
  const ry = r.h / 2 + Math.max(7, r.h * 0.3);
  const n = 28;
  const pts: [number, number][] = [];
  const start = -0.6 + rnd() * 0.4;
  for (let i = 0; i <= n + 3; i++) {
    const t = start + (i / n) * Math.PI * 2;
    const jr = 1 + (rnd() - 0.5) * 0.06;
    const drift = (i / n) * 2.5;
    pts.push([cx + Math.cos(t) * rx * jr, cy + Math.sin(t) * ry * jr + drift]);
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const mx = (px + x) / 2;
    const my = (py + y) / 2;
    d += ` Q${px.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    length += Math.hypot(x - px, y - py);
  }
  return { d, length };
}

/** A wavy underline under one line of text. */
export function wavyUnderline(r: Rect, rnd: () => number): { d: string; length: number } {
  const y = r.y + r.h - 1;
  const step = 14;
  let d = `M${r.x - 2} ${y}`;
  let length = 0;
  let x = r.x - 2;
  let up = true;
  while (x < r.x + r.w + 2) {
    const nx = Math.min(x + step, r.x + r.w + 2);
    const cy = y + (up ? -3 : 3) + (rnd() - 0.5) * 1.5;
    d += ` Q${(x + nx) / 2} ${cy} ${nx} ${y + (rnd() - 0.5)}`;
    length += nx - x + 3;
    x = nx;
    up = !up;
  }
  return { d, length };
}
