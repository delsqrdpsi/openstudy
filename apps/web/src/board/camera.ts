/**
 * Where the camera should go to show the block the tutor is working on.
 * Pure, so it can be tested without a DOM.
 *
 * The rules, in order:
 * - Read at a natural size. Keep the current zoom when it is already
 *   comfortable; otherwise go to reading size, zooming back in after an
 *   overview. Zoom out only as far as needed to fit a wide block across.
 * - Leave room for what sits over the board: the toolbar at the top, the
 *   caption and input bar at the bottom.
 * - Don't move when the block is already in view at a comfortable zoom.
 * - A block that is still being written keeps its newest line in view; any
 *   other block taller than the view shows its top.
 */
export interface Cam {
  x: number;
  y: number;
  scale: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface View {
  width: number;
  height: number;
}
export interface FrameOptions {
  /** The block is being written right now. */
  growing?: boolean;
}

/** Text is drawn for this zoom. */
export const READ_SCALE = 1;
/** Zooms within this band count as comfortable and are left alone. */
export const COMFORT_MIN = 0.85;
export const COMFORT_MAX = 1.5;
/** The follow camera never goes further out than this on its own. */
export const FOLLOW_MIN = 0.5;
export const PAD_X = 64;
/** The toolbar covers the top of the board. */
export const PAD_TOP = 84;
/** Captions, the input bar and the keypoints cover the bottom. */
export const PAD_BOTTOM = 190;

export function frameBlock(view: View, cam: Cam, block: Rect, opts: FrameOptions = {}): Cam | null {
  const usableW = Math.max(1, view.width - PAD_X * 2);
  const usableH = Math.max(1, view.height - PAD_TOP - PAD_BOTTOM);
  const fitW = usableW / Math.max(1, block.w);

  const comfortable = cam.scale >= COMFORT_MIN && cam.scale <= COMFORT_MAX;
  let scale = comfortable ? cam.scale : READ_SCALE;
  scale = Math.max(FOLLOW_MIN, Math.min(scale, fitW));
  const rescale = Math.abs(scale - cam.scale) > 0.01;

  const at = rescale ? { ...cam, scale } : cam;
  const sx = block.x * scale + at.x;
  const sy = block.y * scale + at.y;
  const sw = block.w * scale;
  const sh = block.h * scale;

  // Horizontal: keep x when the block is already inside the view; else centre it.
  let x = at.x;
  const insideX = sx >= PAD_X - 1 && sx + sw <= view.width - PAD_X + 1;
  if (rescale || !insideX) x = (view.width - sw) / 2 - block.x * scale;

  // Vertical: keep y when the block is inside the usable band; else move just enough.
  let y = at.y;
  const top = PAD_TOP;
  const bottom = view.height - PAD_BOTTOM;
  if (sh > usableH) {
    // Taller than the view: the newest line while writing, otherwise the top.
    y = opts.growing ? bottom - sh - block.y * scale : top - block.y * scale;
  } else if (rescale || sy < top - 1 || sy + sh > bottom + 1) {
    if (sy < top - 1 || rescale) y = top + Math.min(usableH - sh, usableH * 0.18) - block.y * scale;
    if (block.y * scale + y + sh > bottom) y = bottom - sh - block.y * scale;
  }

  if (!rescale && Math.abs(x - cam.x) < 2 && Math.abs(y - cam.y) < 2) return null;
  return { x, y, scale };
}
