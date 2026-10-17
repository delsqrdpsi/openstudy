"use client";
import { useMemo } from "react";
import type { SvgBlock as SvgBlockT } from "@openstudy/shared";
import { motionSvg, sketchSvg } from "@/lib/sketch";
import { hashId } from "../annotations";

export function SvgBlock({ block }: { block: SvgBlockT }) {
  const svg = useMemo(
    () => (block.motion ? motionSvg(block.svg) : sketchSvg(block.svg, { seed: hashId(block.id) % 1000 })),
    [block.svg, block.id, block.motion],
  );
  // Model SVGs use a small viewBox (300 by 200); show them at a readable size.
  const scale = 1.4;
  return (
    <div data-block-id={block.id} style={{ width: block.width * scale }} data-motion={block.motion ? "1" : undefined}>
      <div
        className="[&>svg]:h-full [&>svg]:w-full"
        style={{ width: block.width * scale, height: block.height * scale }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {block.caption && <div className="wb-caption">{block.caption}</div>}
    </div>
  );
}
