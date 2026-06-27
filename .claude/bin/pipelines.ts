/**
 * Pipeline launchers for headless Claude Code passes.
 *
 * Each pipeline composes a focused prompt and invokes `claude -p --fork-session`
 * with a hard budget cap. The agent reads MEMORY.md + VAULT-INDEX.md + relevant
 * rules and performs the requested transformation.
 *
 * Usage:
 *   tsx .claude/bin/pipelines.ts <wiki_import|wiki_fix|auto_dream> [args...]
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import { vaultRoot } from "./config";

const VAULT_ROOT = vaultRoot();
const LOG_FILE = path.join(VAULT_ROOT, ".claude", "logs", "ambient.log");
const MAX_BUDGET_USD = "0.50";

async function log(msg: string) {
  const stamp = new Date().toISOString();
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.appendFile(LOG_FILE, `[${stamp}] ${msg}\n`);
}

const PROMPTS: Record<string, (args: string[]) => string> = {
  wiki_import: (args) => {
    const target = args[0] || "all new files in raw/";
    return `LKHS pipeline: wiki_import

Target: ${target}

Steps:
1. Read .claude/memory/MEMORY.md and .claude/memory/core_profile.json for context. Treat fields in constraints.never_overwrite as immutable.
2. Read VAULT-INDEX.md to map existing entities and relationships.
3. For the target raw file(s):
   a. Extract primary entities, claims, dates, and references.
   b. Use the vector store (.claude/memory/vector_store.json) to find semantically related existing wiki/ notes — but DO NOT load every wiki file; consult VAULT-INDEX.md namespaces first.
   c. Propose: new wiki/ files for unseen entities; edits to existing wiki/ files for matching entities.
   d. Add bidirectional [[link]] syntax connecting new entities to neighbors found via vector + graph.
4. Generate a TRIAGE_REPORT with: proposed_creations, proposed_edits, contradictions_detected (use [!contradiction] callout syntax), provenance hashes.
5. After triage, write the edits. Update VAULT-INDEX.md namespace + graph sections (between AUTO-* markers).
6. Append summary line to .claude/logs/ambient.log.

Do NOT do broad directory walks. Use VAULT-INDEX.md + vector_query for navigation.`;
  },

  wiki_fix: () => `LKHS pipeline: wiki_fix

Steps:
1. Read VAULT-INDEX.md.
2. For each file in wiki/ referenced in the index:
   a. Verify frontmatter conforms to schema (title, aliases, domain, created, updated, provenance).
   b. Verify every [[link]] resolves to a real wiki/ file. Convert dangling links to either a stub note or a placeholder reference.
   c. Detect orphans (files in wiki/ with no inbound links) and add them to VAULT-INDEX.md Orphans section.
3. Re-run until clean. Cap iterations at 5.
4. Append summary line to .claude/logs/ambient.log.`,

  auto_dream: () => `LKHS pipeline: auto_dream (idle consolidation)

Steps:
1. Read .claude/memory/MEMORY.md, core_profile.json, and VAULT-INDEX.md. Protect immutable fields.
2. Temporal sync: scan wiki/ for relative date expressions ("yesterday", "last week", "soon") — rewrite with absolute YYYY-MM-DD using file mtime as anchor.
3. Contradiction resolution: where [!contradiction] callouts exist with a clear temporal winner, collapse to the newer claim and move the older one into a "Superseded" section with date stamps. Where no clear winner exists, leave the callout intact.
4. Stale pruning: remove tracking entries in .claude/memory/domains/*.json whose referenced wiki/ files no longer exist.
5. Index compression: if MEMORY.md exceeds 150 lines, move verbose domain sections into .claude/memory/domains/<slug>.json tiles and replace with single-line pointers.
6. Update _meta.updated in core_profile.json (this is the ONLY core_profile field auto_dream may modify).
7. Append summary line to .claude/logs/ambient.log including counts: temporal_fixes, contradictions_collapsed, stale_pruned, tiles_offloaded.`
};

async function main() {
  const [pipeline, ...args] = process.argv.slice(2);
  if (!pipeline || !PROMPTS[pipeline]) {
    console.error(`Usage: tsx pipelines.ts <${Object.keys(PROMPTS).join("|")}> [args...]`);
    process.exit(1);
  }

  const prompt = PROMPTS[pipeline](args);
  await log(`pipeline:start ${pipeline} ${args.join(" ")}`);

  const child = spawn("claude", [
    "-p", prompt,
    "--fork-session",
    "--dangerously-skip-permissions",
    "--max-budget-usd", MAX_BUDGET_USD,
    "--output-format", "text"
  ], { cwd: VAULT_ROOT, stdio: "inherit", shell: true });

  child.on("exit", async (code) => {
    await log(`pipeline:end ${pipeline} code=${code}`);
    process.exit(code ?? 0);
  });
}

main().catch(async (err) => {
  await log(`pipeline:fatal ${err.message}`);
  process.exit(1);
});
