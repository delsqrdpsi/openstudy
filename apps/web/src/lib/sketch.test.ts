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
