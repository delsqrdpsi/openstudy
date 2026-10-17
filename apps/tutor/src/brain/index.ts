import type { Brain } from "./types";
import { ClaudeCodeBrain } from "./claudeCode";

export type { Brain, TurnInput, TurnResult } from "./types";

/**
 * BRAIN=claude-code (default): the Claude Code CLI on your subscription.
 * More adapters (Claude API key, Ollama) plug in here.
 */
export function createBrain(opts: { model?: string; session?: string | null } = {}): Brain {
  const kind = process.env.BRAIN ?? "claude-code";
  const model = opts.model ?? process.env.TUTOR_MODEL ?? "sonnet";
  switch (kind) {
    case "claude-code":
      return new ClaudeCodeBrain(model, opts.session ?? null);
    default:
      throw new Error(`unknown BRAIN "${kind}"`);
  }
}
