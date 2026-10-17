import type { ImageBackend, ImageRequest, ImageResult } from "./types";

/**
 * No image model configured: draw a sketch-style card with the prompt on it,
 * so the lesson keeps its rhythm and you can see where pictures would go.
 */
export class PlaceholderImages implements ImageBackend {
  readonly name = "placeholder";
  async generate({ prompt }: ImageRequest): Promise<ImageResult> {
    await new Promise((r) => setTimeout(r, 1200));
    const lines = wrap(prompt, 44).slice(0, 6);
    const text = lines
      .map((l, i) => `<text x="264" y="${118 + i * 26}" text-anchor="middle" font-size="19" fill="#444">${escapeXml(l)}</text>`)
      .join("");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 528 288" width="528" height="288">` +
      `<rect x="6" y="6" width="516" height="276" rx="14" fill="#fff" stroke="#bbb" stroke-width="2" stroke-dasharray="7 6"/>` +
      `<text x="264" y="70" text-anchor="middle" font-size="20" fill="#888" font-family="ui-sans-serif, Helvetica, Arial, sans-serif" font-style="italic">sketch to come</text>` +
      `<g font-family="ui-sans-serif, Helvetica, Arial, sans-serif">${text}</g></svg>`;
    return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
  }
}

function wrap(s: string, width: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      out.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
