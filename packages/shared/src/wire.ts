import { z } from "zod";
import { LessonEventSchema } from "./events";

/** Messages between the browser and the tutor server over a websocket. */

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    topic: z.string().min(1),
    /** Extracted text of any materials the student attached. */
    materials: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
    model: z.string().optional(),
  }),
  z.object({ type: z.literal("user"), text: z.string().min(1) }),
  z.object({ type: z.literal("interrupt") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const TurnStateSchema = z.enum(["idle", "thinking", "speaking", "waiting", "done"]);
export type TurnState = z.infer<typeof TurnStateSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session"), id: z.string(), brain: z.string(), model: z.string() }),
  z.object({ type: z.literal("event"), event: LessonEventSchema }),
  z.object({ type: z.literal("turn"), state: TurnStateSchema, options: z.array(z.string()).optional() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("debug"), text: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
