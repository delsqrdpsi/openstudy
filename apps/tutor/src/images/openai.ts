import type { ImageBackend, ImageRequest, ImageResult } from "./types";
import type { ImageStore } from "./store";
import { stylePrompt } from "./style";

/**
 * OpenAI image models. gpt-image-1 draws the most legible labels: about
 * 11 seconds at low quality (the default) and 20 to 30 at medium.
 * gpt-image-1-mini at low quality is a couple of seconds faster and much
 * cheaper, if that matters more than label quality.
 * Env: OPENAI_API_KEY, optional OPENAI_IMAGE_MODEL (gpt-image-1-mini | gpt-image-1),
 * OPENAI_IMAGE_QUALITY (low | medium | high), OPENAI_IMAGE_SIZE (1536x1024 | 1024x1024 | 1024x1536).
 */
export class OpenAIImages implements ImageBackend {
  readonly name = "openai";
  private readonly model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
  private readonly quality = process.env.OPENAI_IMAGE_QUALITY ?? "low";
  private readonly size = process.env.OPENAI_IMAGE_SIZE ?? "1536x1024";
  constructor(private readonly store: ImageStore, private readonly apiKey = process.env.OPENAI_API_KEY ?? "") {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not set");
  }

  async generate({ id, prompt, signal }: ImageRequest): Promise<ImageResult> {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, prompt: stylePrompt(prompt), size: this.size, quality: this.quality, n: 1 }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("openai returned no image");
    return { url: this.store.save(id, Buffer.from(b64, "base64"), "png") };
  }
}
