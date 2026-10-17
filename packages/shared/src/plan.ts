import { z } from "zod";
import { BlockIdSchema } from "./blocks";

/**
 * What the planner (a stronger, slower model) hands to the live tutor. The
 * tutor follows it section by section and uses the suggested image ids so
 * pictures generated ahead of time land instantly.
 */
export const PlanSectionSchema = z.object({
  id: BlockIdSchema,
  title: z.string().min(1),
  /** What the student should be able to do after this section. */
  goal: z.string(),
  /** Two to five facts or steps the tutor must get across. */
  keyPoints: z.array(z.string()).min(1).max(6),
  /** A concrete analogy or worked example to lean on. */
  example: z.string().optional(),
  /** The Socratic check at the end of the section. */
  checkQuestion: z.string(),
  /** Short options if the check works as multiple choice. */
  checkOptions: z.array(z.string()).max(4).optional(),
  /** Likely misconceptions and how to fix them. */
  pitfalls: z.array(z.string()).max(4).optional(),
  images: z
    .array(z.object({ id: BlockIdSchema, prompt: z.string().min(1) }))
    .max(2)
    .default([]),
});

export const LessonPlanSchema = z.object({
  title: z.string().min(1),
  /** One line on who the student is and what they want, from the intake. */
  student: z.string(),
  sections: z.array(PlanSectionSchema).min(2).max(8),
});

export type PlanSection = z.infer<typeof PlanSectionSchema>;
export type LessonPlan = z.infer<typeof LessonPlanSchema>;

/** JSON Schema for the planner's structured output (no $schema key: the CLI validator rejects it). */
export const LESSON_PLAN_JSON_SCHEMA = (() => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(LessonPlanSchema) as Record<string, unknown> & { $schema?: string };
  void _drop;
  return rest;
})();
