/**
 * A brain is anything that can continue a conversation and stream text back.
 * The tutor server owns the transcript semantics; the brain only has to keep
 * its own continuity between turns (a resumable session, a message list, ...).
 */
export interface TurnInput {
  system: string;
  userText: string;
  signal: AbortSignal;
  onText: (delta: string) => void;
}

export interface TurnResult {
  /** "aborted" when the student interrupted; "error" carries a message. */
  status: "ok" | "aborted" | "error";
  message?: string;
  /** Whatever the brain wants to report (cost, tokens). */
  meta?: Record<string, unknown>;
}

export interface Brain {
  readonly name: string;
  readonly model: string;
  turn(input: TurnInput): Promise<TurnResult>;
  close(): void;
}
