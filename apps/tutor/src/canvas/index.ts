/**
 * A course the tutor can pull from on demand. When a lesson is started with
 * a course attached, every page, assignment and readable file is fetched
 * once in the background and split into chunks tagged with the item and,
 * for slide decks, the page. The tutor then asks for material with a query
 * (`@pull`), and gets back the few chunks that match, not the whole course.
 *
 * Text is cached on disk under data/canvas/<domain>/<course>/ so a second
 * lesson on the same course starts instantly.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CanvasClient, htmlToText, type CourseItem } from "./client";
import { dataDir } from "../paths";
import { log } from "../log";

export interface Chunk {
  item: string;
  kind: CourseItem["kind"];
  group: string;
  /** Slide or page number inside a deck, when known. */
  page?: number;
  text: string;
}

export interface Hit extends Chunk {
  score: number;
}

export interface IndexStatus {
  courseId: number;
  name: string;
  state: "indexing" | "ready" | "failed";
  items: number;
  done: number;
  chunks: number;
  error?: string;
}

/** One index per course per server, shared by every lesson on it. */
const open = new Map<string, CourseIndex>();

export function openCourse(client: CanvasClient, domain: string, courseId: number, name: string): CourseIndex {
  const key = `${domain}/${courseId}`;
  let idx = open.get(key);
  if (!idx || idx.status.state === "failed") {
    idx = new CourseIndex(client, domain, courseId, name);
    open.set(key, idx);
  }
  return idx;
}

export function courseStatus(domain: string, courseId: number): IndexStatus | null {
  return open.get(`${domain}/${courseId}`)?.status ?? null;
}

const MAX_ITEMS = 300;
const MAX_ITEM_CHARS = 120_000;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const CHUNK_CHARS = 900;
const READABLE_FILE = /\.(pdf|txt|md|markdown|csv|json|html?)$/i;

export class CourseIndex {
  status: IndexStatus;
  chunks: Chunk[] = [];
  /** Document frequency of each term, for scoring. */
  private df = new Map<string, number>();
  readonly ready: Promise<void>;
  private outline: CourseItem[] = [];

  constructor(
    private client: CanvasClient,
    private domain: string,
    readonly courseId: number,
    readonly name: string,
  ) {
    this.status = { courseId, name, state: "indexing", items: 0, done: 0, chunks: 0 };
    this.ready = this.build().catch((err) => {
      this.status.state = "failed";
      this.status.error = err instanceof Error ? err.message : String(err);
      log.warn("course index failed", courseId, this.status.error);
    });
  }

  /** The course as a list of names, for the planner and the tutor's prompt. */
  outlineText(): string {
    const groups = new Map<string, string[]>();
    for (const it of this.outline) {
      const list = groups.get(it.group) ?? [];
      list.push(`${it.name} (${it.kind})`);
      groups.set(it.group, list);
    }
    return Array.from(groups.entries())
      .map(([g, names]) => `${g}: ${names.join("; ")}`)
      .join("\n");
  }

  private async build() {
    const items = (await this.client.items(this.courseId)).slice(0, MAX_ITEMS);
    this.outline = items;
    this.status.items = items.length;
    const dir = join(dataDir(), "canvas", this.domain, String(this.courseId));
    mkdirSync(dir, { recursive: true });
    // A few at a time: Canvas rate-limits per token, and a deck can take a second to read.
    const queue = [...items];
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        try {
          const text = await this.textOf(it, dir);
          if (text) this.add(it, text);
        } catch (err) {
          log.warn("course item skipped", it.kind, it.name, err instanceof Error ? err.message : err);
        }
        this.status.done += 1;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this.status.state = "ready";
    this.status.chunks = this.chunks.length;
    log.info(`course ${this.name}: ${this.chunks.length} chunks from ${items.length} items`);
  }

  private async textOf(it: CourseItem, dir: string): Promise<string | null> {
    const cache = join(dir, `${it.kind}-${it.id.replace(/[^a-z0-9_-]/gi, "_")}.txt`);
    if (existsSync(cache)) return readFileSync(cache, "utf8");
    let text: string;
    if (it.kind === "file") {
      if (!READABLE_FILE.test(it.name) && !/pdf|text\//.test(it.contentType ?? "")) return null;
      if ((it.size ?? 0) > MAX_FILE_BYTES) return null;
      const f = await this.client.file(it.id);
      const bytes = new Uint8Array(await f.body.arrayBuffer());
      text = /pdf/i.test(f.type) || /\.pdf$/i.test(it.name) ? await pdfText(bytes) : /html/i.test(f.type) ? htmlToText(Buffer.from(bytes).toString("utf8")) : Buffer.from(bytes).toString("utf8");
    } else {
      text = (await this.client.text(this.courseId, it.kind, it.id)).text;
    }
    text = text.slice(0, MAX_ITEM_CHARS);
    writeFileSync(cache, text);
    return text;
  }

  private add(it: CourseItem, text: string) {
    for (const c of splitChunks(text)) {
      const chunk: Chunk = { item: it.name, kind: it.kind, group: it.group, page: c.page, text: c.text };
      this.chunks.push(chunk);
      for (const t of new Set(terms(`${it.name} ${c.text}`))) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.status.chunks = this.chunks.length;
  }

  /** Wait for the index, but not forever: a partial index is better than a silent tutor. */
  async settle(ms: number) {
    await Promise.race([this.ready, new Promise((r) => setTimeout(r, ms))]);
  }

  /** The chunks that best match a query, best first. Works on whatever is indexed so far. */
  search(query: string, limit = 8): Hit[] {
    const q = Array.from(new Set(terms(query)));
    if (!q.length) return [];
    const n = Math.max(1, this.chunks.length);
    const hits: Hit[] = [];
    for (const c of this.chunks) {
      const body = terms(c.text);
      const title = terms(c.item);
      let score = 0;
      for (const t of q) {
        const idf = Math.log(1 + n / (1 + (this.df.get(t) ?? 0)));
        let tf = 0;
        for (const w of body) if (w === t) tf += 1;
        if (tf) score += idf * (1 + Math.log(tf));
        if (title.includes(t)) score += idf * 1.5; // the item's name counts for a lot
      }
      if (score > 0) hits.push({ ...c, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
}

/** Lowercase word stems, crude but even-handed: strip plural s and -ing/-ed. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'+-]*/g) ?? [])
    .map((w) => {
      w = w.replace(/'s$/, "");
      if (w.length > 5 && /(ing|ed)$/.test(w)) return w.replace(/(ing|ed)$/, "");
      if (w.length > 3 && /[^s]s$/.test(w)) return w.slice(0, -1);
      return w;
    })
    .filter((w) => w.length > 1 && !STOP.has(w));
}

const STOP = new Set("the a an and or of to in on for with is are was be by as at it its this that these those from how what why when which do does not no can will your you we our i me my they them their it's about into over than then so if".split(" "));

/**
 * Split an item's text into chunks of a few hundred words. Page markers from
 * the PDF reader (`--- page N ---`) start a new chunk and tag it with the page.
 */
export function splitChunks(text: string): { page?: number; text: string }[] {
  const out: { page?: number; text: string }[] = [];
  const parts = text.split(/^--- page (\d+) ---$/m);
  // parts: [before, pageNo, pageText, pageNo, pageText, ...]
  const push = (page: number | undefined, body: string) => {
    const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let cur = "";
    for (const p of paras) {
      if (cur && cur.length + p.length > CHUNK_CHARS) {
        out.push({ page, text: cur });
        cur = "";
      }
      cur = cur ? `${cur}\n\n${p}` : p;
      while (cur.length > CHUNK_CHARS * 2) {
        out.push({ page, text: cur.slice(0, CHUNK_CHARS * 2) });
        cur = cur.slice(CHUNK_CHARS * 2);
      }
    }
    if (cur) out.push({ page, text: cur });
  };
  push(undefined, parts[0]);
  for (let i = 1; i < parts.length; i += 2) push(Number(parts[i]), parts[i + 1] ?? "");
  return out;
}

/** A PDF's text, page by page, with the same markers the browser reader uses. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    let out = "";
    let lastY: number | null = null;
    for (const item of content.items as { str: string; transform: number[] }[]) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        out += line.trimEnd() + "\n";
        line = "";
      }
      line += item.str;
      lastY = y;
    }
    out += line;
    pages.push(`--- page ${i} ---\n${out.trim()}`);
    if (pages.join("\n").length > MAX_ITEM_CHARS) break;
  }
  await task.destroy();
  return pages.join("\n\n");
}

/** What the tutor reads back after a @pull: the matching chunks, grouped by item, with slide numbers. */
export function formatHits(hits: Hit[], maxChars = 9000): string {
  if (!hits.length) return "(nothing in the course matched)";
  const byItem = new Map<string, Hit[]>();
  for (const h of hits) byItem.set(h.item, [...(byItem.get(h.item) ?? []), h]);
  let out = "";
  for (const [item, list] of byItem) {
    const first = list[0];
    out += `--- ${item} (${first.kind}, ${first.group}) ---\n`;
    for (const h of list.sort((a, b) => (a.page ?? 0) - (b.page ?? 0))) {
      out += (h.page ? `[slide ${h.page}]\n` : "") + h.text + "\n\n";
      if (out.length > maxChars) return out.slice(0, maxChars) + "\n...";
    }
  }
  return out.trim();
}
