#!/usr/bin/env node
/**
 * install-extras.mjs — install or update the shared Claude Code skills, agent and
 * command into ~/.claude, on any OS.
 *
 *   node extras/install-extras.mjs --groups core,research [--mimesis <path>] [--dry]
 *
 * Groups:
 *   core      master-context, swarm, the web-researcher agent
 *   research  paper and statistics skills (paper-library, paper-structure, ...)
 *   voice     the mimesis skill and /voice command; needs --mimesis <Mimesis folder>,
 *             because the skill ships with the engine and updates with it
 *
 * Only the names listed here are touched. An existing copy that differs is moved to
 * ~/.claude/backups/extras-<time>/ first, so a local edit is never lost. Re-running
 * is safe and is how an update is applied.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE = path.join(os.homedir(), ".claude");
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes("--dry");
const GROUPS = new Set((flag("groups") || "core,research").split(",").map(s => s.trim()).filter(Boolean));
const MIMESIS = flag("mimesis");
const BACKUP = path.join(CLAUDE, "backups", `extras-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);

const SETS = {
  core: { skills: ["master-context", "swarm"], agents: ["web-researcher.md"] },
  research: {
    skills: [
      "paper-library", "openalex-database", "paper-claim-audit", "paper-forge", "paper-structure",
      "statistical-analysis", "degenerate-input-filtering", "nan-safe-correlation",
      "statistical-significance-annotation", "general-figure-guide", "shap-model-explainability",
      "eval-methodology-playbook", "scientific-slides", "latex-research-posters",
    ],
  },
};
for (const g of GROUPS) if (!SETS[g] && g !== "voice") { console.error(`! unknown group "${g}" (core, research, voice)`); process.exit(1); }

const read = (p) => { try { return fs.readFileSync(p); } catch { return null; } };
function sameTree(a, b) {
  if (!fs.existsSync(b)) return false;
  const sa = fs.statSync(a), sb = fs.statSync(b);
  if (sa.isDirectory() !== sb.isDirectory()) return false;
  if (!sa.isDirectory()) return Buffer.compare(read(a), read(b)) === 0;
  const ea = fs.readdirSync(a).filter(f => f !== "__pycache__").sort();
  const eb = fs.readdirSync(b).filter(f => f !== "__pycache__").sort();
  return ea.join("\n") === eb.join("\n") && ea.every(f => sameTree(path.join(a, f), path.join(b, f)));
}

let installed = 0, current = 0, backedUp = 0;
function place(src, dst, label, transform) {
  if (!fs.existsSync(src)) { console.error(`  ! missing in bundle: ${src}`); process.exitCode = 1; return; }
  let staged = src;
  if (transform) {
    staged = path.join(os.tmpdir(), `extras-${process.pid}-${path.basename(src)}`);
    fs.writeFileSync(staged, transform(fs.readFileSync(src, "utf8")));
  }
  if (sameTree(staged, dst)) { current++; console.log(`  = ${label}`); return; }
  const had = fs.existsSync(dst);
  console.log(`  ${had ? "~" : "+"} ${label}${had ? " (old copy backed up)" : ""}`);
  if (!DRY) {
    if (had) {
      const bk = path.join(BACKUP, path.relative(CLAUDE, dst));
      fs.mkdirSync(path.dirname(bk), { recursive: true });
      fs.cpSync(dst, bk, { recursive: true });
      fs.rmSync(dst, { recursive: true, force: true });
      backedUp++;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(staged, dst, { recursive: true });
  }
  if (transform) fs.rmSync(staged, { force: true });
  installed++;
}

for (const g of GROUPS) {
  if (g === "voice") continue;
  console.log(`\n${g}`);
  for (const s of SETS[g].skills || []) place(path.join(HERE, "skills", s), path.join(CLAUDE, "skills", s), `skill ${s}`);
  for (const a of SETS[g].agents || []) place(path.join(HERE, "agents", a), path.join(CLAUDE, "agents", a), `agent ${a}`);
}

if (GROUPS.has("voice")) {
  console.log("\nvoice");
  if (!MIMESIS || !fs.existsSync(path.join(MIMESIS, "claude", "skills", "mimesis"))) {
    console.error("  ! --mimesis <path to an up-to-date Mimesis folder> is required for the voice group");
    process.exitCode = 1;
  } else {
    const root = path.resolve(MIMESIS);
    const py = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
    place(path.join(root, "claude", "skills", "mimesis"), path.join(CLAUDE, "skills", "mimesis"), "skill mimesis");
    place(path.join(HERE, "commands", "voice.md"), path.join(CLAUDE, "commands", "voice.md"), "command /voice",
      (t) => t.split("<MIMESIS_PATH>").join(root.split(path.sep).join("/")).split(".venv/Scripts/python.exe").join(py));
  }
}

console.log(`\n${DRY ? "DRY RUN: " : ""}${installed} installed or updated, ${current} already current${backedUp ? `, ${backedUp} old copies in ${BACKUP}` : ""}`);
if (installed && !DRY) console.log("Restart Claude Code so it picks up the new skills.");
