import { chunkHtml } from "./stream";

describe("chunkHtml", () => {
  it("never splits inside a tag and rejoins to the original", () => {
    const html = '<b>Reward:</b> a number the <i>environment</i> hands back, <span class="x">good or bad</span>.';
    const chunks = chunkHtml(html, 5);
    expect(chunks.join("")).toBe(html);
    for (const c of chunks) {
      const opens = (c.match(/</g) ?? []).length;
      const closes = (c.match(/>/g) ?? []).length;
      expect(opens).toBe(closes);
    }
    expect(chunks.length).toBeGreaterThan(5);
  });
});
