import type { ImageBackend, ImageRequest, ImageResult } from "./types";
import type { ImageStore } from "./store";
import { stylePrompt } from "./style";

/**
 * Flux Schnell on fal.ai: one to two seconds, cheap, no legible text.
 * Env: FAL_KEY, optional FAL_MODEL (default fal-ai/flux/schnell).
 */
export class FalImages implements ImageBackend {
  readonly name = "fal";
  get priceKey(): string {
    return `fal:${this.model}`;
  }
  private readonly model = process.env.FAL_MODEL ?? "fal-ai/flux/schnell";
  constructor(private readonly store: ImageStore, private readonly apiKey = process.env.FAL_KEY ?? "") {
    if (!this.apiKey) throw new Error("FAL_KEY is not set");
  }

  async generate({ id, prompt, signal }: ImageRequest): Promise<ImageResult> {
    const res = await fetch(`https://fal.run/${this.model}`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", authorization: `Key ${this.apiKey}` },
      body: JSON.stringify({ prompt: stylePrompt(prompt), image_size: "landscape_16_9", num_images: 1, output_format: "png" }),
    });
    if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { images?: { url: string }[] };
    const url = data.images?.[0]?.url;
    if (!url) throw new Error("fal returned no image");
    const img = await fetch(url, { signal });
    return { url: this.store.save(id, Buffer.from(await img.arrayBuffer()), "png") };
  }
}
