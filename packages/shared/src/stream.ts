/**
 * Split an html string into chunks that never cut inside a tag, so streamed
 * appends always leave the block parseable. Used by the fixture player and by
 * the tutor server when it forwards model tokens.
 */
export function chunkHtml(html: string, targetChars = 6): string[] {
  const chunks: string[] = [];
  let buf = "";
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      const end = html.indexOf(">", i);
      const tag = end === -1 ? html.slice(i) : html.slice(i, end + 1);
      buf += tag;
      i += tag.length;
      continue;
    }
    buf += ch;
    i += 1;
    if (buf.length >= targetChars && (ch === " " || ch === "." || ch === ",")) {
      chunks.push(buf);
      buf = "";
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
