import type { Block } from "./blocks";
import type { LessonEvent } from "./events";

export interface BoardState {
  title: string;
  /** Insertion order matters: it is the reading order within a column. */
  blocks: Block[];
  sections: string[];
  /** Latest narration line, for captions. */
  caption: string;
  /** Block the camera should follow. */
  focusId: string | null;
}

export const emptyBoard = (title = ""): BoardState => ({
  title,
  blocks: [],
  sections: [],
  caption: "",
  focusId: null,
});

export function applyEvent(state: BoardState, event: LessonEvent): BoardState {
  switch (event.type) {
    case "section":
      return { ...state, sections: [...state.sections, event.title] };
    case "block.add": {
      if (state.blocks.some((b) => b.id === event.block.id)) {
        // Replace in place so a re-sent block keeps its position.
        return {
          ...state,
          blocks: state.blocks.map((b) => (b.id === event.block.id ? event.block : b)),
          focusId: event.block.type === "annotation" ? event.block.target : event.block.id,
        };
      }
      return {
        ...state,
        blocks: [...state.blocks, event.block],
        focusId: event.block.type === "annotation" ? event.block.target : event.block.id,
      };
    }
    case "block.append":
      return {
        ...state,
        focusId: event.id,
        blocks: state.blocks.map((b) =>
          b.id === event.id && b.type === "html" ? { ...b, html: b.html + event.html } : b,
        ),
      };
    case "image.update":
      return {
        ...state,
        blocks: state.blocks.map((b) =>
          b.id === event.id && b.type === "image"
            ? { ...b, status: event.status, url: event.url ?? b.url }
            : b,
        ),
      };
    case "block.remove":
      return {
        ...state,
        blocks: state.blocks.filter((b) => b.id !== event.id && !(b.type === "annotation" && b.target === event.id)),
      };
    case "say":
      return { ...state, caption: event.text };
    case "focus":
      return { ...state, focusId: event.id };
  }
}

export function applyEvents(state: BoardState, events: LessonEvent[]): BoardState {
  return events.reduce(applyEvent, state);
}
