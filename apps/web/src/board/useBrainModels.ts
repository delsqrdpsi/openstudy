"use client";
import { useEffect, useState } from "react";
import { TUTOR_HTTP } from "./useLiveSession";

export interface ModelChoice {
  id: string;
  label: string;
  description?: string;
  default?: boolean;
}

/** Used until the tutor server answers, and if it never does. */
const FALLBACK: ModelChoice[] = [
  { id: "sonnet", label: "Sonnet (fast)", default: true },
  { id: "opus", label: "Opus (deeper)" },
  { id: "fable", label: "Fable (deepest, slow)" },
];

/** The models the tutor server's brain offers (Claude or Codex), asked once per page. */
export function useBrainModels(): { brain: string | null; models: ModelChoice[] } {
  const [state, setState] = useState<{ brain: string | null; models: ModelChoice[] }>({ brain: null, models: FALLBACK });
  useEffect(() => {
    let live = true;
    fetch(`${TUTOR_HTTP}/models`)
      .then((r) => r.json())
      .then((j: { brain: string; models: ModelChoice[] }) => {
        if (live && j.models?.length) setState({ brain: j.brain, models: j.models });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return state;
}
