import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importFigure, type FigureMeta } from "./index";
import { log } from "../log";

/**
 * Builds a new figure in the background by running the Anatomy skill through
 * the claude CLI. A Figure-sized build takes the skill tens of minutes; the
 * job reports when it lands and the caller adds it to the board then.
 */
export interface BuildJob {
  id: string;
  name: string;
  concept: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  error?: string;
  figure?: FigureMeta;
}

const jobs = new Map<string, BuildJob>();
export const listJobs = () => [...jobs.values()];
export const getJob = (id: string) => jobs.get(id) ?? null;

export function startBuild(opts: { name: string; concept: string; onDone?: (job: BuildJob) => void }): BuildJob {
  const name = opts.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "figure";
  const job: BuildJob = { id: `${name}-${Date.now().toString(36)}`, name, concept: opts.concept, status: "running", startedAt: Date.now() };
  jobs.set(job.id, job);
  const cwd = mkdtempSync(join(tmpdir(), "openstudy-figure-"));
  const model = process.env.FIGURE_MODEL ?? "opus";
  const prompt =
    `/anatomy Build a Figure (40 to 80 parts, no WebGL, no 3D mode) that explains: ${opts.concept}. ` +
    `It is for a student's whiteboard, so keep the card compact and the motion calm. Write a framework-free Node build script in ./${name}/build.mjs that imports the kit from the skill folder, ` +
    `build the LIGHT theme page as ./${name}/${name}-light.html, run the audit and line checks, and stop when the page exists. Do not publish anything.`;
  const args = ["-p", prompt, "--output-format", "json", "--model", model, "--permission-mode", "acceptEdits", "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep,Skill", "--max-budget-usd", process.env.FIGURE_BUDGET_USD ?? "6"];
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.CLAUDECODE;
  log.info("figure build started", job.id, "in", cwd);
  const child = spawn(process.env.CLAUDE_BIN ?? "claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", () => {});
  const timer = setTimeout(() => child.kill("SIGTERM"), Number(process.env.FIGURE_TIMEOUT_MS ?? 90 * 60 * 1000));
  child.on("close", (code) => {
    clearTimeout(timer);
    job.finishedAt = Date.now();
    const page = findLargestHtml(cwd);
    if (!page) {
      job.status = "failed";
      job.error = code === 0 ? "the skill produced no page" : stderr.trim().split("\n").at(-1) || `claude exited ${code}`;
      log.warn("figure build failed", job.id, job.error);
    } else {
      try {
        job.figure = importFigure(readFileSync(page, "utf8"), {
          name,
          title: opts.concept.slice(0, 60),
          description: opts.concept,
          tags: ["built"],
          source: "Built with the Anatomy skill",
        });
        job.status = "done";
        log.info("figure build done", job.id, `${((job.finishedAt - job.startedAt) / 60000).toFixed(1)} min`);
      } catch (e) {
        job.status = "failed";
        job.error = e instanceof Error ? e.message : String(e);
      }
    }
    opts.onDone?.(job);
  });
  return job;
}

function findLargestHtml(root: string): string | null {
  let best: { p: string; size: number } | null = null;
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      const st = statSync(p);
      if (st.isDirectory() && f !== "node_modules") walk(p, depth + 1);
      else if (st.isFile() && f.endsWith("-light.html") && (!best || st.size > best.size)) best = { p, size: st.size };
    }
  };
  walk(root, 0);
  return best ? (best as { p: string }).p : null;
}
