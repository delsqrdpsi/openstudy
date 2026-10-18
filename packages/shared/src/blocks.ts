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
  /** Animated SVG (SMIL or CSS): rendered as written, not redrawn by hand. */
  motion: z.boolean().optional(),
});

/** A word or line of text on a rendered page, as fractions of the page box. */
export const TextBoxSchema = z.object({
  text: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type TextBox = z.infer<typeof TextBoxSchema>;

/** A page of the student's own material (a slide, a PDF page, a photo) placed on the board. */
export const PageBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("page"),
  column: z.number().int().min(0).max(7),
  /** Image of the page. */
  src: z.string().min(1),
  /** Source file name and page number, for the caption and the transcript. */
  source: z.string(),
  page: z.number().int().positive(),
  /** Aspect ratio, width over height, so the layout knows the height before the image loads. */
  aspect: z.number().positive().default(1.333),
  /** Text on the page with positions; empty for images with no text layer. */
  boxes: z.array(TextBoxSchema).default([]),
  caption: z.string().optional(),
});

/** A self-contained interactive page (an Anatomy figure) shown in a sandboxed frame. */
export const EmbedBlockSchema = z.object({
  id: BlockIdSchema,
  type: z.literal("embed"),
  column: z.number().int().min(0).max(7),
  src: z.string().min(1),
  title: z.string().optional(),
  caption: z.string().optional(),
  height: z.number().int().positive().default(420),
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
  /** Text to find inside the target block. First match wins. Empty when a region is given. */
  match: z.string().default(""),
  /** Fraction of the target block's box (0 to 1), for pictures and diagrams. */
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }).optional(),
  color: z.string().optional(),
});

export const BlockSchema = z.discriminatedUnion("type", [
  HtmlBlockSchema,
  SvgBlockSchema,
  ImageBlockSchema,
  EmbedBlockSchema,
  PageBlockSchema,
  AnnotationBlockSchema,
]);

export type HtmlBlock = z.infer<typeof HtmlBlockSchema>;
export type SvgBlock = z.infer<typeof SvgBlockSchema>;
export type ImageBlock = z.infer<typeof ImageBlockSchema>;
export type EmbedBlock = z.infer<typeof EmbedBlockSchema>;
export type PageBlock = z.infer<typeof PageBlockSchema>;
export type AnnotationBlock = z.infer<typeof AnnotationBlockSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type ContentBlock = Exclude<Block, AnnotationBlock>;

export const isContentBlock = (b: Block): b is ContentBlock => b.type !== "annotation";

export const ANNOTATION_COLORS: Record<z.infer<typeof AnnotationKindSchema>, string> = {
  highlight: "#e9ff4a",
  circle: "#e4572e",
  underline: "#0f9d8a",
};
