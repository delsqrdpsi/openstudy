import { describe, expect, it } from "vitest";
import { frameBlock, FOLLOW_MIN, PAD_BOTTOM, PAD_TOP, READ_SCALE } from "./camera";

const view = { width: 1300, height: 900 };
const onScreen = (cam: { x: number; y: number; scale: number }, b: { x: number; y: number; w: number; h: number }) => {
  const sx = b.x * cam.scale + cam.x;
  const sy = b.y * cam.scale + cam.y;
  return { left: sx, top: sy, right: sx + b.w * cam.scale, bottom: sy + b.h * cam.scale };
};

describe("frameBlock", () => {
  it("zooms back in to reading size after an overview", () => {
    const cam = frameBlock(view, { x: 40, y: 40, scale: 0.55 }, { x: 1312, y: 300, w: 560, h: 200 });
    expect(cam?.scale).toBe(READ_SCALE);
    const r = onScreen(cam!, { x: 1312, y: 300, w: 560, h: 200 });
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(view.width);
    expect(r.top).toBeGreaterThanOrEqual(PAD_TOP);
    expect(r.bottom).toBeLessThanOrEqual(view.height - PAD_BOTTOM);
  });

  it("leaves the camera alone when the block is already in view at a comfortable zoom", () => {
    const cam = { x: 100, y: 100, scale: 1.1 };
    expect(frameBlock(view, cam, { x: 0, y: 20, w: 560, h: 150 })).toBeNull();
  });

  it("pans to a block in the next column without changing a comfortable zoom", () => {
    const cam = frameBlock(view, { x: 80, y: 80, scale: 1 }, { x: 1312, y: 0, w: 560, h: 120 });
    expect(cam?.scale).toBe(1);
    const r = onScreen(cam!, { x: 1312, y: 0, w: 560, h: 120 });
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(view.width);
  });

  it("keeps the newest line of a tall block in view while it is written, and shows the top otherwise", () => {
    const block = { x: 0, y: 0, w: 560, h: 1400 };
    const writing = onScreen(frameBlock(view, { x: 80, y: 80, scale: 1 }, block, { growing: true })!, block);
    expect(Math.round(writing.bottom)).toBe(view.height - PAD_BOTTOM);
    const done = onScreen(frameBlock(view, { x: 80, y: 80, scale: 1 }, block)!, block);
    expect(Math.round(done.top)).toBe(PAD_TOP);
  });

  it("zooms out only as far as a wide block needs, never past the follow limit", () => {
    const narrow = { width: 700, height: 900 };
    const cam = frameBlock(narrow, { x: 0, y: 0, scale: 1 }, { x: 0, y: 0, w: 900, h: 200 });
    expect(cam!.scale).toBeLessThan(1);
    expect(cam!.scale).toBeGreaterThanOrEqual(FOLLOW_MIN);
  });
});
