"use client";
import { useMemo } from "react";
import type { HtmlBlock as HtmlBlockT } from "@openstudy/shared";
import { renderBoardHtml } from "@/lib/html";

export function HtmlBlock({ block, writing }: { block: HtmlBlockT; writing: boolean }) {
  const html = useMemo(() => renderBoardHtml(block.html), [block.html]);
  return (
    <div
      className={`wb-html${writing ? " is-writing" : ""}`}
      data-block-id={block.id}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
