import { htmlToText, nextLink, normalizeDomain } from "./client";

describe("canvas", () => {
  it("takes a school address from whatever was typed", () => {
    expect(normalizeDomain("canvas.stanford.edu")).toBe("canvas.stanford.edu");
    expect(normalizeDomain("https://Canvas.Stanford.edu/courses/123?x=1")).toBe("canvas.stanford.edu");
    expect(normalizeDomain("  bcourses.berkeley.edu:443 ")).toBe("bcourses.berkeley.edu");
    expect(normalizeDomain("stanford")).toBeNull();
    expect(normalizeDomain("not a host")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });

  it("follows Canvas pagination links", () => {
    const h = '<https://x.edu/api/v1/courses?page=1&per_page=10>; rel="current",<https://x.edu/api/v1/courses?page=2&per_page=10>; rel="next",<https://x.edu/api/v1/courses?page=1>; rel="first"';
    expect(nextLink(h)).toBe("https://x.edu/api/v1/courses?page=2&per_page=10");
    expect(nextLink('<https://x.edu/a?page=1>; rel="first"')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });

  it("turns page html into readable text", () => {
    const html = '<h2>Week 3</h2><p>Read &amp; think.<br>Then:</p><ul><li>one</li><li>two &lt; three</li></ul><script>x()</script>';
    expect(htmlToText(html)).toBe("Week 3\nRead & think.\nThen:\n\n- one\n- two < three");
  });
});
