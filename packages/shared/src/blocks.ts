import { z } from "zod";

/**
 * The board is a document of blocks, not a canvas. The model never emits
 * coordinates. It emits blocks with ids and a column; the client flows them.
 */

export const BlockIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, "block ids are snake_case");

export const HtmlBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("html"),
  column: z.number().int().min(0).max(7),
  html: z.string(),
});

export const SvgBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("svg"),
  column: z.number().int().min(0).max(7),
  svg: z.string(),
  width: z.number().int().positive().default(300),
  height: z.number().int().positive().default(200),
  /** Optional caption rendered under the diagram in handwriting. */
  caption: z.string().optional(),
});

export const ImageStatusSchema = z.enum(["pending", "ready", "failed"]);

export const ImageBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("image"),
  column: z.number().int().min(0).max(7),
  prompt: z.string(),
  url: z.string().optional(),
  status: ImageStatusSchema.default("pending"),
  caption: z.string().optional(),
});

export const AnnotationKindSchema = z.enum(["highlight", "circle", "underline"]);

export const AnnotationBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("annotation"),
  /** Id of the block this annotation sits on. */
  target: BlockIdSchema,
  kind: AnnotationKindSchema,
  /** Text to find inside the target block. First match wins. */
  match: z.string().min(1),
  color: z.string().optional(),
});

export const BlockSchema = z.discriminatedUnion("type", [
  HtmlBlockSchema,
  SvgBlockSchema,
  ImageBlockSchema,
  AnnotationBlockSchema,
]);

export type HtmlBlock = z.infer<typeof HtmlBlockSchema>;
export type SvgBlock = z.infer<typeof SvgBlockSchema>;
export type ImageBlock = z.infer<typeof ImageBlockSchema>;
export type AnnotationBlock = z.infer<typeof AnnotationBlockSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type ContentBlock = Exclude<Block, AnnotationBlock>;

export const isContentBlock = (b: Block): b is ContentBlock => b.type !== "annotation";

export const ANNOTATION_COLORS: Record<z.infer<typeof AnnotationKindSchema>, string> = {
  highlight: "#FFC800",
  circle: "#06B2FC",
  underline: "#F653A2",
};
