import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getFigure, importFigure, type FigureMeta } from "./index";
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

/**
 * Builds need the Anatomy skill installed for the claude CLI
 * (npx skills add wheresryan22/anatomy -g -a claude-code). Without it a build
 * can only fail, so the tutor is not offered builds at all.
 */
export function anatomyInstalled(): boolean {
  const dirs = [process.env.ANATOMY_SKILL_DIR, join(homedir(), ".claude", "skills", "anatomy"), join(homedir(), ".agents", "skills", "anatomy")];
  return dirs.some((d) => !!d && existsSync(join(d, "SKILL.md")));
}

const jobs = new Map<string, BuildJob>();
export const listJobs = () => [...jobs.values()];
export const getJob = (id: string) => jobs.get(id) ?? null;

export function startBuild(opts: { name: string; concept: string; onDone?: (job: BuildJob) => void }): BuildJob {
  let name = opts.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "figure";
  // Never overwrite a figure that is already in the library.
  if (getFigure(name)) name = `${name.slice(0, 34)}-${Date.now().toString(36).slice(-5)}`;
  const job: BuildJob = { id: `${name}-${Date.now().toString(36)}`, name, concept: opts.concept, status: "running", startedAt: Date.now() };
  jobs.set(job.id, job);
  const cwd = mkdtempSync(join(tmpdir(), "openstudy-figure-"));
  const model = process.env.FIGURE_MODEL ?? "opus";
  const prompt =
    // The concept is plain words (cleaned upstream and approved by the student); it is quoted as data, not instructions.
    `/anatomy Build a Figure (40 to 80 parts, no WebGL, no 3D mode) of the real object described here: "${opts.concept.replace(/"/g, "'")}". ` +
    `Draw that actual object as it is really built, its real parts in their real places, each part labelled; do not invent a different object as a metaphor for it. ` +
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
  let finished = false;
  child.on("close", (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    job.finishedAt = Date.now();
    const page = findLargestHtml(cwd);
    if (!page) {
      job.status = "failed";
      job.error = code === 0 ? "the skill produced no page" : stderr.trim().split("\n").at(-1) || `claude exited ${code}`;
      log.warn("figure build failed", job.id, job.error);
    } else {
      try {
        const html = readFileSync(page, "utf8");
        const pageTitle = /<title>([^<]{2,80})<\/title>/.exec(html)?.[1]?.trim();
        job.figure = importFigure(html, {
          name,
          title: pageTitle && !pageTitle.includes("${") ? pageTitle : opts.concept.slice(0, 60),
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
    // The page has been copied into the library; the scratch folder is not needed any more.
    rmSync(cwd, { recursive: true, force: true });
    opts.onDone?.(job);
  });
  child.on("error", (e) => {
    // 'close' may not follow a failed spawn; the job must still end.
    log.warn("figure build could not start", job.id, e.message);
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    job.status = "failed";
    job.error = `could not start claude: ${e.message}`;
    job.finishedAt = Date.now();
    rmSync(cwd, { recursive: true, force: true });
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
