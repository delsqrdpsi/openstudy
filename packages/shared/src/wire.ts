import { z } from "zod";
import { LessonEventSchema } from "./events";

/** Messages between the browser and the tutor server over a websocket. */

/** A file from the student's folder, prepared by the server: pages rendered, text extracted. */
export const SourceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["pdf", "slides", "image", "text"]),
  pages: z.number().int().nonnegative(),
  /** Characters of text extracted. */
  chars: z.number().int().nonnegative(),
  note: z.string().optional(),
});
export type SourceSummary = z.infer<typeof SourceSummarySchema>;

/** Board ids: what nanoid produces, or what a client may choose for a new board. */
export const BOARD_ID = /^[A-Za-z0-9_-]{6,40}$/;
/** Longest message a student can send in one go. */
export const MAX_USER_TEXT = 8000;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    topic: z.string().max(2000).default(""),
    /** Extracted text of any materials the student attached. */
    materials: z.array(z.object({ name: z.string().max(300), text: z.string().max(400_000) })).max(50).default([]),
    /** Ids of server-prepared sources (from POST /sources/scan) to teach from. */
    sources: z.array(z.string().max(64)).max(50).default([]),
    model: z.string().optional(),
    /** Reopen a saved board (and continue its conversation) instead of starting fresh. */
    resume: z.string().regex(BOARD_ID).optional(),
    /**
     * Board id chosen by the client for a new lesson, so a refresh before the
     * server answers reopens the same board instead of starting a second one.
     * If a board with this id exists, the start is treated as a resume.
     */
    id: z.string().regex(BOARD_ID).optional(),
    /** Resume without the welcome-back turn: the client is reconnecting after a dropped connection. */
    quiet: z.boolean().optional(),
  }),
  z.object({ type: z.literal("user"), text: z.string().min(1).max(MAX_USER_TEXT) }),
  /** The narration of a @continue turn has finished playing, or the student pressed Go on after a @wait. */
  z.object({ type: z.literal("continue") }),
  /**
   * The student asked for a different pace ("slow down", "wait") while the
   * tutor was talking. Recorded without stopping the turn: the client has
   * paused the lesson itself. `text` is what they said, for the transcript.
   */
  z.object({ type: z.literal("pace"), slow: z.boolean(), text: z.string().max(MAX_USER_TEXT).optional() }),
  /** Switch the tutor's model; takes effect from the next turn, same conversation. */
  z.object({ type: z.literal("model"), model: z.string().min(1).max(64) }),
  /**
   * heard: how many @say lines of the current turn the student actually heard.
   * The server always answers an interrupt with block.remove events for what
   * was not heard, then exactly one `turn` message, whether or not the model
   * was still writing.
   */
  z.object({ type: z.literal("interrupt"), heard: z.number().int().nonnegative().optional() }),
  /** The student's answer to an `offer` (for now: building an interactive model). */
  z.object({ type: z.literal("offer.answer"), id: z.string().max(64), accept: z.boolean() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const TurnStateSchema = z.enum(["idle", "thinking", "speaking", "waiting", "done"]);
export type TurnState = z.infer<typeof TurnStateSchema>;

/** One row of a saved lesson: a board event or something the student typed. */
export const LogEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), event: LessonEventSchema }),
  z.object({ kind: z.literal("user"), text: z.string() }),
]);
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const BoardSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  topic: z.string(),
  model: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  blocks: z.number(),
});
export type BoardSummary = z.infer<typeof BoardSummarySchema>;

/** Running totals for one lesson. Costs are list-price estimates in USD. */
export const UsageSchema = z.object({
  tutor: z.object({
    turns: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    /** Tokens the model read on the latest turn: how full the context is. */
    contextTokens: z.number(),
    /** The model's context window, when the brain reports it. */
    contextWindow: z.number().optional(),
    costUsd: z.number(),
    /** The CLI reports a running cost per session; the last total seen for each, so only increases are added. */
    sessionCosts: z.record(z.string(), z.number()).optional(),
  }),
  planner: z.object({ calls: z.number(), costUsd: z.number() }),
  images: z.object({ count: z.number(), costUsd: z.number(), backend: z.string().optional() }),
  voice: z.object({ sttSeconds: z.number(), ttsChars: z.number(), costUsd: z.number(), provider: z.string().optional() }),
  totalUsd: z.number(),
  /** True when the brain runs on a subscription: the LLM cost is an estimate, not a charge. */
  subscription: z.boolean(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("usage"), usage: UsageSchema }),
  z.object({ type: z.literal("session"), id: z.string(), brain: z.string(), model: z.string(), title: z.string() }),
  /** Sent on resume, before anything else: the saved lesson so far. */
  z.object({ type: z.literal("history"), log: z.array(LogEntrySchema) }),
  z.object({ type: z.literal("event"), event: LessonEventSchema }),
  /**
   * auto: the tutor ended the turn with @continue; the client sends `continue` once
   * the narration has played and the board has been read. wait: the tutor ended it
   * with @wait; the client shows "Go on" and sends `continue` when the student presses it.
   */
  z.object({ type: z.literal("turn"), state: TurnStateSchema, options: z.array(z.string()).optional(), auto: z.boolean().optional(), wait: z.boolean().optional() }),
  /**
   * code "superseded": this board was opened in another tab or window, which
   * now owns the lesson. The client must not reconnect on its own.
   */
  z.object({ type: z.literal("error"), message: z.string(), code: z.enum(["superseded"]).optional() }),
  z.object({ type: z.literal("debug"), text: z.string() }),
  /**
   * The tutor wants to do something that costs real time and money and runs
   * tools on this machine (building an interactive model takes up to an hour
   * and a few dollars of plan usage). Nothing happens until the student accepts.
   */
  z.object({ type: z.literal("offer"), id: z.string(), kind: z.literal("build_figure"), concept: z.string(), detail: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
