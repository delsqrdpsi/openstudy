/**
 * Plain text out of board markup. Speech goes to the transcript and the voice,
 * so markup the model carries over from the board must not survive; board html
 * gets flattened when the model reads the board back as a summary.
 */

/** Tags that only style a run of text: dropping them leaves the words joined as written. */
const INLINE_TAGS = "b|i|em|strong|u|span";
/** Tags that separate text: each becomes a space so the words on either side stay apart. */
const BREAK_TAGS = "br|p|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td";

const INLINE_RE = new RegExp(`<\\/?(?:${INLINE_TAGS})(?:\\s[^<>]*)?\\/?>`, "gi");
const BREAK_RE = new RegExp(`<\\/?(?:${BREAK_TAGS})(?:\\s[^<>]*)?\\/?>`, "gi");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** &amp; &lt; &#39; &#x2014; and friends back to characters. Unknown names stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * A spoken line as plain words. Only the tags the board uses are removed, so
 * `x<y`, `List<String>` and `a < b` are kept. Markdown bold and code marks and
 * $math$ delimiters go too; the math inside stays, and so do amounts like $5.
 */
export function plainSpeech(text: string): string {
  return decodeEntities(text.replace(BREAK_RE, " ").replace(INLINE_RE, ""))
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\$\$(.+?)\$\$/g, "$1")
    .replace(/(^|[^\\$])\$([^$\s](?:[^$]*[^$\s])?)\$(?!\d)/g, "$1$2")
    .replace(/\\\$/g, "$")
    .replace(/\s+/g, " ")
    .trim();
}

/** Board html as one line of text: every tag becomes a space, entities become characters. */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
