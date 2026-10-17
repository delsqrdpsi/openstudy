import type { LessonEvent } from "@openstudy/shared";

/**
 * The chat-history panel shows what was said plus a one-line label for each
 * thing that happened on the board, so a student can scroll back through the
 * lesson without hunting across the canvas.
 */
export type TranscriptEntry =
  | { kind: "tutor"; text: string }
  | { kind: "user"; text: string }
  | { kind: "action"; label: string; detail?: string; blockId?: string }
  | { kind: "section"; title: string };

export function entryFromEvent(e: LessonEvent): TranscriptEntry | null {
  switch (e.type) {
    case "say":
      return { kind: "tutor", text: e.text };
    case "section":
      return { kind: "section", title: e.title };
    case "block.add": {
      const b = e.block;
      if (b.type === "html") return { kind: "action", label: "Board note", blockId: b.id };
      if (b.type === "svg") return { kind: "action", label: "Diagram", detail: b.caption, blockId: b.id };
      if (b.type === "image") return { kind: "action", label: "Sketch", detail: b.prompt, blockId: b.id };
      const verb = b.kind === "highlight" ? "Highlight" : b.kind === "circle" ? "Circle" : "Underline";
      return { kind: "action", label: verb, detail: b.match, blockId: b.target };
    }
    default:
      return null;
  }
}

/** Merge consecutive tutor lines into one paragraph for readability. */
export function pushEntry(list: TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
  const last = list[list.length - 1];
  if (entry.kind === "tutor" && last?.kind === "tutor") {
    return [...list.slice(0, -1), { kind: "tutor", text: last.text + " " + entry.text }];
  }
  return [...list, entry];
}
