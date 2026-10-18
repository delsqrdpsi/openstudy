import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

/**
 * The figure library: self-contained interactive pages (Anatomy figures)
 * the tutor can place on the board. Lives in <repo>/figures, one folder per
 * figure, served by the tutor server under /figures/<name>/.
 */
export const FigureMetaSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  source: z.string().optional(),
  height: z.number().int().positive().default(420),
});
export type FigureMeta = z.infer<typeof FigureMetaSchema>;

export const FIGURES_DIR = process.env.FIGURES_DIR ?? resolve(process.cwd(), "../../figures");

export function listFigures(dir = FIGURES_DIR): FigureMeta[] {
  if (!existsSync(dir)) return [];
  const out: FigureMeta[] = [];
  for (const name of readdirSync(dir)) {
    const meta = join(dir, name, "figure.json");
    const page = join(dir, name, "index.html");
    if (!existsSync(meta) || !existsSync(page)) continue;
    try {
      const parsed = FigureMetaSchema.safeParse(JSON.parse(readFileSync(meta, "utf8")));
      if (parsed.success) out.push({ ...parsed.data, name });
    } catch {
      /* skip broken folder */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getFigure(name: string, dir = FIGURES_DIR): FigureMeta | null {
  return listFigures(dir).find((f) => f.name === name) ?? null;
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

/**
 * Added to every figure page as it is served: the page tells the board how
 * tall its content is, so the frame on the board can fit it instead of
 * clipping. Figures are responsive pages whose height depends on the width
 * they are given, so only the page itself knows.
 */
const SIZE_REPORTER = `<script>(function(){
  if (window.parent === window) return;
  var last = 0, sent = 0;
  function measure(){
    var d = document.documentElement, b = document.body;
    var h = Math.max(d.scrollHeight, d.offsetHeight, b ? b.scrollHeight : 0, b ? b.offsetHeight : 0);
    // Absolutely or fixed positioned content does not count toward scrollHeight: take the lowest element edge too.
    var els = document.querySelectorAll("body *"), max = 0, y = window.scrollY || 0;
    for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.bottom > max) max = r.bottom; }
    return Math.ceil(Math.max(h, max + y));
  }
  function report(){
    var h = measure();
    if (!h || (h === last && sent > 2)) return;
    last = h; sent++;
    window.parent.postMessage({ type: "openstudy:figure-size", height: h }, "*");
  }
  try { new ResizeObserver(report).observe(document.documentElement); if (document.body) new ResizeObserver(report).observe(document.body); } catch (e) {}
  window.addEventListener("load", report);
  [50, 300, 1000, 2500, 5000].forEach(function(ms){ setTimeout(report, ms); });
})();</script>`;

/** Serve a file from a figure folder. Returns null for anything outside it. */
export function readFigureFile(name: string, file: string, dir = FIGURES_DIR): { bytes: Buffer; type: string } | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || file.includes("..") || file.includes("\0")) return null;
  const p = join(dir, name, file || "index.html");
  if (!existsSync(p) || !statSync(p).isFile()) return null;
  const type = TYPES[extname(p)] ?? "application/octet-stream";
  if (extname(p) !== ".html") return { bytes: readFileSync(p), type };
  const html = readFileSync(p, "utf8");
  const at = html.lastIndexOf("</body>");
  const withReporter = at === -1 ? html + SIZE_REPORTER : html.slice(0, at) + SIZE_REPORTER + html.slice(at);
  return { bytes: Buffer.from(withReporter, "utf8"), type };
}

/** Add a built page to the library. */
export function importFigure(html: string, meta: Omit<FigureMeta, "height"> & { height?: number }, dir = FIGURES_DIR): FigureMeta {
  const m = FigureMetaSchema.parse(meta);
  const folder = join(dir, m.name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "index.html"), html);
  writeFileSync(join(folder, "figure.json"), JSON.stringify(m, null, 2) + "\n");
  return m;
}

/** Copy the Anatomy skill's shipped examples into the library (light theme). */
export function seedFromSkill(dir = FIGURES_DIR): string[] {
  const skillDir = process.env.ANATOMY_SKILL_DIR ?? join(homedir(), ".claude", "skills", "anatomy", "examples");
  if (!existsSync(skillDir)) return [];
  const added: string[] = [];
  const blurbs: Record<string, [string, string[]]> = {
    "arcade-cabinet": ["An upright arcade cabinet with its side off: coin chute, switch, cable to the board, CRT attract mode, joystick microswitch. Shows a complete electromechanical system and signal paths.", ["electronics", "mechanics", "systems"]],
    "raptor-engine": ["A rocket engine in a test stand that comes apart into assemblies: turbopumps, injector, chamber, nozzle, plumbing. Shows propulsion, pipework, assemblies.", ["engineering", "propulsion", "physics"]],
    "ripple-tank": ["A ripple tank with two sources: interference, wavelength, diffraction through a gap. Shows wave physics.", ["physics", "waves"]],
    "spot-plate": ["A chemistry spot plate with droppers and colour changes. Shows reactions and indicators.", ["chemistry"]],
    "test-rig": ["A materials test rig that loads a sample until it fails, with a live force readout. Shows stress, strain and failure.", ["engineering", "physics", "materials"]],
    "turning-dial": ["A dial that turns in true 3D. Shows rotation, angle and readouts.", ["mechanics", "3d"]],
    "dial-indicator": ["A mechanical dial gauge: plunger, rack, pinion, needle. Shows gears and mechanical amplification.", ["mechanics", "gears", "measurement"]],
    "desk-computer": ["A desktop computer with the side panel off. Shows the parts of a PC.", ["computers", "hardware"]],
  };
  for (const name of readdirSync(skillDir)) {
    const page = join(skillDir, name, `${name}-light.html`);
    if (!existsSync(page) || existsSync(join(dir, name, "index.html"))) continue;
    const [description, tags] = blurbs[name] ?? [`Anatomy example: ${name}`, []];
    mkdirSync(join(dir, name), { recursive: true });
    copyFileSync(page, join(dir, name, "index.html"));
    writeFileSync(
      join(dir, name, "figure.json"),
      JSON.stringify({ name, title: name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()), description, tags, source: "Anatomy example by wheresryan22, MIT", height: 420 }, null, 2) + "\n",
    );
    added.push(name);
  }
  return added;
}

/** The library as the tutor and planner see it. */
export function figuresForPrompt(figs = listFigures()): string {
  if (!figs.length) return "";
  return figs.map((f) => `- ${f.name}: ${f.title}. ${f.description}`).join("\n");
}
