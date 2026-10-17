import { Store } from "./store";

describe("store", () => {
  it("saves boards and their logs and lists them newest first", () => {
    const s = new Store(":memory:");
    s.createBoard({ id: "a", title: "A", topic: "t", brain: "claude-code", model: "sonnet" });
    s.appendEvent("a", { type: "block.add", block: { id: "x", type: "html", column: 0, html: "" } });
    s.append("a", { kind: "user", text: "hi" });
    s.appendEvent("a", { type: "block.append", id: "x", html: "hello" });
    s.setBrainSession("a", "sess-1");
    s.createBoard({ id: "b", title: "B", topic: "t2", brain: "claude-code", model: "opus" });
    expect(s.log("a")).toHaveLength(3);
    expect(s.log("a")[1]).toEqual({ kind: "user", text: "hi" });
    expect(s.getBoard("a")?.brainSessionId).toBe("sess-1");
    const list = s.listBoards();
    expect(list.map((b) => b.id)).toEqual(["b", "a"]);
    expect(list[1].blocks).toBe(1);
    s.deleteBoard("a");
    expect(s.getBoard("a")).toBeNull();
    expect(s.log("a")).toHaveLength(0);
  });
});
