import type { Brain } from "./types";
import { ClaudeCodeBrain } from "./claudeCode";
import { CodexBrain } from "./codex";
import { codexModels } from "./codexModels";

export type { Brain, TurnInput, TurnResult } from "./types";

export type BrainKind = "claude-code" | "codex";

export const brainKind = (): BrainKind => {
  const kind = process.env.BRAIN ?? "claude-code";
  if (kind !== "claude-code" && kind !== "codex") throw new Error(`unknown BRAIN "${kind}"`);
  return kind;
};

/**
 * BRAIN=claude-code (default): the Claude Code CLI on your Claude plan.
 * BRAIN=codex: the Codex CLI on your ChatGPT plan.
 * More adapters (Claude API key, Ollama) plug in here.
 */
export function createBrain(opts: { model?: string; session?: string | null } = {}): Brain {
  const kind = brainKind();
  const model = sanitizeModel(opts.model) ?? sanitizeModel(process.env.TUTOR_MODEL) ?? (kind === "codex" ? "" : "sonnet");
  switch (kind) {
    case "claude-code":
      return new ClaudeCodeBrain(model, opts.session ?? null);
    case "codex":
      return new CodexBrain(model, opts.session ?? null);
  }
}

const CLAUDE_MODEL = /^(sonnet|opus|haiku|fable)|^claude-/i;
const OPENAI_MODEL = /^(gpt-|o\d|codex-)/i;

/**
 * A model name only means something to the brain it was written for: a
 * board saved under Claude reopened under Codex still says "sonnet", and an
 * .env copied from the example still says PLANNER_MODEL=fable. Names for the
 * other brain are dropped so its default is used instead.
 */
export function sanitizeModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const foreign = brainKind() === "codex" ? CLAUDE_MODEL : OPENAI_MODEL;
  return foreign.test(model) ? undefined : model;
}

export interface ModelChoice {
  id: string;
  label: string;
  default?: boolean;
}

/** What the home page and the lesson's model menu offer for the configured brain. */
export async function brainModels(): Promise<ModelChoice[]> {
  if (brainKind() === "codex") return codexModels();
  const preferred = sanitizeModel(process.env.TUTOR_MODEL) ?? "sonnet";
  return [
    { id: "sonnet", label: "Sonnet (fast)" },
    { id: "opus", label: "Opus (deeper)" },
    { id: "fable", label: "Fable (deepest, slow)" },
  ].map((m) => ({ ...m, default: m.id === preferred }));
}
