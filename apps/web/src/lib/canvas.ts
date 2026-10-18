/**
 * The browser's view of the Canvas connection, all through the tutor server
 * (which holds the access token). Course items come back as materials, the
 * same shape as a dropped file.
 */
import { TUTOR_HTTP } from "@/board/useLiveSession";
import { readMaterial, type Material } from "./materials";

export interface CanvasStatus {
  connected: boolean;
  domain?: string;
  user?: string;
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
export interface IndexStatus {
  courseId: number;
  name: string;
  state: "indexing" | "ready" | "failed";
  items: number;
  done: number;
  chunks: number;
  error?: string;
}
export interface CourseItem {
  kind: "page" | "assignment" | "file";
  id: string;
  name: string;
  group: string;
  size?: number;
  contentType?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${TUTOR_HTTP}${path}`, init);
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = String(((await res.json()) as { error?: string }).error ?? message);
    } catch {
      /* not json */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const canvas = {
  status: () => call<CanvasStatus>("/canvas"),
  schools: (q: string, signal?: AbortSignal) => call<{ schools: School[] }>(`/canvas/schools?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.schools),
  connect: (domain: string, token: string) =>
    call<CanvasStatus>("/canvas/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain, token }) }),
  disconnect: () => call<{ ok: true }>("/canvas", { method: "DELETE" }),
  courses: () => call<{ courses: Course[] }>("/canvas/courses").then((r) => r.courses),
  items: (courseId: number) => call<{ items: CourseItem[] }>(`/canvas/courses/${courseId}/items`).then((r) => r.items),
  /** Have the server read the whole course (once; cached), so the tutor can pull from it on demand. */
  index: (course: Course) =>
    call<IndexStatus>(`/canvas/courses/${course.id}/index`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: course.name }) }),
  indexStatus: (courseId: number) => call<IndexStatus>(`/canvas/courses/${courseId}/index`),

  /** One course item as lesson material; files go through the same reader as attached files. */
  async material(courseId: number, item: CourseItem): Promise<{ material?: Material; skipped?: string }> {
    if (item.kind === "file") {
      const res = await fetch(`${TUTOR_HTTP}/canvas/files/${item.id}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: `${res.status}` }))).error);
      const blob = await res.blob();
      return readMaterial(new File([blob], item.name, { type: item.contentType || blob.type }));
    }
    const t = await call<{ name: string; text: string }>(`/canvas/courses/${courseId}/text?kind=${item.kind}&id=${encodeURIComponent(item.id)}`);
    if (!t.text.trim()) return { skipped: `${t.name} (empty)` };
    return { material: { name: t.name, text: t.text } };
  },
};

/** Where in Canvas a student makes a token: Account > Settings > Approved Integrations. */
export function tokenSettingsUrl(domain: string): string {
  return `https://${domain}/profile/settings#access_tokens_holder`;
}
