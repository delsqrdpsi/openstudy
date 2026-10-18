import { describe, expect, it } from "vitest";
import { renderMath } from "./html";

describe("renderMath", () => {
  it("renders real inline and display math", () => {
    expect(renderMath("Energy $E = mc^2$ here")).toContain("katex");
    expect(renderMath("$$\\int_0^1 x\\,dx$$")).toContain("katex-display");
  });
  it("leaves money alone instead of rendering the words between prices as math", () => {
    const html = "<ul><li>Owes <b>$120</b> next year</li><li>Cash: only <b>$100</b></li></ul>";
    expect(renderMath(html)).toBe(html);
    expect(renderMath("pay $5 or $10 today")).toBe("pay $5 or $10 today");
  });
  it("still renders math that follows a rejected price span", () => {
    const out = renderMath("The bank eats $10k in legal fees.<br>$\\Rightarrow$ You pay");
    expect(out).toContain("$10k in legal fees.");
    expect(out).toContain("katex");
    expect(out).not.toContain("$\\Rightarrow$");
  });
  it("treats an escaped dollar as a plain dollar", () => {
    expect(renderMath("costs \\$60 today")).toBe("costs $60 today");
  });
});
