import { describe, it, expect } from "vitest";
import { findMatch, foldText } from "./annotations";

describe("annotation matching", () => {
  it("finds exact text", () => {
    expect(findMatch("Red has the longest wavelength", "longest")).toEqual([12, 19]);
  });
  it("tolerates quotes, dashes, case and spacing", () => {
    const text = 'AlphaZero never saw human games — just a win/lose signal, a binary “did it succeed?” reward.';
    const r = findMatch(text, 'a binary "did it succeed?" reward');
    expect(r).not.toBeNull();
    expect(text.slice(r![0], r![1])).toBe('a binary “did it succeed?” reward');
    const r2 = findMatch(text, "Win/Lose  Signal");
    expect(text.slice(r2![0], r2![1])).toBe("win/lose signal");
    const r3 = findMatch("Tiny parts, tight clearances - a tilted nut jams", "tight clearances — a tilted nut");
    expect(r3).not.toBeNull();
  });
  it("returns null when the phrase is not there", () => {
    expect(findMatch("The policy keeps correcting", "reward signal")).toBeNull();
  });
  it("folds text with a map back to the original", () => {
    const { folded, map } = foldText("  Hello  “World” ");
    expect(folded).toBe('hello "world"');
    expect(map[0]).toBe(2);
  });
});
