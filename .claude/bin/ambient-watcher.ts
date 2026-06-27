/**
 * LKHS ambient watcher.
 *
 * Watches raw/ and wiki/ for markdown changes. On any change it re-embeds the
 * file locally (cheap, hash-skipped). A change under raw/ additionally triggers
 * an autonomous headless `claude -p` compile pass that ingests the new source
 * into wiki/ and regenerates the index.
 *
 * Loop safety (the original design could compile -> edit wiki/ -> re-trigger):
 *   - Only raw/ changes trigger a compile. wiki/ changes are embed-only, so the
 *     agent rewriting wiki/ during a compile cannot kick off another compile.
 *   - Hash-skip in the embedder makes re-embedding identical content a no-op.
 *   - A post-compile cooldown ignores raw/ churn the agent might cause.
 *   - Singleton: a PID-checked lock means SessionStart can call this every
 *     session without ever spawning a second watcher.
 *   - Coalesced + rate-limited compiles cap how often the agent runs.
 *
 * Auth note: runs against the user's Claude subscription (OAuth). We never pass
 * --bare (that would force ANTHROPIC_API_KEY auth). --max-budget-usd is a
 * quota safety ceiling, configurable via LKHS_MAX_BUDGET_USD ("off" to omit).
 */
import chokidar from "chokidar";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as fsSync from "fs";
import * as path from "path";
import { processFileEmbeddings } from "./vector-engine";
import { vaultRoot } from "./config";

const VAULT_ROOT = vaultRoot();
const WATCHER_LOCK = path.join(VAULT_ROOT, ".claude", "watcher.lock");
const LOG_FILE = path.join(VAULT_ROOT, ".claude", "logs", "ambient.log");

const DEBOUNCE_MS = 2500;
const COMPILE_COOLDOWN_MS = 60_000;     // ignore raw/ churn for this long after a compile
const MIN_COMPILE_INTERVAL_MS = 30_000; // floor between compiles (quota protection)
const MAX_COMPILES_PER_RUN = Number(process.env.LKHS_MAX_COMPILES ?? 50);
const MAX_BUDGET_USD = process.env.LKHS_MAX_BUDGET_USD ?? "5.00"; // "off" to omit the cap

let debounceTimer: NodeJS.Timeout | null = null;
const dirtyFiles = new Set<string>();

let compiling = false;
let pendingCompile = false;
let compileCount = 0;
let lastCompileAt = 0;
let cooldownUntil = 0;

// ---------------------------------------------------------------- logging

async function writeLog(message: string): Promise<void> {
  const stamp = new Date().toISOString();
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.appendFile(LOG_FILE, `[${stamp}] ${message}\n`);
}

// ---------------------------------------------------------------- singleton

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e: any) { return e.code === "EPERM"; } // EPERM => exists but not ours
}

/** Acquire the singleton lock. Reclaims a stale lock from a dead PID. */
async function acquireWatcherLock(): Promise<boolean> {
  await fs.mkdir(path.dirname(WATCHER_LOCK), { recursive: true });
  if (fsSync.existsSync(WATCHER_LOCK)) {
    const prev = Number((await fs.readFile(WATCHER_LOCK, "utf-8")).trim());
    if (prev && isAlive(prev) && prev !== process.pid) return false;
    await fs.unlink(WATCHER_LOCK).catch(() => {}); // stale; reclaim
  }
  await fs.writeFile(WATCHER_LOCK, String(process.pid), "utf-8");
  return true;
}

async function releaseWatcherLock(): Promise<void> {
  try {
    const held = Number((await fs.readFile(WATCHER_LOCK, "utf-8")).trim());
    if (held === process.pid) await fs.unlink(WATCHER_LOCK);
  } catch { /* already gone */ }
}

// ---------------------------------------------------------------- embedding

async function embedFile(rel: string): Promise<void> {
  const abs = path.join(VAULT_ROOT, rel);
  if (!fsSync.existsSync(abs) || !rel.endsWith(".md")) return;
  try {
    const content = await fs.readFile(abs, "utf-8");
    const key = rel.split(path.sep).join("/");
    const result = await processFileEmbeddings(key, content);
    if (result === "indexed") await writeLog(`embed:ok ${key}`);
  } catch (err: any) {
    await writeLog(`embed:fail ${rel} ${err.message}`);
  }
}

// ---------------------------------------------------------------- compile

const RULES = [
  "You are the LKHS ambient compiler. Operate under these invariants:",
  "- NEVER modify fields in .claude/memory/core_profile.json listed in constraints.never_overwrite.",
  "- Do NOT modify any file under raw/ (read-only source).",
  "- Navigate via VAULT-INDEX.md + the vector store; never do broad directory walks.",
  "- Use [[bidirectional links]] and [!contradiction] callouts instead of silent overwrites.",
  "- Keep .claude/memory/MEMORY.md under 150 lines; offload schema to domains/ tiles.",
  "- NO em dashes anywhere. Use commas, colons, or hyphens. This is a hard user constraint.",
  "- When regenerating index sections, ADD to existing entries; do not rewrite the graph wholesale or drop existing nodes/edges.",
  "- Wiki frontmatter is required: title, aliases, domain, created, updated, provenance. Filenames hyphenated, titles spaced."
].join("\n");

function buildPrompt(files: string[]): string {
  const fileList = files.map(f => `- ${f}`).join("\n");
  return `LKHS ambient compile pass.

New/changed source files under raw/:
${fileList}

You MUST take file actions with the Write/Edit tools, not just report. Steps:
1. Read .claude/memory/MEMORY.md, core_profile.json, and VAULT-INDEX.md for context.
2. For each raw/ file: extract entities/claims/dates; query the vector store (npx tsx .claude/bin/vector-query.ts "<q>") for related wiki/ notes.
3. Create a new wiki/<Entity>.md for each unseen entity (required frontmatter + [[links]]), OR edit the matching existing note. If the content is fully covered already, still ensure bidirectional [[links]] exist, and say so in the report. Do not silently no-op.
4. Update VAULT-INDEX.md namespace + graph sections between the AUTO-* markers (ADD entries; do not rewrite the whole graph).
5. Register any new domain in MEMORY.md (AUTO-DOMAIN-LIST markers) + add a domains/<slug>.json tile.

End by printing TRIAGE_REPORT: <files created>, <files edited>, <links added>.`;
}

function runCompile(files: string[]): void {
  compiling = true;
  compileCount += 1;
  lastCompileAt = Date.now();

  const args = [
    "-p", buildPrompt(files),
    "--append-system-prompt", RULES,
    "--dangerously-skip-permissions",
    "--output-format", "text"
  ];
  if (MAX_BUDGET_USD.toLowerCase() !== "off") args.push("--max-budget-usd", MAX_BUDGET_USD);

  writeLog(`compile:start #${compileCount} ${files.length} file(s)`);
  // stdin 'ignore' so claude -p does not wait 3s for piped input that never comes.
  const child = spawn("claude", args, { cwd: VAULT_ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] });

  let out = "";
  child.stdout?.on("data", d => { out += d.toString(); });
  child.stderr?.on("data", d => writeLog(`compile:stderr ${d.toString().slice(0, 300)}`));

  child.on("exit", async (code) => {
    await writeLog(`compile:end #${compileCount} code=${code} ${out.trim().slice(0, 400).replace(/\n/g, " | ")}`);
    compiling = false;
    cooldownUntil = Date.now() + COMPILE_COOLDOWN_MS;
    if (pendingCompile) { pendingCompile = false; maybeCompile(["(coalesced follow-up)"]); }
  });
}

function maybeCompile(files: string[]): void {
  if (compiling) { pendingCompile = true; return; }
  if (compileCount >= MAX_COMPILES_PER_RUN) {
    writeLog(`compile:skip cap reached (${MAX_COMPILES_PER_RUN}/run); restart watcher to resume`);
    return;
  }
  const sinceLast = Date.now() - lastCompileAt;
  if (sinceLast < MIN_COMPILE_INTERVAL_MS) {
    pendingCompile = true;
    setTimeout(() => { if (pendingCompile) { pendingCompile = false; maybeCompile(files); } },
      MIN_COMPILE_INTERVAL_MS - sinceLast);
    return;
  }
  runCompile(files);
}

// ---------------------------------------------------------------- trigger

function trigger(rel: string): void {
  dirtyFiles.add(rel);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const batch = Array.from(dirtyFiles);
    dirtyFiles.clear();

    for (const f of batch) await embedFile(f);

    const rawChanges = batch.filter(f => f.replace(/\\/g, "/").startsWith("raw/"));
    if (rawChanges.length === 0) return;                       // wiki/ edits are embed-only
    if (Date.now() < cooldownUntil) {
      await writeLog(`compile:skip cooldown (${rawChanges.length} raw change(s))`);
      return;
    }
    maybeCompile(rawChanges);
  }, DEBOUNCE_MS);
}

// ---------------------------------------------------------------- boot

async function main() {
  if (!(await acquireWatcherLock())) {
    console.log("LKHS watcher already running; nothing to do.");
    process.exit(0);
  }

  // chokidar v4+ removed glob support: watch the dirs and filter by extension.
  // Never ignore directories (traversal must continue); only ignore non-.md files.
  const watcher = chokidar.watch(["raw", "wiki", "persona", "persona_clinical"], {
    cwd: VAULT_ROOT,
    ignored: (p: string, stats?: { isFile(): boolean }) => {
      const base = path.basename(p);
      if (base.startsWith(".")) return true;
      if (p.includes("node_modules") || p.includes(".obsidian")) return true;
      if (stats?.isFile() && !p.endsWith(".md")) return true;
      return false;
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }
  });

  watcher
    .on("add", p => { writeLog(`watch:add ${p}`); trigger(p); })
    .on("change", p => { writeLog(`watch:change ${p}`); trigger(p); })
    .on("unlink", p => writeLog(`watch:unlink ${p}`));

  await writeLog(`ambient-watcher:started pid=${process.pid}`);
  console.log(`LKHS watcher running (pid ${process.pid}). Watching raw/ + wiki/ under ${VAULT_ROOT}`);
  console.log(`Compile on raw/ changes only. Budget ceiling: ${MAX_BUDGET_USD}. Log: ${LOG_FILE}`);

  const shutdown = async () => {
    await writeLog("ambient-watcher:stopped");
    await releaseWatcherLock();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (err) => {
  await writeLog(`ambient-watcher:fatal ${err.message}`);
  await releaseWatcherLock();
  process.exit(1);
});
