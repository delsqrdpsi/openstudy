import type { ContentBlock } from "./blocks";

/**
 * Column flow layout. Blocks stack vertically inside their column in
 * insertion order. Heights are measured by the client and passed in; a block
 * with no measurement yet gets a provisional height so later blocks do not
 * jump when it appears.
 */
export interface LayoutOptions {
  columnWidth: number;
  columnGap: number;
  rowGap: number;
  provisionalHeight: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  columnWidth: 560,
  columnGap: 96,
  rowGap: 40,
  provisionalHeight: 60,
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
  width: number;
  height: number;
}

export function layoutColumns(
  blocks: ContentBlock[],
  heights: ReadonlyMap<string, number>,
  opts: LayoutOptions = DEFAULT_LAYOUT,
): LayoutResult {
  const cursors = new Map<number, number>();
  const placements = new Map<string, Placement>();
  let width = 0;
  let height = 0;
  for (const block of blocks) {
    const y = cursors.get(block.column) ?? 0;
    const x = block.column * (opts.columnWidth + opts.columnGap);
    const h = heights.get(block.id) ?? opts.provisionalHeight;
    placements.set(block.id, { id: block.id, x, y, width: opts.columnWidth, height: h });
    cursors.set(block.column, y + h + opts.rowGap);
    width = Math.max(width, x + opts.columnWidth);
    height = Math.max(height, y + h);
  }
  return { placements, width, height };
}
