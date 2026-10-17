export interface ImageRequest {
  id: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface ImageResult {
  /** A URL the browser can load: http(s), /path on the web app, or data:. */
  url: string;
}

export interface ImageBackend {
  readonly name: string;
  generate(req: ImageRequest): Promise<ImageResult>;
}
