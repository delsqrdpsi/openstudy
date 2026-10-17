import type { ImageBackend } from "./types";
import { ImageStore } from "./store";
import { GeminiImages } from "./gemini";
import { OpenAIImages } from "./openai";
import { FalImages } from "./fal";

export type { ImageBackend, ImageRequest, ImageResult } from "./types";
export { ImageStore } from "./store";

export const imageStore = new ImageStore();

/**
 * IMAGES=gemini | openai | fal | none. Unset: gemini if GEMINI_API_KEY is
 * present, otherwise none (the tutor is told not to draw pictures).
 */
export function createImages(): ImageBackend | null {
  const kind = process.env.IMAGES ?? (process.env.GEMINI_API_KEY ? "gemini" : "none");
  switch (kind) {
    case "none":
      return null;
    case "gemini":
      return new GeminiImages(imageStore);
    case "openai":
      return new OpenAIImages(imageStore);
    case "fal":
      return new FalImages(imageStore);
    default:
      throw new Error(`unknown IMAGES "${kind}"`);
  }
}
