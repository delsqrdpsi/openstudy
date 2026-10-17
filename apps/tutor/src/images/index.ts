import type { ImageBackend } from "./types";
import { PlaceholderImages } from "./placeholder";

export type { ImageBackend, ImageRequest, ImageResult } from "./types";

/** IMAGES=placeholder (default). Gemini and gpt-image-1 backends plug in here. */
export function createImages(): ImageBackend {
  const kind = process.env.IMAGES ?? "placeholder";
  switch (kind) {
    case "placeholder":
      return new PlaceholderImages();
    default:
      throw new Error(`unknown IMAGES "${kind}"`);
  }
}
