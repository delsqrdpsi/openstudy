import { tmpdir } from "node:os";
import { log } from "../log";
import { CodexAppServer } from "./codexAppServer";
import { sanitizeModel, type ModelChoice } from "./index";

let cached: Promise<ModelChoice[]> | null = null;

/**
 * The models the signed-in ChatGPT plan can use, as Codex lists them. Asked
 * once per server start: the list moves with Codex releases, so it is never
 * hard-coded here.
 */
export function codexModels(): Promise<ModelChoice[]> {
  cached ??= load().catch((e) => {
    log.warn("codex model list unavailable:", e instanceof Error ? e.message : e);
    cached = null;
    const env = sanitizeModel(process.env.TUTOR_MODEL);
    return env ? [{ id: env, label: env, default: true }] : [{ id: "", label: "Codex default", default: true }];
  });
  return cached;
}

async function load(): Promise<ModelChoice[]> {
  const server = new CodexAppServer({ cwd: tmpdir() });
  try {
    const r = await server.call<{ data: { id: string; displayName: string; description: string; hidden: boolean; isDefault: boolean }[] }>("model/list", {});
    const preferred = sanitizeModel(process.env.TUTOR_MODEL);
    const shown = r.data.filter((m) => !m.hidden);
    return shown.map((m) => ({
      id: m.id,
      label: `${m.displayName} (${m.description.replace(/\.$/, "")})`,
      default: preferred ? m.id === preferred : m.isDefault,
    }));
  } finally {
    server.close();
  }
}
