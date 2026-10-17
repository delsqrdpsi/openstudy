import { z } from "zod";
import { BlockSchema, BlockIdSchema, ImageStatusSchema } from "./blocks";

/**
 * Everything that changes the board or the narration is an event. The tutor
 * server emits them over a websocket; the fixture player emits them from a
 * script. The client reducer is the same either way.
 */
export const LessonEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("section"), title: z.string() }),
  /** Add a block. Html may start empty and be streamed with block.append. */
  z.object({ type: z.literal("block.add"), block: BlockSchema }),
  /** Append streamed html to an html block. */
  z.object({ type: z.literal("block.append"), id: BlockIdSchema, html: z.string() }),
  /** Image finished (or failed) generating. */
  z.object({
    type: z.literal("image.update"),
    id: BlockIdSchema,
    status: ImageStatusSchema,
    url: z.string().optional(),
  }),
  z.object({ type: z.literal("block.remove"), id: BlockIdSchema }),
  /** Narration. In fixture playback it drives captions; live it is TTS text. */
  z.object({ type: z.literal("say"), text: z.string() }),
  /** Camera hint: bring this block into view. */
  z.object({ type: z.literal("focus"), id: BlockIdSchema }),
]);

export type LessonEvent = z.infer<typeof LessonEventSchema>;

export const TimedEventSchema = z.object({
  /** Milliseconds from lesson start. */
  at: z.number().nonnegative(),
  event: LessonEventSchema,
});

export const LessonFixtureSchema = z.object({
  id: z.string(),
  title: z.string(),
  events: z.array(TimedEventSchema),
});

export type TimedEvent = z.infer<typeof TimedEventSchema>;
export type LessonFixture = z.infer<typeof LessonFixtureSchema>;
