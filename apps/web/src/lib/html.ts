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

function renderMath(html: string): string {
  // Display math first, then inline. Unmatched delimiters are left alone.
  return html
    .replace(/\$\$([^$]+?)\$\$/g, (_, tex) => tryKatex(tex, true))
    .replace(/\$([^$\n]+?)\$/g, (_, tex) => tryKatex(tex, false));
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
