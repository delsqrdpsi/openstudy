import type { Usage } from "@openstudy/shared";

/**
 * Running totals for a lesson. LLM costs come straight from the CLI's own
 * accounting (list price; on a subscription nothing is charged). Pictures
 * and hosted voice use the list prices below, which are estimates.
 */
export const PRICES = {
  /** USD per 1,000 characters of Aura-2 speech. */
  deepgramTtsPer1kChars: 0.03,
  /** USD per minute of streamed Nova-3 transcription. */
  deepgramSttPerMinute: 0.0077,
  /** USD per picture, by backend and quality. */
  image: {
    "openai:gpt-image-1:low": 0.011,
    "openai:gpt-image-1:medium": 0.042,
    "openai:gpt-image-1:high": 0.167,
    "openai:gpt-image-1-mini:low": 0.005,
    "openai:gpt-image-1-mini:medium": 0.011,
    "openai:gpt-image-1-mini:high": 0.036,
    "gemini:gemini-2.5-flash-image": 0.039,
    "fal:fal-ai/flux/schnell": 0.003,
  } as Record<string, number>,
};

export const emptyUsage = (subscription = true): Usage => ({
  tutor: { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextTokens: 0, costUsd: 0 },
  planner: { calls: 0, costUsd: 0 },
  images: { count: 0, costUsd: 0 },
  voice: { sttSeconds: 0, ttsChars: 0, costUsd: 0 },
  totalUsd: 0,
  subscription,
});

export interface TurnUsage {
  cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export class UsageMeter {
  usage: Usage;
  private listeners = new Set<(u: Usage) => void>();

  constructor(initial?: Usage | null, subscription = true) {
    this.usage = initial ?? emptyUsage(subscription);
  }

  onChange(fn: (u: Usage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    const u = this.usage;
    u.totalUsd = round(u.tutor.costUsd + u.planner.costUsd + u.images.costUsd + u.voice.costUsd, 4);
    for (const fn of this.listeners) fn(u);
  }

  turn(meta: TurnUsage | undefined) {
    const t = this.usage.tutor;
    const u = meta?.usage ?? {};
    t.turns += 1;
    t.inputTokens += u.input_tokens ?? 0;
    t.outputTokens += u.output_tokens ?? 0;
    t.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    t.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    t.contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    t.costUsd = round(t.costUsd + (meta?.cost_usd ?? 0), 4);
    this.changed();
  }

  plan(costUsd: number | undefined) {
    this.usage.planner.calls += 1;
    this.usage.planner.costUsd = round(this.usage.planner.costUsd + (costUsd ?? 0), 4);
    this.changed();
  }

  image(backendKey: string, backendName: string) {
    this.usage.images.count += 1;
    this.usage.images.backend = backendName;
    this.usage.images.costUsd = round(this.usage.images.costUsd + (PRICES.image[backendKey] ?? 0), 4);
    this.changed();
  }

  tts(chars: number, provider = "deepgram") {
    this.usage.voice.ttsChars += chars;
    this.usage.voice.provider = provider;
    this.recomputeVoice();
  }

  stt(seconds: number, provider = "deepgram") {
    this.usage.voice.sttSeconds = round(this.usage.voice.sttSeconds + seconds, 2);
    this.usage.voice.provider = provider;
    this.recomputeVoice();
  }

  private recomputeVoice() {
    const v = this.usage.voice;
    v.costUsd = round((v.ttsChars / 1000) * PRICES.deepgramTtsPer1kChars + (v.sttSeconds / 60) * PRICES.deepgramSttPerMinute, 4);
    this.changed();
  }
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Voice calls arrive outside any lesson socket; they are charged to the lesson most recently active. */
let active: UsageMeter | null = null;
export const setActiveMeter = (m: UsageMeter | null) => (active = m);
export const activeMeter = () => active;
