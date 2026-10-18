"use client";
import { useEffect, useRef, useState } from "react";
import type { Usage } from "@openstudy/shared";

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const fmtUsd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);

/**
 * A small ring in the toolbar showing how full the tutor's context is.
 * Click for the lesson's running usage: tokens, pictures, speech, cost.
 */
export function UsageBadge({ usage, contextWindow = 200_000 }: { usage: Usage | null; contextWindow?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const ctx = usage?.tutor.contextTokens ?? 0;
  const frac = Math.min(1, ctx / contextWindow);
  const r = 6.5;
  const c = 2 * Math.PI * r;
  const voiceFree = !usage?.voice.provider;

  return (
    <div ref={ref} className="relative">
      <button
        className="ui-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Lesson usage"
        title={usage ? `Context ${fmtTokens(ctx)} tokens · ${fmtUsd(usage.totalUsd)} so far` : "Lesson usage"}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(31,42,55,0.15)" strokeWidth="2.5" />
          <circle
            cx="9"
            cy="9"
            r={r}
            fill="none"
            stroke={frac > 0.8 ? "var(--coral)" : "var(--teal)"}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${c * frac} ${c}`}
            transform="rotate(-90 9 9)"
            style={{ transition: "stroke-dasharray 400ms" }}
          />
        </svg>
      </button>
      {open && (
        <div className="ui-card absolute bottom-11 left-0 z-30 w-72 p-3 text-[12px] text-neutral-700" role="dialog" aria-label="Lesson usage details">
          {!usage ? (
            <div className="text-neutral-500">Nothing used yet.</div>
          ) : (
            <>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-semibold text-[var(--ink)]">This lesson so far</span>
                <span className="text-[14px] font-semibold text-[var(--ink)]">{fmtUsd(usage.totalUsd)}</span>
              </div>
              <Row label="Context in use" value={`${fmtTokens(ctx)} / ${fmtTokens(contextWindow)} tokens`} />
              <Section title="Tutor" cost={usage.tutor.costUsd}>
                <Row label="Turns" value={String(usage.tutor.turns)} />
                <Row label="Tokens in / out" value={`${fmtTokens(usage.tutor.inputTokens + usage.tutor.cacheReadTokens + usage.tutor.cacheWriteTokens)} / ${fmtTokens(usage.tutor.outputTokens)}`} />
                <Row label="From cache" value={fmtTokens(usage.tutor.cacheReadTokens)} dim />
              </Section>
              <Section title="Planner" cost={usage.planner.costUsd}>
                <Row label="Calls" value={String(usage.planner.calls)} />
              </Section>
              <Section title="Pictures" cost={usage.images.costUsd}>
                <Row label="Generated" value={usage.images.count ? `${usage.images.count}${usage.images.backend ? ` · ${usage.images.backend}` : ""}` : "none"} />
              </Section>
              <Section title="Speech" cost={voiceFree ? 0 : usage.voice.costUsd}>
                {voiceFree ? (
                  <Row label="Browser voice" value="free" dim />
                ) : (
                  <>
                    <Row label="Heard (speech to text)" value={fmtSec(usage.voice.sttSeconds)} />
                    <Row label="Spoken (text to speech)" value={`${fmtTokens(usage.voice.ttsChars)} chars`} />
                  </>
                )}
              </Section>
              <div className="mt-2 border-t border-neutral-100 pt-2 text-[11px] leading-snug text-neutral-400">
                {usage.subscription ? "Model costs are list-price estimates; on your subscription they are not billed. " : ""}
                Picture and speech prices are estimates.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, cost, children }: { title: string; cost: number; children: React.ReactNode }) {
  return (
    <div className="mt-2 border-t border-neutral-100 pt-2">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-[var(--ink)]">{title}</span>
        <span className="tabular-nums text-neutral-500">{cost ? fmtUsd(cost) : "$0.00"}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between ${dim ? "text-neutral-400" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
