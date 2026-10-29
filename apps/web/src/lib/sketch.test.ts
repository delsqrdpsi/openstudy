// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { motionSvg, sketchSvg } from "./sketch";

describe("svg sanitizing", () => {
  it("drops event handlers from sketched text", () => {
    const out = sketchSvg('<svg viewBox="0 0 10 10"><text x="1" y="2" onclick="alert(1)" onmouseover="x()">hi</text></svg>');
    expect(out).toContain("hi");
    expect(out).not.toMatch(/onclick|onmouseover/i);
  });

  it("keeps the sketched geometry and the pencil filter", () => {
    const out = sketchSvg('<svg viewBox="0 0 100 100"><rect x="10" y="10" width="50" height="30"/><line x1="0" y1="0" x2="90" y2="90"/></svg>');
    expect(out).toContain("<path");
    expect(out).toContain("feTurbulence");
    expect(out).toMatch(/filter="url\(#/);
  });

  it("drops event handlers and handler-retargeting animations from motion svg", () => {
    const out = motionSvg(
      '<svg viewBox="0 0 10 10"><circle r="2" onclick="alert(1)"><animate attributeName="r" values="1;2" dur="1s"/></circle>' +
        '<rect width="2" height="2"><set attributeName="onclick" to="alert(1)"/></rect><use href="#c"/><use href="https://evil/x.svg#a"/></svg>',
    );
    expect(out).not.toMatch(/onclick="/i);
    expect(out).not.toContain("attributeName=\"onclick\"");
    expect(out).toContain('attributeName="r"');
    expect(out).toContain('href="#c"');
    expect(out).not.toContain("evil");
  });
});

/**
 * Every element and attribute in the output, parsed the way the board inserts
 * it (as HTML, via innerHTML), to look for anything that can run.
 */
function parse(svg: string) {
  const host = document.createElement("div");
  host.innerHTML = svg;
  const all = Array.from(host.querySelectorAll("*"));
  if (!all.length) throw new Error("nothing parsed");
  return {
    tags: all.map((e) => e.nodeName.toLowerCase()),
    attrs: all.flatMap((e) => Array.from(e.attributes).map((a) => ({ el: e.nodeName.toLowerCase(), name: a.name.toLowerCase(), value: a.value }))),
  };
}

const HOSTILE = `<svg viewBox="0 0 300 200" onload="alert(1)">
  <rect width="300" height="200" onmouseover="alert(2)" onClick="alert(3)"/>
  <text x="10" y="20" onclick="alert(4)" style="fill: url(https://evil.example/x)">label</text>
  <a href="javascript:alert(5)"><circle r="5"/></a>
  <use href="https://evil.example/sprite.svg#x"/>
  <use href="#ok"/>
  <set attributeName="onmouseover" to="alert(6)"/>
  <animate attributeName="href" values="javascript:alert(7)"/>
  <foreignObject><img src="x" onerror="alert(8)"/></foreignObject>
  <script>alert(9)</script>
</svg>`;

describe.each([
  ["motionSvg", motionSvg],
  ["sketchSvg", (s: string) => sketchSvg(s, { noise: false })],
])("%s with hostile input", (_, clean) => {
  const out = parse(clean(HOSTILE));

  it("keeps no event handler on any element", () => {
    expect(out.attrs.filter((a) => a.name.startsWith("on"))).toEqual([]);
  });
  it("keeps no script, foreign content or outside link", () => {
    expect(out.tags).not.toContain("script");
    expect(out.tags).not.toContain("foreignobject");
    expect(out.tags).not.toContain("a");
    for (const a of out.attrs.filter((a) => a.name.endsWith("href"))) expect(a.value.startsWith("#")).toBe(true);
    expect(out.attrs.some((a) => /javascript:|evil\.example/.test(a.value))).toBe(false);
  });
});

describe("motionSvg", () => {
  it("keeps the animation and internal references a moving diagram needs", () => {
    const out = motionSvg(
      `<svg viewBox="0 0 300 200"><defs><circle id="dot" r="4"/></defs><use href="#dot"><animateTransform attributeName="transform" type="translate" values="0 0;100 0" dur="2s" repeatCount="indefinite"/></use></svg>`,
    );
    expect(out).toContain('href="#dot"');
    expect(out).toContain("animateTransform");
  });
});
