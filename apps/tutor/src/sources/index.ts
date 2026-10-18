import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import JSZip from "jszip";
import type { SourceSummary, TextBox } from "@openstudy/shared";
import { log } from "../log";

/**
 * The student's own material: a folder of slides, PDFs, photos and notes.
 * Each file is prepared once: pages rendered to PNG, text pulled out with
 * positions, so the tutor can put a page on the board and highlight words
 * on it exactly. Everything lives under DATA_DIR/sources/<id>/.
 */
export interface SourcePage {
  n: number;
  file: string;
  aspect: number;
  boxes: TextBox[];
  text: string;
}
export interface SourceMeta extends SourceSummary {
  path: string;
  pages_: SourcePage[];
  text: string;
}

const ROOT = join(process.env.DATA_DIR ?? resolve(process.cwd(), "../../data"), "sources");
const MAX_PAGES = Number(process.env.SOURCE_MAX_PAGES ?? 80);
const RENDER_WIDTH = 1400;
const EXTS: Record<string, SourceSummary["kind"]> = {
  ".pdf": "pdf",
  ".pptx": "slides",
  ".ppt": "slides",
  ".odp": "slides",
  ".key": "slides",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".md": "text",
  ".txt": "text",
  ".markdown": "text",
};

export function scanFolder(dir: string): { path: string; name: string; kind: SourceSummary["kind"]; size: number }[] {
  const out: { path: string; name: string; kind: SourceSummary["kind"]; size: number }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 2) return;
    for (const f of readdirSync(d)) {
      if (f.startsWith(".")) continue;
      const p = join(d, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, depth + 1);
      else {
        const kind = EXTS[extname(f).toLowerCase()];
        if (kind) out.push({ path: p, name: f, kind, size: st.size });
      }
    }
  };
  walk(resolve(dir), 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const idFor = (path: string) => createHash("sha1").update(`${path}:${statSync(path).mtimeMs}:${statSync(path).size}`).digest("hex").slice(0, 12);

export function listSources(): SourceSummary[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT)
    .map((id) => getSource(id))
    .filter((m): m is SourceMeta => !!m)
    .map(summary);
}

export function getSource(id: string): SourceMeta | null {
  if (!/^[a-f0-9]{12}$/.test(id)) return null;
  const p = join(ROOT, id, "meta.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SourceMeta;
  } catch {
    return null;
  }
}

export function readSourceFile(id: string, file: string): { bytes: Buffer; type: string } | null {
  if (!/^[a-f0-9]{12}$/.test(id) || !/^[\w.-]+$/.test(file)) return null;
  const p = join(ROOT, id, file);
  if (!existsSync(p)) return null;
  return { bytes: readFileSync(p), type: file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : "application/octet-stream" };
}

const summary = (m: SourceMeta): SourceSummary => ({ id: m.id, name: m.name, kind: m.kind, pages: m.pages, chars: m.chars, note: m.note });

/** Prepare one file (idempotent: a file that has not changed is reused). */
export async function prepareSource(path: string): Promise<SourceSummary> {
  const id = idFor(path);
  const existing = getSource(id);
  if (existing) return summary(existing);
  const dir = join(ROOT, id);
  mkdirSync(dir, { recursive: true });
  const kind = EXTS[extname(path).toLowerCase()];
  const name = basename(path);
  let meta: SourceMeta;
  const t0 = Date.now();
  if (kind === "pdf") meta = await preparePdf(id, name, path, dir, "pdf");
  else if (kind === "slides") meta = await prepareSlides(id, name, path, dir);
  else if (kind === "image") meta = await prepareImage(id, name, path, dir);
  else {
    const text = readFileSync(path, "utf8").slice(0, 200_000);
    meta = { id, name, kind: "text", pages: 0, chars: text.length, path, pages_: [], text };
  }
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
  log.info(`source ready: ${name} (${meta.kind}, ${meta.pages} pages, ${meta.chars} chars) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return summary(meta);
}

async function preparePdf(id: string, name: string, path: string, dir: string, kind: SourceSummary["kind"], note?: string): Promise<SourceMeta> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  const pages: SourcePage[] = [];
  const total = Math.min(doc.numPages, MAX_PAGES);
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = RENDER_WIDTH / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdf.js accepts any canvas with a 2d context; the napi canvas quacks like one.
    const params = { canvasContext: ctx, canvas, viewport } as unknown as Parameters<typeof page.render>[0];
    await page.render(params).promise;
    const file = `page-${n}.png`;
    writeFileSync(join(dir, file), canvas.toBuffer("image/png"));

    const content = await page.getTextContent();
    const boxes: TextBox[] = [];
    const lines: string[] = [];
    for (const item of content.items as { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }[]) {
      if (!item.str.trim()) continue;
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const fontH = Math.hypot(tx[2], tx[3]);
      const w = item.width * scale;
      const x = tx[4];
      const top = tx[5] - fontH * 0.85;
      boxes.push({ text: item.str, x: x / viewport.width, y: top / viewport.height, w: w / viewport.width, h: (fontH * 1.1) / viewport.height });
      lines.push(item.str + (item.hasEOL ? "\n" : " "));
    }
    pages.push({ n, file, aspect: viewport.width / viewport.height, boxes, text: lines.join("").replace(/[ \t]+\n/g, "\n").trim() });
  }
  const text = pages.map((p) => `--- page ${p.n} ---\n${p.text}`).join("\n\n");
  return { id, name, kind, pages: pages.length, chars: text.length, note: doc.numPages > MAX_PAGES ? `first ${MAX_PAGES} of ${doc.numPages} pages` : note, path, pages_: pages, text };
}

async function prepareSlides(id: string, name: string, path: string, dir: string): Promise<SourceMeta> {
  // Best path: LibreOffice turns the deck into a PDF with real slide images and a text layer.
  const soffice = ["soffice", "libreoffice"].find((b) => spawnSync("which", [b]).status === 0);
  if (soffice) {
    const tmp = mkdtempSync(join(tmpdir(), "openstudy-slides-"));
    const r = spawnSync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", tmp, path], { timeout: 180_000 });
    const pdf = join(tmp, basename(path).replace(/\.[^.]+$/, ".pdf"));
    if (r.status === 0 && existsSync(pdf)) {
      const meta = await preparePdf(id, name, pdf, dir, "slides");
      meta.path = path;
      return meta;
    }
    log.warn("slide conversion failed, falling back to text:", r.stderr?.toString().slice(0, 200));
  }
  // Fallback: text per slide from the pptx xml, drawn onto plain slides.
  const zip = await JSZip.loadAsync(readFileSync(path));
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => parseInt(a.match(/(\d+)/)![1], 10) - parseInt(b.match(/(\d+)/)![1], 10))
    .slice(0, MAX_PAGES);
  const pages: SourcePage[] = [];
  for (const [i, f] of slideFiles.entries()) {
    const xml = await zip.file(f)!.async("string");
    const paras = [...xml.matchAll(/<a:p>(.*?)<\/a:p>/gs)].map((m) => [...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")).filter(Boolean);
    const canvas = createCanvas(RENDER_WIDTH, Math.round(RENDER_WIDTH * 0.5625));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1f2a37";
    const boxes: TextBox[] = [];
    let y = 90;
    paras.forEach((t, j) => {
      const size = j === 0 ? 48 : 30;
      ctx.font = `${size}px sans-serif`;
      const w = Math.min(canvas.width - 160, ctx.measureText(t).width);
      ctx.fillText(t, 80, y, canvas.width - 160);
      boxes.push({ text: t, x: 80 / canvas.width, y: (y - size) / canvas.height, w: w / canvas.width, h: (size * 1.2) / canvas.height });
      y += size * 1.6;
    });
    const file = `page-${i + 1}.png`;
    writeFileSync(join(dir, file), canvas.toBuffer("image/png"));
    pages.push({ n: i + 1, file, aspect: 16 / 9, boxes, text: paras.join("\n") });
  }
  const text = pages.map((p) => `--- slide ${p.n} ---\n${p.text}`).join("\n\n");
  return { id, name, kind: "slides", pages: pages.length, chars: text.length, note: "text only: install LibreOffice or export the deck to PDF to see the real slides", path, pages_: pages, text };
}

async function prepareImage(id: string, name: string, path: string, dir: string): Promise<SourceMeta> {
  const img = await loadImage(path);
  const ext = extname(path).toLowerCase() === ".png" ? "png" : "jpg";
  const file = `page-1.${ext}`;
  copyFileSync(path, join(dir, file));
  return {
    id,
    name,
    kind: "image",
    pages: 1,
    chars: 0,
    note: "no text layer: the tutor can only mark regions of this picture, not words",
    path,
    pages_: [{ n: 1, file, aspect: img.width / img.height, boxes: [], text: "" }],
    text: "",
  };
}

/** Material text for the planner. */
export function sourcesAsMaterials(ids: string[]): { name: string; text: string }[] {
  return ids
    .map(getSource)
    .filter((m): m is SourceMeta => !!m && m.text.length > 0)
    .map((m) => ({ name: m.name, text: m.text.slice(0, 60_000) }));
}

/** What the live tutor sees: files, page counts, and a line per page so it can pick pages by content. */
export function sourcesForPrompt(ids: string[]): string {
  const metas = ids.map(getSource).filter((m): m is SourceMeta => !!m);
  if (!metas.length) return "";
  return metas
    .map((m) => {
      const pages = m.pages_
        .slice(0, 60)
        .map((p) => `  p${p.n}: ${p.text.replace(/\s+/g, " ").slice(0, 90) || "(no text)"}`)
        .join("\n");
      return `- "${m.name}" (${m.kind}, ${m.pages} pages)${m.note ? ` [${m.note}]` : ""}\n${pages}`;
    })
    .join("\n");
}

export function pageBlockFor(ids: string[], sourceName: string, pageNo: number, base: string) {
  const metas = ids.map(getSource).filter((m): m is SourceMeta => !!m);
  const wanted = sourceName.toLowerCase();
  const meta = metas.find((m) => m.name.toLowerCase() === wanted) ?? metas.find((m) => m.name.toLowerCase().includes(wanted)) ?? (metas.length === 1 ? metas[0] : undefined);
  if (!meta) return null;
  const page = meta.pages_.find((p) => p.n === pageNo);
  if (!page) return null;
  return { src: `${base}/sources/${meta.id}/${page.file}`, source: meta.name, page: page.n, aspect: page.aspect, boxes: page.boxes };
}
