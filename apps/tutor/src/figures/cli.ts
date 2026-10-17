/**
 * pnpm figures:seed                      copy the Anatomy skill's examples into figures/
 * pnpm figures:import <html> <name> <title> <description>
 */
import { readFileSync } from "node:fs";
import { importFigure, seedFromSkill, listFigures } from "./index";

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "seed") {
  const added = seedFromSkill();
  console.log(added.length ? `added: ${added.join(", ")}` : "nothing to add (is the anatomy skill installed under ~/.claude/skills?)");
} else if (cmd === "import") {
  const [html, name, title, description] = rest;
  if (!html || !name) {
    console.log("usage: figures:import <html> <name> [title] [description]");
    process.exit(1);
  }
  const m = importFigure(readFileSync(html, "utf8"), { name, title: title ?? name, description: description ?? "", tags: [] });
  console.log("imported", m.name);
} else {
  console.log(listFigures().map((f) => `${f.name}: ${f.title}`).join("\n") || "no figures");
}
