import { describe, expect, it } from "vitest";
import { BOARD_ID, MAX_USER_TEXT } from "@openstudy/shared";
import { clipText, isBoardId, newBoardId, reconnectDelay } from "./liveProtocol";

describe("reconnectDelay", () => {
  it("starts at half a second, doubles, and caps at 8s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map((n) => reconnectDelay(n))).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
  });
});

describe("newBoardId", () => {
  it("makes ids the server accepts, and different ones each time", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID);
      expect(id).toHaveLength(21);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
  });
  it("checks ids from the address bar", () => {
    expect(isBoardId(newBoardId())).toBe(true);
    expect(isBoardId("abc")).toBe(false);
    expect(isBoardId("../../etc")).toBe(false);
    expect(isBoardId(null)).toBe(false);
  });
});

describe("clipText", () => {
  it("trims and cuts to the limit", () => {
    expect(clipText("  hi  ", 10)).toBe("hi");
    const long = "x".repeat(MAX_USER_TEXT + 500);
    expect(clipText(long, MAX_USER_TEXT)).toHaveLength(MAX_USER_TEXT);
  });
  it("does not leave half an emoji at the cut", () => {
    const s = "a".repeat(9) + "😀";
    expect(clipText(s, 10)).toBe("a".repeat(9));
  });
});
