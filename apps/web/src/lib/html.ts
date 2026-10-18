import DOMPurify from "dompurify";
import katex from "katex";

const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "p", "b", "strong", "i", "em", "u", "s", "br", "span", "div",
  "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "sub", "sup", "code", "pre", "mark", "small",
];

/**
 * Render tutor html for the board: sanitise, then replace $...$ and $$...$$
 * with KaTeX. Math is rendered after sanitising so KaTeX's own markup is kept.
 */
export function renderBoardHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["class", "colspan", "rowspan"],
    KEEP_CONTENT: true,
  });
  return renderMath(clean);
}

/**
 * A math span must look like math. The tutor writes money too ("$120 today
 * ... $100 next year"), and a naive $...$ match would swallow the words
 * and tags in between and render them as formulas.
 */
function looksLikeMath(tex: string): boolean {
  if (tex.length > 160) return false;
  if (/[<>]/.test(tex)) return false; // spans a tag
  if (/^\s*\d[\d,.]*[kKmM]?\s+[A-Za-z]/.test(tex)) return false; // "120 next year": a price, then words
  if (/^\s*\d[\d,.]*[kKmM]?\s*$/.test(tex)) return false; // "$100$" is a price written twice, not a formula
  return true;
}

export function renderMath(html: string): string {
  // Display math first, then inline. A $ that does not open real math (a price,
  // or a span that crosses a tag) stays a plain $, and the scan moves on one
  // character, so a closing $ can still open the next span: "$10k ... $\\Rightarrow$".
  const ESC = "\u0000";
  const withDisplay = html.replace(/\\\$/g, ESC).replace(/\$\$([^$]+?)\$\$/g, (_, tex) => tryKatex(tex, true));
  let out = "";
  let i = 0;
  while (i < withDisplay.length) {
    const open = withDisplay.indexOf("$", i);
    if (open === -1) {
      out += withDisplay.slice(i);
      break;
    }
    const close = withDisplay.indexOf("$", open + 1);
    const tex = close === -1 ? "" : withDisplay.slice(open + 1, close);
    if (close !== -1 && !tex.includes("\n") && looksLikeMath(tex)) {
      out += withDisplay.slice(i, open) + tryKatex(tex, false);
      i = close + 1;
    } else {
      out += withDisplay.slice(i, open + 1);
      i = open + 1;
    }
  }
  return out.replace(new RegExp(ESC, "g"), "$");
}

function tryKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(decodeEntities(tex), { displayMode, throwOnError: false, output: "html" });
  } catch {
    return tex;
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}
