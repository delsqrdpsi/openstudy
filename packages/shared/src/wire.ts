import { z } from "zod";
import { LessonEventSchema } from "./events";

/** Messages between the browser and the tutor server over a websocket. */

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    topic: z.string().default(""),
    /** Extracted text of any materials the student attached. */
    materials: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
    model: z.string().optional(),
    /** Reopen a saved board (and continue its conversation) instead of starting fresh. */
    resume: z.string().optional(),
  }),
  z.object({ type: z.literal("user"), text: z.string().min(1) }),
  z.object({ type: z.literal("interrupt") }),
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

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session"), id: z.string(), brain: z.string(), model: z.string(), title: z.string() }),
  /** Sent on resume, before anything else: the saved lesson so far. */
  z.object({ type: z.literal("history"), log: z.array(LogEntrySchema) }),
  z.object({ type: z.literal("event"), event: LessonEventSchema }),
  z.object({ type: z.literal("turn"), state: TurnStateSchema, options: z.array(z.string()).optional() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("debug"), text: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
