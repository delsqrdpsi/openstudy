"use client";
import { useEffect, useMemo, useState } from "react";
import { LogEntrySchema, applyEvent, emptyBoard, isContentBlock, type BoardState, type ContentBlock } from "@openstudy/shared";
import { z } from "zod";
import { TUTOR_HTTP } from "@/board/useLiveSession";
import { HtmlBlock } from "@/board/blocks/HtmlBlock";
import { SvgBlock } from "@/board/blocks/SvgBlock";
import { ImageBlock } from "@/board/blocks/ImageBlock";

const ResponseSchema = z.object({
  board: z.object({ id: z.string(), title: z.string(), topic: z.string(), updatedAt: z.number() }),
  log: z.array(LogEntrySchema),
});

/**
 * A board as a printable document: blocks in reading order (column by
 * column), annotations rendered as inline marks. Use the browser's print to
 * save it as a PDF.
 */
export function PrintView({ id }: { id: string }) {
  const [data, setData] = useState<z.infer<typeof ResponseSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${TUTOR_HTTP}/boards/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((j) => setData(ResponseSchema.parse(j)))
      .catch((e) => setError(e.message));
  }, [id]);

  const state: BoardState | null = useMemo(() => {
    if (!data) return null;
    let s = emptyBoard(data.board.title);
    for (const row of data.log) if (row.kind === "event") s = applyEvent(s, row.event);
    return s;
  }, [data]);

  const columns = useMemo(() => {
    if (!state) return [];
    const byCol = new Map<number, ContentBlock[]>();
    for (const b of state.blocks) {
      if (!isContentBlock(b)) continue;
      byCol.set(b.column, [...(byCol.get(b.column) ?? []), b]);
    }
    return [...byCol.entries()].sort((a, b) => a[0] - b[0]).map(([, blocks]) => blocks);
  }, [state]);

  if (error) return <main className="p-10 text-neutral-600">Could not load this board ({error}). Is the tutor server running?</main>;
  if (!data || !state) return <main className="p-10 text-neutral-500">Loading...</main>;

  return (
    <main className="print-doc mx-auto max-w-[760px] px-8 py-10">
      <style>{`
        @page { margin: 18mm; }
        @media print { .no-print { display: none !important; } body { background: #fff !important; } }
        .print-doc .wb-html { font-size: 20px; }
        .print-doc .wb-html h1 { font-size: 1.6em; }
        .print-doc .wb-block { break-inside: avoid; margin: 0 0 22px; }
        .print-doc .wb-column { break-before: auto; }
        .print-doc .wb-column + .wb-column { border-top: 1px dashed rgba(31,42,55,0.2); padding-top: 22px; margin-top: 10px; }
      `}</style>
      <header className="no-print mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] uppercase tracking-wide text-neutral-400">OpenStudy board</div>
          <h1 className="text-xl font-semibold">{data.board.title}</h1>
        </div>
        <button className="ui-btn primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </header>
      {columns.map((blocks, ci) => (
        <section key={ci} className="wb-column">
          {blocks.map((b) => (
            <div key={b.id} className="wb-block">
              {b.type === "html" ? <HtmlBlock block={b} writing={false} /> : b.type === "svg" ? <SvgBlock block={b} /> : <ImageBlock block={b} />}
            </div>
          ))}
        </section>
      ))}
      <footer className="mt-10 text-[12px] text-neutral-400">
        {new Date(data.board.updatedAt).toLocaleString()} · {data.board.topic}
      </footer>
    </main>
  );
}
