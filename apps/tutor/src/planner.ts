import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LESSON_PLAN_JSON_SCHEMA, LessonPlanSchema, type LessonPlan } from "@openstudy/shared";
import { log } from "./log";

/**
 * One slow, careful call that turns the intake into a lesson plan. Runs on a
 * stronger model than the live tutor (Fable by default) through the same
 * headless CLI, with structured output so the result always parses.
 */
export async function planLesson(input: {
  topic: string;
  materials: { name: string; text: string }[];
  intake?: { role: "tutor" | "student"; text: string }[];
  imagesEnabled: boolean;
  model?: string;
  signal?: AbortSignal;
}): Promise<{ plan: LessonPlan; costUsd: number }> {
  const model = input.model ?? process.env.PLANNER_MODEL ?? "fable";
  const system = `You are a master teacher planning a one-on-one whiteboard lesson. You will not teach it; a live tutor will, following your plan section by section. Be concrete and specific to this student. Prefer fewer, deeper sections (3 to 6). Each section: one clear goal, two to five key points in the order to teach them, one vivid example or analogy, one real check question that tests understanding (with 2 to 4 short options when it works as multiple choice), and the misconceptions to watch for.${
    input.imagesEnabled
      ? " For each section, suggest zero to two pictures a pencil-sketch model could draw: concrete, visual, under 30 words, with snake_case ids."
      : " Leave images empty."
  } Section ids are snake_case. Respond only with the JSON object.`;
  // Up to 30k characters per file and 150k in all: enough to plan from, small enough to stay fast.
  let budget = 150_000;
  const mats = input.materials.length
    ? "\n\nMaterials the student attached (source of truth):\n" +
      input.materials
        .map((m) => {
          const text = m.text.slice(0, Math.min(30000, Math.max(0, budget)));
          budget -= text.length;
          return `--- ${m.name} ---\n${text}`;
        })
        .join("\n\n")
    : "";
  const intake = (input.intake ?? []).map((t) => `${t.role === "tutor" ? "Tutor" : "Student"}: ${t.text}`).join("\n");
  const user = `Topic the student typed: "${input.topic}"${mats}${intake ? `\n\nIntake conversation:\n${intake}` : ""}\n\nWrite the lesson plan.`;

  const args = [
    "-p",
    "--output-format", "json",
    "--strict-mcp-config",
    "--tools", "",
    "--no-session-persistence",
    "--model", model,
    "--system-prompt-file", "system.md",
    "--json-schema", JSON.stringify(LESSON_PLAN_JSON_SCHEMA),
  ];
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.CLAUDECODE;
  const cwd = mkdtempSync(join(tmpdir(), "openstudy-plan-"));
  // System prompt in a file and the request on stdin: no argv size limit, no option parsing of student text.
  writeFileSync(join(cwd, "system.md"), system);
  const t0 = Date.now();

  let out: string;
  try {
    out = await new Promise<string>((resolve, reject) => {
      if (input.signal?.aborted) return reject(new Error("planner cancelled"));
      const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.stdin.on("error", () => {});
      child.stdin.end(user);
      input.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr.trim().split("\n").at(-1) || `planner exited ${code}`))));
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  const result = JSON.parse(out) as { is_error?: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number };
  if (result.is_error) throw new Error(String(result.result));
  const raw = result.structured_output ?? tryJson(result.result ?? "");
  const plan = LessonPlanSchema.parse(raw);
  log.info(`plan ready in ${((Date.now() - t0) / 1000).toFixed(1)}s on ${model}: ${plan.sections.length} sections, cost ${result.total_cost_usd}`);
  return { plan, costUsd: result.total_cost_usd ?? 0 };
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
