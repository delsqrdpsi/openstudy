import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LESSON_PLAN_JSON_SCHEMA, LessonPlanSchema, type LessonPlan } from "@openstudy/shared";
import { log } from "./log";
import { brainKind, sanitizeModel } from "./brain";
import { CodexAppServer, TUTOR_THREAD_CONFIG } from "./brain/codexAppServer";
import { runTurn } from "./brain/codex";
import { nullsToUndefined, strictJsonSchema } from "./brain/strictSchema";

/**
 * One slow, careful call that turns the intake into a lesson plan. Runs on a
 * stronger model than the live tutor (Fable by default) through the same
 * headless CLI, with structured output so the result always parses. With
 * BRAIN=codex it runs on Codex instead, at high reasoning effort.
 */
export async function planLesson(input: {
  topic: string;
  materials: { name: string; text: string }[];
  intake?: { role: "tutor" | "student"; text: string }[];
  imagesEnabled: boolean;
  figures?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<{ plan: LessonPlan; costUsd: number }> {
  const codex = brainKind() === "codex";
  const model = sanitizeModel(input.model ?? process.env.PLANNER_MODEL) ?? (codex ? "" : "fable");
  const system = `You are a master teacher planning a one-on-one whiteboard lesson. You will not teach it; a live tutor will, following your plan section by section. Be concrete and specific to this student. Prefer fewer, deeper sections (3 to 6). Each section: one clear goal, two to five key points in the order to teach them, one vivid example or analogy, one real check question that tests understanding (with 2 to 4 short options when it works as multiple choice), and the misconceptions to watch for.${
    input.imagesEnabled
      ? " For each section, suggest zero to two pictures a pencil-sketch model could draw: concrete, visual, under 30 words, with snake_case ids."
      : " Leave images empty."
  } Section ids are snake_case.${
    input.figures ? ` These interactive models exist and the tutor can show them; mention a fitting one by name in a section's example field as "model: <name>":\n${input.figures}` : ""
  } Respond only with the JSON object.`;
  const mats = input.materials.length
    ? "\n\nMaterials the student attached (source of truth):\n" + input.materials.map((m) => `--- ${m.name} ---\n${m.text.slice(0, 30000)}`).join("\n\n")
    : "";
  const intake = (input.intake ?? []).map((t) => `${t.role === "tutor" ? "Tutor" : "Student"}: ${t.text}`).join("\n");
  const user = `Topic the student typed: "${input.topic}"${mats}${intake ? `\n\nIntake conversation:\n${intake}` : ""}\n\nWrite the lesson plan.`;
  if (codex) return planWithCodex(system, user, model, input.signal);

  const args = [
    "-p",
    "--output-format", "json",
    "--strict-mcp-config",
    "--tools", "",
    "--no-session-persistence",
    "--model", model,
    "--system-prompt", system,
    "--json-schema", JSON.stringify(LESSON_PLAN_JSON_SCHEMA),
    user,
  ];
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.CLAUDECODE;
  const cwd = mkdtempSync(join(tmpdir(), "openstudy-plan-"));
  const t0 = Date.now();

  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    input.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr.trim().split("\n").at(-1) || `planner exited ${code}`))));
  });

  const result = JSON.parse(out) as { is_error?: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number };
  if (result.is_error) throw new Error(String(result.result));
  const raw = result.structured_output ?? tryJson(result.result ?? "");
  const plan = LessonPlanSchema.parse(raw);
  log.info(`plan ready in ${((Date.now() - t0) / 1000).toFixed(1)}s on ${model}: ${plan.sections.length} sections, cost ${result.total_cost_usd}`);
  return { plan, costUsd: result.total_cost_usd ?? 0 };
}

/** Codex has no one-shot flag that streams nothing; an ephemeral thread with an output schema does the same job. */
async function planWithCodex(system: string, user: string, model: string, signal?: AbortSignal): Promise<{ plan: LessonPlan; costUsd: number }> {
  const cwd = mkdtempSync(join(tmpdir(), "openstudy-plan-"));
  const server = new CodexAppServer({ cwd });
  const t0 = Date.now();
  try {
    const t = await server.call<{ thread: { id: string } }>("thread/start", {
      ...(model ? { model } : {}),
      cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
      baseInstructions: system,
      config: TUTOR_THREAD_CONFIG,
      ephemeral: true,
    });
    const r = await runTurn(server, t.thread.id, user, {
      model: model || undefined,
      effort: process.env.PLANNER_EFFORT ?? "high",
      outputSchema: strictJsonSchema(LESSON_PLAN_JSON_SCHEMA),
      signal,
    });
    if (r.status !== "ok") throw new Error(r.message ?? `planner turn ${r.status}`);
    const plan = LessonPlanSchema.parse(nullsToUndefined(tryJson(r.text)));
    log.info(`plan ready in ${((Date.now() - t0) / 1000).toFixed(1)}s on codex ${model || "(default model)"}: ${plan.sections.length} sections`);
    return { plan, costUsd: 0 };
  } finally {
    server.close();
  }
}

function tryJson(s: string): unknown {
  const m = s.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

/** The plan as the tutor sees it, inside its next user turn. */
export function planForTutor(plan: LessonPlan): string {
  const sections = plan.sections
    .map(
      (s, i) =>
        `${i + 1}. [${s.id}] ${s.title}\n   goal: ${s.goal}\n   key points: ${s.keyPoints.join(" | ")}` +
        (s.example ? `\n   example: ${s.example}` : "") +
        `\n   check: ${s.checkQuestion}` +
        (s.checkOptions?.length ? ` options: ${s.checkOptions.join(" | ")}` : "") +
        (s.pitfalls?.length ? `\n   pitfalls: ${s.pitfalls.join(" | ")}` : "") +
        (s.images.length ? `\n   pictures ready to use: ${s.images.map((im) => `@image id=${im.id} prompt="${im.prompt.replace(/"/g, "'")}"`).join(" ; ")}` : ""),
    )
    .join("\n");
  return `[Lesson plan from the planner. Title: "${plan.title}". Student: ${plan.student}\n${sections}\n\nFollow this plan section by section. Use the exact section titles with @section and the listed picture ids with @image (they are already drawn and will appear instantly). Now: write the plan as a numbered block (id=plan, col 0), say what you will start with, and teach section 1.]`;
}
