import { applyEvents, emptyBoard } from "./board";
import { layoutColumns } from "./layout";
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
