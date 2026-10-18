import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { TextBox } from "@openstudy/shared";
import { log } from "../log";

/**
 * Word boxes for a page that has no text layer (a screenshot, a photo, a
 * scanned PDF), from Tesseract running locally. The English model ships in
 * node_modules, so nothing is downloaded. Lines are returned as boxes, which
 * is what the highlighter needs; words would be too fragmented to match.
 */
const require = createRequire(import.meta.url);

type Worker = {
  recognize: (image: string | Buffer, opts?: Record<string, unknown>, output?: Record<string, boolean>) => Promise<{ data: { text: string; blocks?: Block[] | null } }>;
  terminate: () => Promise<unknown>;
};
interface Block {
  paragraphs: { lines: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[];
}

let worker: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = (async () => {
      const { createWorker } = (await import("tesseract.js")) as unknown as { createWorker: (lang: string, oem?: number, opts?: Record<string, unknown>) => Promise<Worker> };
      const data = require("@tesseract.js-data/eng") as { langPath: string; gzip: boolean };
      const cachePath = join(process.env.DATA_DIR ?? resolve(process.cwd(), "../../data"), "ocr-cache");
      const w = await createWorker("eng", 1, { langPath: data.langPath, gzip: data.gzip, cachePath, logger: () => {} });
      return w;
    })();
  }
  return worker;
}

/** OCR an image file; boxes are fractions of the image. */
export async function ocrPage(file: string, width: number, height: number): Promise<{ boxes: TextBox[]; text: string }> {
  const t0 = Date.now();
  const w = await getWorker();
  // v6+ returns only text unless blocks are asked for.
  const { data } = await w.recognize(file, {}, { text: true, blocks: true });
  const boxes: TextBox[] = [];
  const lines: string[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        const text = l.text.replace(/\s+/g, " ").trim();
        if (!text || l.confidence < 40) continue;
        boxes.push({ text, x: l.bbox.x0 / width, y: l.bbox.y0 / height, w: (l.bbox.x1 - l.bbox.x0) / width, h: (l.bbox.y1 - l.bbox.y0) / height });
        lines.push(text);
      }
      lines.push("");
    }
  }
  log.info(`ocr: ${boxes.length} lines, ${data.text.length} chars in ${((Date.now() - t0) / 1000).toFixed(1)}s for ${file}`);
  return { boxes, text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

export async function stopOcr() {
  if (worker) await (await worker).terminate();
  worker = null;
}
