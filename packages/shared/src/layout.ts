import type { ContentBlock } from "./blocks";

/**
 * Column flow layout. Each section of the lesson has its own column, and the
 * next section starts to the right. Inside a column there are two lanes:
 * text runs down the left lane, and pictures, diagrams, models and slide
 * pages go in a lane to its right, level with the text they illustrate, so a
 * section reads across like a page of notes instead of one tall strip.
 * A column with no figures stays one lane wide.
 *
 * Heights are measured by the client and passed in; a block with no
 * measurement yet gets a provisional height so later blocks do not jump
 * when it appears.
 */
export interface LayoutOptions {
  columnWidth: number;
  columnGap: number;
  rowGap: number;
  provisionalHeight: number;
  /** Width of the figure lane, and the gap between it and the text lane. */
  figureWidth?: number;
  laneGap?: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  columnWidth: 560,
  columnGap: 96,
  rowGap: 40,
  provisionalHeight: 60,
  figureWidth: 640,
  laneGap: 48,
};

export interface Placement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  placements: Map<string, Placement>;
  /** Each column's left edge and full width (both lanes when it has figures). */
  columns: Map<number, { x: number; width: number }>;
  width: number;
  height: number;
}

/** Blocks that illustrate the text: they sit beside it. */
export function isFigure(block: ContentBlock): boolean {
  return block.type === "image" || block.type === "svg" || block.type === "embed" || block.type === "page";
}

interface Lane {
  text: number;
  figure: number;
  /** Top of the text block just placed, while the next figure can still sit beside it. */
  lastTextTop: number | null;
}

export function layoutColumns(
  blocks: ContentBlock[],
  heights: ReadonlyMap<string, number>,
  opts: LayoutOptions = DEFAULT_LAYOUT,
): LayoutResult {
  const figureWidth = opts.figureWidth ?? 0;
  const laneGap = opts.laneGap ?? 0;
  const twoLanes = figureWidth > 0;

  // Column x positions: a column with figures is wider, and pushes later columns right.
  const columns = [...new Set(blocks.map((b) => b.column))].sort((a, b) => a - b);
  const withFigures = new Set(twoLanes ? blocks.filter(isFigure).map((b) => b.column) : []);
  const colX = new Map<number, number>();
  const columnInfo = new Map<number, { x: number; width: number }>();
  let x = 0;
  for (const c of columns) {
    const w = opts.columnWidth + (withFigures.has(c) ? laneGap + figureWidth : 0);
    colX.set(c, x);
    columnInfo.set(c, { x, width: w });
    x += w + opts.columnGap;
  }

  const lanes = new Map<number, Lane>();
  const placements = new Map<string, Placement>();
  let width = 0;
  let height = 0;
  for (const block of blocks) {
    const lane = lanes.get(block.column) ?? { text: 0, figure: 0, lastTextTop: null };
    lanes.set(block.column, lane);
    const h = heights.get(block.id) ?? opts.provisionalHeight;
    const cx = colX.get(block.column) ?? 0;
    let p: Placement;
    if (twoLanes && isFigure(block)) {
      // Level with the text it follows, or with the text about to come; never over an earlier figure.
      const anchor = lane.lastTextTop ?? lane.text;
      const y = Math.max(lane.figure, anchor);
      p = { id: block.id, x: cx + opts.columnWidth + laneGap, y, width: figureWidth, height: h };
      lane.figure = y + h + opts.rowGap;
      lane.lastTextTop = null;
    } else {
      const y = lane.text;
      p = { id: block.id, x: cx, y, width: opts.columnWidth, height: h };
      lane.text = y + h + opts.rowGap;
      lane.lastTextTop = y;
    }
    placements.set(block.id, p);
    width = Math.max(width, p.x + p.width);
    height = Math.max(height, p.y + p.height);
  }
  return { placements, columns: columnInfo, width, height };
}

/**
 * The area to show when the tutor works on a block: the full width of its
 * column (text and the figures beside it), from the top to the bottom of the
 * block and anything sitting level with it in the other lane.
 */
export function focusArea(blocks: ContentBlock[], layout: LayoutResult, id: string): { x: number; y: number; w: number; h: number } | null {
  const p = layout.placements.get(id);
  const block = blocks.find((b) => b.id === id);
  if (!p || !block) return null;
  const col = layout.columns.get(block.column);
  let top = p.y;
  let bottom = p.y + p.height;
  for (const b of blocks) {
    if (b.column !== block.column || b.id === id) continue;
    const q = layout.placements.get(b.id);
    if (!q || q.x === p.x) continue; // same lane: not beside it
    if (q.y < p.y + p.height && q.y + q.height > p.y) {
      top = Math.min(top, q.y);
      bottom = Math.max(bottom, q.y + q.height);
    }
  }
  return col ? { x: col.x, y: top, w: col.width, h: bottom - top } : { x: p.x, y: top, w: p.width, h: bottom - top };
}
