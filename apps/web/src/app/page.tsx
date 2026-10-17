"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BoardSummarySchema, type BoardSummary } from "@openstudy/shared";
import { TUTOR_HTTP } from "@/board/useLiveSession";
import { readMaterial, type Material } from "@/lib/materials";

const MODELS = [
  { id: "sonnet", label: "Sonnet (fast)" },
  { id: "opus", label: "Opus (deeper)" },
];

export default function Home() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [model, setModel] = useState("sonnet");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);

  const loadBoards = () =>
    fetch(`${TUTOR_HTTP}/boards`)
      .then((r) => r.json())
      .then((rows: unknown[]) => setBoards(rows.map((r) => BoardSummarySchema.parse(r))))
      .catch(() => setBoards([]));
  useEffect(() => {
    const id = window.setTimeout(loadBoards, 0);
    return () => window.clearTimeout(id);
  }, []);

  const remove = async (id: string) => {
    await fetch(`${TUTOR_HTTP}/boards/${id}`, { method: "DELETE" }).catch(() => {});
    loadBoards();
  };

  const [reading, setReading] = useState(0);
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setReading((n) => n + files.length);
    for (const f of Array.from(files)) {
      try {
        const r = await readMaterial(f);
        if (r.material) setMaterials((m) => [...m, r.material!]);
        if (r.skipped) setSkipped((s) => [...s, r.skipped!]);
      } catch {
        setSkipped((s) => [...s, `${f.name} (could not read)`]);
      } finally {
        setReading((n) => n - 1);
      }
    }
  };

  const start = () => {
    const t = topic.trim();
    if (!t && materials.length === 0) return;
    try {
      sessionStorage.setItem("openstudy.materials", JSON.stringify(materials));
    } catch {
      /* ignore */
    }
    const q = new URLSearchParams({ topic: t || `Teach me what is in ${materials.map((m) => m.name).join(", ")}`, model });
    router.push(`/live?${q.toString()}`);
  };

  return (
    <main className="wb-paper flex min-h-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <h1 style={{ fontFamily: "var(--wb-font-head)" }} className="text-5xl text-[var(--ink)]">
          OpenStudy
        </h1>
        <p className="mt-2 text-[15px] text-neutral-600">
          A tutor at a whiteboard, on your own machine. Tell it what you want to learn. It will ask a couple of questions, make a plan, and start.
        </p>

        <div className="ui-card mt-6 p-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
          <textarea
            className="min-h-28 w-full resize-none bg-transparent p-2 text-[16px] outline-none placeholder:text-neutral-400"
            placeholder="What do you want to learn? For example: how diffusion models generate images, for someone who knows basic probability."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
            }}
            aria-label="What do you want to learn"
          />
          {materials.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-2 pb-2">
              {materials.map((m, i) => (
                <li key={i} className="flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-[13px]">
                  {m.name}
                  <button className="text-neutral-400 hover:text-neutral-700" onClick={() => setMaterials((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${m.name}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {reading > 0 && <p className="px-2 pb-2 text-[12px] text-neutral-500">Reading {reading} file{reading > 1 ? "s" : ""}...</p>}
          {skipped.length > 0 && <p className="px-2 pb-2 text-[12px] text-neutral-500">Skipped (images and scanned PDFs are not read yet): {skipped.join(", ")}</p>}
          <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-2">
            <div className="flex items-center gap-1">
              <label className="ui-btn cursor-pointer" title="Attach notes or text files">
                + Add files
                <input type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} accept=".pdf,.txt,.md,.markdown,.csv,.json,.py,.js,.ts,.html,application/pdf,text/*" />
              </label>
              <select className="ui-btn bg-transparent" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="ui-btn primary px-4" onClick={start} disabled={reading > 0 || (!topic.trim() && materials.length === 0)}>
              Start lesson ↵
            </button>
          </div>
        </div>

        {boards && boards.length > 0 && (
          <section className="mt-8">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-neutral-400">Your boards</div>
            <ul className="ui-card mt-2 divide-y divide-neutral-100">
              {boards.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Link href={`/live?board=${b.id}`} className="min-w-0 flex-1 hover:text-[var(--coral)]">
                    <div className="truncate text-[14px] font-medium">{b.title}</div>
                    <div className="truncate text-[12px] text-neutral-500">
                      {relative(b.updatedAt)} · {b.blocks} blocks · {b.model}
                    </div>
                  </Link>
                  <button className="ui-btn text-neutral-400 hover:text-[var(--coral)]" onClick={() => remove(b.id)} aria-label={`Delete ${b.title}`} title="Delete board">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-8 text-[12px] font-semibold uppercase tracking-wide text-neutral-400">Demo without any model</div>
        <Link href="/lesson/rl101" className="ui-card mt-2 inline-flex items-center gap-2 px-4 py-2 text-[14px] hover:border-[var(--coral)]">
          ▶ Reinforcement Learning 101 <span className="text-neutral-400">scripted playback</span>
        </Link>
      </div>
    </main>
  );
}

function relative(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.round(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
