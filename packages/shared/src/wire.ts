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

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    topic: z.string().default(""),
    /** Extracted text of any materials the student attached. */
    materials: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
    /** Ids of server-prepared sources (from POST /sources/scan) to teach from. */
    sources: z.array(z.string()).default([]),
    model: z.string().optional(),
    /** Reopen a saved board (and continue its conversation) instead of starting fresh. */
    resume: z.string().optional(),
  }),
  z.object({ type: z.literal("user"), text: z.string().min(1) }),
  /** The narration of a @continue turn has finished playing; go on. */
  z.object({ type: z.literal("continue") }),
  /** Switch the tutor's model; takes effect from the next turn, same conversation. */
  z.object({ type: z.literal("model"), model: z.string().min(1).max(64) }),
  /** heard: how many @say lines of the current turn the student actually heard. */
  z.object({ type: z.literal("interrupt"), heard: z.number().int().nonnegative().optional() }),
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
    costUsd: z.number(),
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
  /** auto: the tutor ended the turn with @continue; the client sends `continue` once the narration has played. */
  z.object({ type: z.literal("turn"), state: TurnStateSchema, options: z.array(z.string()).optional(), auto: z.boolean().optional() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("debug"), text: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
