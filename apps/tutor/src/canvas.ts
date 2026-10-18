/**
 * Canvas LMS. The student finds their school, pastes an access token from
 * their Canvas settings, and can then pull pages, assignments and files from
 * their courses into a lesson. The token stays on this server; the browser
 * only ever sees course and item names.
 */

export interface CanvasConnection {
  domain: string;
  token: string;
  user: string;
}

export interface School {
  name: string;
  domain: string;
}

export interface Course {
  id: number;
  name: string;
  code: string;
}

export type ItemKind = "page" | "assignment" | "file";

export interface CourseItem {
  kind: ItemKind;
  /** Page url slug for pages, numeric id otherwise. */
  id: string;
  name: string;
  /** Module name, or a fallback group ("Pages", "Assignments", "Files"). */
  group: string;
  /** Files only. */
  size?: number;
  contentType?: string;
}

export class CanvasError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const MAX_PAGES = 10;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

/**
 * A school's Canvas address from whatever the student typed: a bare host, a
 * full URL, or a URL copied from the address bar. Null if it is not a host.
 */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return s;
}

/** Instructure's school directory, the one the Canvas Student app searches. */
const DIRECTORIES = ["https://sso.canvaslms.com", "https://canvas.instructure.com"];

export async function searchSchools(term: string, signal?: AbortSignal): Promise<School[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  let lastError: unknown;
  for (const base of DIRECTORIES) {
    try {
      const res = await fetch(`${base}/api/v1/accounts/search?per_page=50&search_term=${encodeURIComponent(q)}`, { signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new CanvasError(`school search failed (${res.status})`);
      const rows = (await res.json()) as { name?: string; domain?: string }[];
      const seen = new Set<string>();
      const out: School[] = [];
      for (const r of rows) {
        const domain = normalizeDomain(r.domain ?? "");
        if (!domain || !r.name || seen.has(domain)) continue;
        seen.add(domain);
        out.push({ name: r.name.trim(), domain });
      }
      return out.slice(0, 20);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new CanvasError("school search failed");
}

/** The next page from a Canvas `Link` header, if any. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return null;
}

/** Page and assignment bodies as plain text the tutor can read. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|pre|section)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class CanvasClient {
  constructor(
    private domain: string,
    private token: string,
  ) {}

  private async get(pathOrUrl: string, signal?: AbortSignal): Promise<Response> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `https://${this.domain}/api/v1${pathOrUrl}`;
    if (new URL(url).hostname !== this.domain) throw new CanvasError("unexpected host in Canvas link");
    let res: Response;
    try {
      res = await fetch(url, { signal, headers: { authorization: `Bearer ${this.token}`, accept: "application/json" } });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new CanvasError(`could not reach ${this.domain}`);
    }
    if (res.status === 401) throw new CanvasError("Canvas did not accept the access token", 401);
    if (res.status === 403) throw new CanvasError("Canvas says you do not have access to that", 403);
    if (res.status === 404) throw new CanvasError("not found on Canvas", 404);
    if (!res.ok) throw new CanvasError(`Canvas returned ${res.status}`);
    return res;
  }

  private async json<T>(path: string, signal?: AbortSignal): Promise<T> {
    return (await (await this.get(path, signal)).json()) as T;
  }

  /** Every page of a list endpoint, up to a sane limit. */
  private async all<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path + (path.includes("?") ? "&" : "?") + "per_page=100";
    for (let i = 0; next && i < MAX_PAGES; i++) {
      const res = await this.get(next, signal);
      out.push(...((await res.json()) as T[]));
      next = nextLink(res.headers.get("link"));
    }
    return out;
  }

  /** Who the token belongs to; also how a new token is checked. */
  async self(signal?: AbortSignal): Promise<{ name: string }> {
    const u = await this.json<{ name?: string; short_name?: string }>("/users/self", signal);
    return { name: u.short_name || u.name || "you" };
  }

  async courses(signal?: AbortSignal): Promise<Course[]> {
    const rows = await this.all<{ id: number; name?: string; course_code?: string; access_restricted_by_date?: boolean }>(
      "/courses?enrollment_state=active&state[]=available",
      signal,
    );
    return rows.filter((c) => c.name && !c.access_restricted_by_date).map((c) => ({ id: c.id, name: c.name!, code: c.course_code ?? "" }));
  }

  /**
   * What a course offers to study from, grouped by module the way the
   * student sees it in Canvas, then anything not in a module. Tabs a course
   * has hidden (often Files and Pages) come back as errors and are skipped.
   */
  async items(courseId: number, signal?: AbortSignal): Promise<CourseItem[]> {
    const c = `/courses/${courseId}`;
    const quiet = <T>(p: Promise<T[]>) => p.catch((err) => (signal?.aborted ? Promise.reject(err) : ([] as T[])));
    type ModuleRow = { name: string; items?: { type: string; title: string; content_id?: number; page_url?: string }[] };
    const [modules, pages, assignments, files] = await Promise.all([
      quiet(this.all<ModuleRow>(`${c}/modules?include[]=items`, signal)),
      quiet(this.all<{ url: string; title: string }>(`${c}/pages?sort=title`, signal)),
      quiet(this.all<{ id: number; name: string }>(`${c}/assignments?order_by=position`, signal)),
      quiet(this.all<{ id: number; display_name: string; size?: number; "content-type"?: string }>(`${c}/files?sort=name`, signal)),
    ]);
    const out: CourseItem[] = [];
    const seen = new Set<string>();
    const add = (item: CourseItem) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    };
    const fileInfo = new Map(files.map((f) => [String(f.id), f]));
    for (const m of modules) {
      for (const it of m.items ?? []) {
        if (it.type === "Page" && it.page_url) add({ kind: "page", id: it.page_url, name: it.title, group: m.name });
        else if (it.type === "Assignment" && it.content_id) add({ kind: "assignment", id: String(it.content_id), name: it.title, group: m.name });
        else if (it.type === "File" && it.content_id) {
          const f = fileInfo.get(String(it.content_id));
          add({ kind: "file", id: String(it.content_id), name: it.title, group: m.name, size: f?.size, contentType: f?.["content-type"] });
        }
      }
    }
    for (const a of assignments) add({ kind: "assignment", id: String(a.id), name: a.name, group: "Assignments" });
    for (const p of pages) add({ kind: "page", id: p.url, name: p.title, group: "Pages" });
    for (const f of files) add({ kind: "file", id: String(f.id), name: f.display_name, group: "Files", size: f.size, contentType: f["content-type"] });
    return out;
  }

  /** A page or an assignment as text. */
  async text(courseId: number, kind: "page" | "assignment", id: string, signal?: AbortSignal): Promise<{ name: string; text: string }> {
    if (kind === "page") {
      const p = await this.json<{ title: string; body?: string }>(`/courses/${courseId}/pages/${encodeURIComponent(id)}`, signal);
      return { name: p.title, text: htmlToText(p.body ?? "") };
    }
    const a = await this.json<{ name: string; description?: string; due_at?: string | null; points_possible?: number | null }>(
      `/courses/${courseId}/assignments/${encodeURIComponent(id)}`,
      signal,
    );
    const head = [a.due_at ? `Due: ${a.due_at}` : "", a.points_possible != null ? `Points: ${a.points_possible}` : ""].filter(Boolean).join("\n");
    return { name: a.name, text: [head, htmlToText(a.description ?? "")].filter(Boolean).join("\n\n") };
  }

  /** A file's bytes, for the browser to read like any attached file. */
  async file(id: string, signal?: AbortSignal): Promise<{ name: string; type: string; body: Response }> {
    const f = await this.json<{ display_name: string; url?: string; size?: number; "content-type"?: string }>(`/files/${encodeURIComponent(id)}`, signal);
    if (!f.url) throw new CanvasError("Canvas will not let you download that file", 403);
    if ((f.size ?? 0) > MAX_FILE_BYTES) throw new CanvasError("that file is too big to read here", 413);
    // The download url carries its own verifier and redirects to storage; it must not get the token.
    const body = await fetch(f.url, { signal });
    if (!body.ok) throw new CanvasError(`file download failed (${body.status})`);
    return { name: f.display_name, type: f["content-type"] || body.headers.get("content-type") || "application/octet-stream", body };
  }
}
