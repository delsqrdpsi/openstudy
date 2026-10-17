import type { ImageBackend, ImageRequest, ImageResult } from "./types";
import type { ImageStore } from "./store";
import { stylePrompt } from "./style";

/**
 * Gemini image generation through the Generative Language API. Default model
 * gemini-2.5-flash-image; the free tier covers low volume.
 * Env: GEMINI_API_KEY, optional GEMINI_IMAGE_MODEL.
 */
export class GeminiImages implements ImageBackend {
  readonly name = "gemini";
  private readonly model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
  constructor(private readonly store: ImageStore, private readonly apiKey = process.env.GEMINI_API_KEY ?? "") {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set");
  }

  async generate({ id, prompt, signal }: ImageRequest): Promise<ImageResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: stylePrompt(prompt) }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
    };
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part?.inlineData) throw new Error("gemini returned no image");
    const ext = part.inlineData.mimeType.includes("png") ? "png" : part.inlineData.mimeType.includes("webp") ? "webp" : "jpg";
    return { url: this.store.save(id, Buffer.from(part.inlineData.data, "base64"), ext) };
  }
}
