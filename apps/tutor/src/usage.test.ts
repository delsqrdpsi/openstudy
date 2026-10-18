import { describe, expect, it } from "vitest";
import { UsageMeter } from "./usage";

describe("usage meter", () => {
  it("adds only the increase of the CLI's running session cost", () => {
    const m = new UsageMeter();
    // Real CLI totals over three resumed turns.
    m.turn({ session: "a", cost_usd: 0.00030026, usage: { input_tokens: 2, output_tokens: 3 } });
    m.turn({ session: "a", cost_usd: 0.00051734, usage: { input_tokens: 2, output_tokens: 3 } });
    m.turn({ session: "a", cost_usd: 0.00056916, usage: { input_tokens: 2, output_tokens: 3 } });
    expect(m.usage.tutor.costUsd).toBeCloseTo(0.00056916, 6);
    expect(m.usage.tutor.turns).toBe(3);
    expect(m.usage.tutor.outputTokens).toBe(9);
  });

  it("starts a new session's totals from zero", () => {
    const m = new UsageMeter();
    m.turn({ session: "a", cost_usd: 0.5 });
    m.turn({ session: "b", cost_usd: 0.25 });
    expect(m.usage.tutor.costUsd).toBeCloseTo(0.75, 6);
  });

  it("ignores a turn with nothing reported", () => {
    const m = new UsageMeter();
    m.turn({ session: "a", cost_usd: 0.1, usage: { input_tokens: 100, cache_read_input_tokens: 900 } });
    m.turn(undefined);
    expect(m.usage.tutor.turns).toBe(1);
    expect(m.usage.tutor.contextTokens).toBe(1000);
  });
});
