"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Material {
  name: string;
  text: string;
}

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

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: Material[] = [];
    const skip: string[] = [];
    for (const f of Array.from(files)) {
      if (/\.(txt|md|markdown|csv|json)$/i.test(f.name) || f.type.startsWith("text/")) next.push({ name: f.name, text: await f.text() });
      else skip.push(f.name);
    }
    setMaterials((m) => [...m, ...next]);
    setSkipped((s) => [...s, ...skip]);
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
          {skipped.length > 0 && <p className="px-2 pb-2 text-[12px] text-neutral-500">Skipped (PDF and image reading comes in a later phase): {skipped.join(", ")}</p>}
          <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-2">
            <div className="flex items-center gap-1">
              <label className="ui-btn cursor-pointer" title="Attach notes or text files">
                + Add files
                <input type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} accept=".txt,.md,.markdown,.csv,.json,text/*" />
              </label>
              <select className="ui-btn bg-transparent" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="ui-btn primary px-4" onClick={start} disabled={!topic.trim() && materials.length === 0}>
              Start lesson ↵
            </button>
          </div>
        </div>

        <div className="mt-8 text-[12px] font-semibold uppercase tracking-wide text-neutral-400">Demo without any model</div>
        <Link href="/lesson/rl101" className="ui-card mt-2 inline-flex items-center gap-2 px-4 py-2 text-[14px] hover:border-[var(--coral)]">
          ▶ Reinforcement Learning 101 <span className="text-neutral-400">scripted playback</span>
        </Link>
      </div>
    </main>
  );
}
