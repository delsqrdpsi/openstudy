import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, isAbsolute } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import JSZip from "jszip";
import type { SourceSummary, TextBox } from "@openstudy/shared";
import { log } from "../log";
import { ocrPage } from "./ocr";
import { dataDir } from "../paths";

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

const ROOT = join(dataDir(), "sources");
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

/**
 * Folders the tutor may read course material from: your home directory by
 * default, or the comma-separated list in SOURCES_ROOT (for example an
 * external drive). Anything else is refused, so a bad request cannot point the
 * scanner at system files.
 */
export function sourceRoots(): string[] {
  const roots = (process.env.SOURCES_ROOT ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (roots.length ? roots : [homedir()]).map((r) => {
    try {
      return realpathSync(resolve(r));
    } catch {
      return resolve(r);
    }
  });
}

export function insideRoots(path: string, roots = sourceRoots()): boolean {
  return roots.some((root) => {
    const rel = relative(root, path);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

export function scanFolder(dir: string): { path: string; name: string; kind: SourceSummary["kind"]; size: number }[] {
  const out: { path: string; name: string; kind: SourceSummary["kind"]; size: number }[] = [];
  let start: string;
  try {
    start = realpathSync(resolve(dir.replace(/^~(?=$|\/)/, homedir())));
  } catch {
    throw new Error(`no such folder: ${dir}`);
  }
  if (!insideRoots(start)) throw new Error(`that folder is outside the folders OpenStudy may read (set SOURCES_ROOT to allow it)`);
  const walk = (d: string, depth: number) => {
    if (depth > 2) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return; // unreadable folder: skip it, keep the rest
    }
    for (const f of entries) {
      if (f.startsWith(".")) continue;
      const p = join(d, f);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue; // broken link or no permission
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (st.isFile()) {
        const kind = EXTS[extname(f).toLowerCase()];
        if (!kind) continue;
        // A link may point outside the allowed folders; follow it only if its target is inside.
        let real: string;
        try {
          real = realpathSync(p);
        } catch {
          continue;
        }
        if (insideRoots(real)) out.push({ path: p, name: f, kind, size: st.size });
      }
    }
  };
  walk(start, 0);
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
  // Only rendered pages are served; the extracted text and the original path stay on the server.
  const m = /^page-\d{1,4}\.(png|jpg|jpeg|webp)$/.exec(file);
  if (!/^[a-f0-9]{12}$/.test(id) || !m) return null;
  const p = join(ROOT, id, file);
  if (!existsSync(p)) return null;
  const type = m[1] === "png" ? "image/png" : m[1] === "webp" ? "image/webp" : "image/jpeg";
  return { bytes: readFileSync(p), type };
}

const summary = (m: SourceMeta): SourceSummary => ({ id: m.id, name: m.name, kind: m.kind, pages: m.pages, chars: m.chars, note: m.note });

/** Prepare one file (idempotent: a file that has not changed is reused). */
export async function prepareSource(path: string): Promise<SourceSummary> {
  const id = idFor(path);
  const existing = getSource(id);
  // Reuse a prepared file, unless it came out empty (say, a .key deck before LibreOffice was installed): try again.
  if (existing && (existing.pages > 0 || existing.kind === "text")) return summary(existing);
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
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true });
  try {
    return await renderPdf(pdfjs, await task.promise, id, name, path, dir, kind, note);
  } finally {
    // Frees the document's memory; a long course folder would otherwise pile it up.
    await task.destroy();
  }
}

async function renderPdf(
  pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs"),
  doc: Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs").getDocument>["promise"]>,
  id: string,
  name: string,
  path: string,
  dir: string,
  kind: SourceSummary["kind"],
  note?: string,
): Promise<SourceMeta> {
  const pages: SourcePage[] = [];
  let ocrPages = 0;
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
    let pageText = lines.join("").replace(/[ \t]+\n/g, "\n").trim();
    if (!boxes.length) {
      // A scanned page: read it with OCR so words can still be marked.
      try {
        const o = await ocrPage(join(dir, file), canvas.width, canvas.height);
        boxes.push(...o.boxes);
        pageText = o.text;
        ocrPages += 1;
      } catch (e) {
        log.warn("ocr failed on page", n, e instanceof Error ? e.message : e);
      }
    }
    pages.push({ n, file, aspect: viewport.width / viewport.height, boxes, text: pageText });
  }
  if (ocrPages) note = [note, `${ocrPages} page${ocrPages > 1 ? "s" : ""} read by OCR`].filter(Boolean).join("; ");
  const text = pages.map((p) => `--- page ${p.n} ---\n${p.text}`).join("\n\n");
  return { id, name, kind, pages: pages.length, chars: text.length, note: doc.numPages > MAX_PAGES ? `first ${MAX_PAGES} of ${doc.numPages} pages` : note, path, pages_: pages, text };
}

async function prepareSlides(id: string, name: string, path: string, dir: string): Promise<SourceMeta> {
  // Best path: LibreOffice turns the deck into a PDF with real slide images and a text layer.
  const soffice = findSoffice();
  if (soffice) {
    const tmp = mkdtempSync(join(tmpdir(), "openstudy-slides-"));
    try {
      // Asynchronous: a big deck takes LibreOffice a while, and every live lesson must keep talking meanwhile.
      const r = await run(soffice, ["--headless", "--convert-to", "pdf", "--outdir", tmp, path], 180_000);
      const pdf = join(tmp, basename(path).replace(/\.[^.]+$/, ".pdf"));
      if (r.status === 0 && existsSync(pdf)) {
        const meta = await preparePdf(id, name, pdf, dir, "slides");
        meta.path = path;
        return meta;
      }
      log.warn("slide conversion failed, falling back to text:", r.stderr.slice(0, 200));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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
  const e = extname(path).toLowerCase();
  const ext = e === ".png" ? "png" : e === ".webp" ? "webp" : "jpg";
  const file = `page-1.${ext}`;
  copyFileSync(path, join(dir, file));
  let boxes: TextBox[] = [];
  let text = "";
  let note: string | undefined;
  try {
    ({ boxes, text } = await ocrPage(join(dir, file), img.width, img.height));
    if (!boxes.length) note = "no readable text found: the tutor can only mark regions of this picture";
    else note = "text read by OCR";
  } catch (e) {
    log.warn("ocr failed:", e instanceof Error ? e.message : e);
    note = "OCR failed: the tutor can only mark regions of this picture";
  }
  return { id, name, kind: "image", pages: 1, chars: text.length, note, path, pages_: [{ n: 1, file, aspect: img.width / img.height, boxes, text }], text };
}

let sofficePath: string | null | undefined;
function findSoffice(): string | null {
  if (sofficePath !== undefined) return sofficePath;
  const mac = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  sofficePath = ["soffice", "libreoffice"].find((b) => spawnSync("which", [b]).status === 0) ?? (existsSync(mac) ? mac : null);
  return sofficePath;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ status: null, stderr: e.message });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stderr });
    });
  });
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
