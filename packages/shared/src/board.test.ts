import { applyEvents, emptyBoard } from "./board";
import { focusArea, layoutColumns } from "./layout";
import { LessonFixtureSchema } from "./events";
import { rl101 } from "./fixtures/rl101";
import { isContentBlock } from "./blocks";

describe("board reducer", () => {
  it("adds and streams html blocks", () => {
    const s = applyEvents(emptyBoard(), [
      { type: "block.add", block: { id: "a", type: "html", column: 0, html: "" } },
      { type: "block.append", id: "a", html: "Hello " },
      { type: "block.append", id: "a", html: "world" },
    ]);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toMatchObject({ html: "Hello world" });
    expect(s.focusId).toBe("a");
  });

  it("updates image status and removes annotations with their target", () => {
    const s = applyEvents(emptyBoard(), [
      { type: "block.add", block: { id: "img", type: "image", column: 1, prompt: "p", status: "pending" } },
      { type: "block.add", block: { id: "ann", type: "annotation", target: "img", kind: "circle", match: "x" } },
      { type: "image.update", id: "img", status: "ready", url: "/x.png" },
    ]);
    expect(s.blocks[0]).toMatchObject({ status: "ready", url: "/x.png" });
    const t = applyEvents(s, [{ type: "block.remove", id: "img" }]);
    expect(t.blocks).toHaveLength(0);
  });
});

describe("layout", () => {
  it("stacks blocks per column and uses measured heights", () => {
    const r = layoutColumns(
      [
        { id: "a", type: "html", column: 0, html: "" },
        { id: "b", type: "html", column: 0, html: "" },
        { id: "c", type: "html", column: 1, html: "" },
      ],
      new Map([["a", 100]]),
      { columnWidth: 500, columnGap: 50, rowGap: 20, provisionalHeight: 40 },
    );
    expect(r.placements.get("a")).toMatchObject({ x: 0, y: 0, height: 100 });
    expect(r.placements.get("b")).toMatchObject({ x: 0, y: 120, height: 40 });
    expect(r.placements.get("c")).toMatchObject({ x: 550, y: 0 });
    expect(r.width).toBe(1050);
    expect(r.height).toBe(160);
  });

  const opts = { columnWidth: 500, columnGap: 50, rowGap: 20, provisionalHeight: 40, figureWidth: 600, laneGap: 40 };

  it("puts figures in a lane beside the text they follow", () => {
    const r = layoutColumns(
      [
        { id: "t1", type: "html", column: 1, html: "" },
        { id: "pic", type: "image", column: 1, prompt: "p", status: "ready" },
        { id: "t2", type: "html", column: 1, html: "" },
        { id: "t3", type: "html", column: 1, html: "" },
        { id: "fig", type: "svg", column: 1, svg: "<svg/>", width: 300, height: 200 },
      ] as never,
      new Map([["t1", 100], ["pic", 300], ["t2", 80], ["t3", 60], ["fig", 200]]),
      opts,
    );
    expect(r.placements.get("t1")).toMatchObject({ x: 0, y: 0 });
    expect(r.placements.get("pic")).toMatchObject({ x: 540, y: 0 }); // beside t1
    expect(r.placements.get("t2")).toMatchObject({ x: 0, y: 120 }); // text keeps flowing down the left
    expect(r.placements.get("fig")).toMatchObject({ x: 540, y: 320 }); // beside t3 would overlap pic, so just below it
    expect(r.placements.get("t3")).toMatchObject({ x: 0, y: 220 });
  });

  it("lines a picture placed before its text up with that text", () => {
    const r = layoutColumns(
      [
        { id: "head", type: "html", column: 2, html: "" },
        { id: "pic", type: "image", column: 2, prompt: "p", status: "pending" },
        { id: "body", type: "html", column: 2, html: "" },
      ] as never,
      new Map([["head", 50]]),
      opts,
    );
    expect(r.placements.get("pic")!.y).toBe(r.placements.get("head")!.y);
    expect(r.placements.get("body")).toMatchObject({ x: 0, y: 70 });
  });

  it("frames a block with whatever sits beside it, across the column's full width", () => {
    const blocks = [
      { id: "t1", type: "html", column: 1, html: "" },
      { id: "pic", type: "image", column: 1, prompt: "p", status: "ready" },
      { id: "t2", type: "html", column: 1, html: "" },
      { id: "t3", type: "html", column: 1, html: "" },
    ] as never;
    const r = layoutColumns(blocks, new Map([["t1", 100], ["pic", 300], ["t2", 80], ["t3", 400]]), opts);
    // pic spans 0-300; t1 0-100, t2 120-200 and t3 220-620 all start beside it
    expect(focusArea(blocks, r, "pic")).toEqual({ x: 0, y: 0, w: 1140, h: 620 });
    expect(focusArea(blocks, r, "t2")).toEqual({ x: 0, y: 0, w: 1140, h: 300 }); // t2 brings the picture beside it
    expect(focusArea(blocks, r, "t1")).toEqual({ x: 0, y: 0, w: 1140, h: 300 });
  });

  it("keeps text-only columns narrow and pushes columns after a figure column right", () => {
    const r = layoutColumns(
      [
        { id: "a", type: "html", column: 0, html: "" },
        { id: "b", type: "html", column: 1, html: "" },
        { id: "pic", type: "image", column: 1, prompt: "p", status: "ready" },
        { id: "c", type: "html", column: 2, html: "" },
      ] as never,
      new Map(),
      opts,
    );
    expect(r.placements.get("b")!.x).toBe(550); // column 0 has no figures: one lane
    expect(r.placements.get("pic")!.x).toBe(550 + 540);
    expect(r.placements.get("c")!.x).toBe(550 + 500 + 40 + 600 + 50); // after column 1's two lanes
  });
});

describe("fixture", () => {
  it("validates and plays through without unknown ids", () => {
    const parsed = LessonFixtureSchema.parse(rl101);
    const s = applyEvents(emptyBoard(), parsed.events.map((e) => e.event));
    const ids = new Set(s.blocks.filter(isContentBlock).map((b) => b.id));
    for (const b of s.blocks) {
      if (b.type === "annotation") expect(ids.has(b.target)).toBe(true);
    }
    expect(s.blocks.length).toBeGreaterThan(8);
  });
});
