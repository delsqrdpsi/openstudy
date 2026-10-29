"use client";
import type { PageBlock as PageBlockT } from "@openstudy/shared";

export const PAGE_W = 640;

/** A page of the student's own material: a slide, a PDF page, a photo. */
export function PageBlock({ block }: { block: PageBlockT }) {
  const h = Math.round(PAGE_W / block.aspect);
  return (
    <div data-block-id={block.id} style={{ width: PAGE_W }}>
      <div className="wb-page" style={{ width: PAGE_W, height: h }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img data-frame="" src={block.src} alt={`${block.source}, page ${block.page}`} width={PAGE_W} height={h} draggable={false} style={{ display: "block", width: PAGE_W, height: h }} />
      </div>
      <div className="wb-caption">
        {block.source} · p.{block.page}
        {block.caption ? ` · ${block.caption}` : ""}
      </div>
    </div>
  );
}
