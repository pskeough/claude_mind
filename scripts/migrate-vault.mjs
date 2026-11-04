#!/usr/bin/env node
/**
 * migrate-vault.mjs — after an engine upgrade, redo ONLY what the upgrade invalidated.
 *
 *   node scripts/migrate-vault.mjs            show the plan and what it costs
 *   node scripts/migrate-vault.mjs --apply    run it, resumable
 *   node scripts/migrate-vault.mjs --apply --only graph,cards
 *
 * THE PROBLEM THIS SOLVES. `upgrade.mjs` pulls new engine code correctly and then ends
 * with a one-line hint: "re-embed if the chunker changed: npm run reindex". On a vault
 * with months of ingested work that instruction is both too blunt and too expensive —
 * `reindex` re-embeds EVERY chunk, which on a real install is hours of compute to
 * reproduce embeddings that are almost all still valid.
 *
 * Almost all, not all. What actually determines the work is which artifacts the new code
 * can no longer read, and that is a much shorter list than "everything":
 *
 *   STILL VALID, never touched here
 *     Embeddings. Same model (bge-small), same DIM (384), and `docContext` — the
 *     contextual prefix each chunk is embedded with — is byte-identical across versions.
 *     A vector computed a year ago is the same vector this code would compute today.
 *
 *   MIGRATES ITSELF, free
 *     The database schema. store.ts calls migrateSchema() on every open: additive,
 *     nullable, idempotent. Verified against a database built by the older engine — the
 *     rows survive, `tier` and `meta` are added, the fact/FTS/vec_facts tables appear.
 *
 *   MUST BE REBUILT, cheap and local
 *     The graph, the skill index. These are derived files whose FORMAT changed; they are
 *     recomputed from the store with no model calls.
 *
 *   WORTH REDOING, costs model calls
 *     Cards and themes (their prompts improved), and journal chunks (the newer engine
 *     stamps temporal metadata used for recency gating, which older chunks lack).
 *
 *   NEW CAPABILITY, entirely optional
 *     Lesson mining. Nothing breaks without it; it is the thing the upgrade is FOR.
 *
 * Every step is conditional on what this vault actually contains, so an install with no
 * persona layer is never told to re-tag facts it does not have.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const VAULT = process.cwd();
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY = (flag("only") || "").split(",").map(s => s.trim()).filter(Boolean);

const MEM = path.join(VAULT, ".claude", "memory");
const STAMP = path.join(MEM, ".install-version.json");
const PROGRESS = path.join(MEM, ".migration-progress.json");
const ENGINE_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(VAULT, "package.json"), "utf8")).version || "0.0.0"; }
  catch { return "0.0.0"; }
})();

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const count = (dir, ext = ".md") => {
  try { return fs.readdirSync(path.join(VAULT, dir)).filter(f => f.endsWith(ext)).length; } catch { return 0; }
};

// ---- what does this vault actually have? -----------------------------------
const has = {
  db: exists(path.join(MEM, "vector_store.db")),
  profile: exists(path.join(MEM, "core_profile.json")),
  persona: exists(path.join(VAULT, "persona")) && count("persona") > 0,
  facts: exists(path.join(MEM, "persona_facts.jsonl")),
  journals: count("journal"),
  cards: count("cards"),
  library: exists(path.join(VAULT, "library")),
};

const installed = (() => {
  try { return JSON.parse(fs.readFileSync(STAMP, "utf8")); } catch { return null; }
})();
const fromVersion = installed?.version || (has.db ? "1.0.0 (inferred: no version stamp, but a store exists)" : "none");

// ---- the plan ---------------------------------------------------------------
/** cost: "free" = no model calls; "local" = compute only; "model" = spends tokens. */
const STEPS = [
  {
    id: "backup",
    when: () => has.db,
    cost: "free",
    why: "Copy the store to a timestamped backup before anything writes to it. The schema migration is additive and was verified against a database built by the older engine, but this vault holds months of ingested work that cannot be regenerated, and a file copy costs seconds.",
    // Not a shell command: doing it in-process means it cannot be skipped by a shell
    // quoting failure, and it runs before any other step can open the database.
    fn: () => {
      const stampDir = path.join(MEM, "backups");
      fs.mkdirSync(stampDir, { recursive: true });
      const tag = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      let copied = 0;
      for (const suffix of ["", "-wal", "-shm"]) {
        const src = path.join(MEM, "vector_store.db" + suffix);
        if (!exists(src)) continue;
        fs.copyFileSync(src, path.join(stampDir, `vector_store.${tag}.db${suffix}`));
        copied++;
      }
      for (const f of ["persona_facts.jsonl", "core_profile.json"]) {
        const src = path.join(MEM, f);
        if (exists(src)) { fs.copyFileSync(src, path.join(stampDir, `${f}.${tag}.bak`)); copied++; }
      }
      console.log(`   copied ${copied} file(s) to ${stampDir}`);
      console.log(`   to roll back: stop the daemon, then restore vector_store.${tag}.db over .claude/memory/vector_store.db`);
      return 0;
    },
  },
  {
    id: "schema",
    when: () => has.db,
    cost: "free",
    why: "Add the columns and tables the newer engine expects. Additive and idempotent; existing rows are untouched.",
    cmd: ["npm", "run", "migrate", "--", "--schema"],
    note: "Also happens automatically the first time anything opens the store; running it explicitly makes it visible and verifiable.",
  },
  {
    id: "sweep",
    when: () => true,
    cost: "model",
    why: "Capture any Claude Code sessions that happened while the old engine was running but were never summarized.",
    cmd: ["npm", "run", "capture:sweep"],
  },
  {
    id: "skills",
    when: () => true,
    cost: "local",
    why: "Build the skill index. This did not exist in the old version, so the semantic skill router has nothing to route to until it runs.",
    cmd: ["npm", "run", "skills:index"],
  },
  {
    id: "facts",
    when: () => has.facts,
    cost: "local",
    why: "Populate the vec_facts table so persona facts are retrievable. The old schema had no such table, so existing facts are invisible to retrieval until embedded.",
    cmd: ["npm", "run", "facts:embed"],
  },
  {
    id: "scope",
    when: () => has.facts,
    cost: "free",
    why: "Apply audience-scope floors to existing facts. Without this every fact defaults to `personal` and the work/public profiles cannot filter properly.",
    cmd: ["npm", "run", "persona:scope", "--", "--apply"],
  },
  {
    id: "graph",
    when: () => has.db,
    cost: "local",
    why: "Rebuild the knowledge graph. The format changed substantially (per-node source files, bi-temporal edges, the PPR index the graph-retrieval channel needs); the old graph.json cannot be read by the new code.",
    cmd: ["npm", "run", "graph"],
  },
  {
    id: "journals",
    when: () => has.journals > 0,
    cost: "local",
    why: `Re-embed the ${has.journals} session journal(s) so their chunks carry temporal metadata. Old chunks have no date stamp, so recency-aware retrieval treats a two-year-old session the same as yesterday's.`,
    // vector-engine has no --layer switch; it re-embeds whatever FILES it is given, and
    // falls back to the whole corpus when given none. Passing the journal list explicitly
    // is what keeps this a targeted re-embed instead of a full reindex — the exact
    // distinction this script exists to make.
    cmdFn: () => {
      const dir = path.join(VAULT, "journal");
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md")).map(f => `journal/${f}`);
      return ["npx", "tsx", ".claude/bin/vector-engine.ts", "--force", ...files];
    },
    note: "Targeted at journal/ only. This is the one re-embed genuinely needed, and it is a fraction of a full reindex.",
  },
  {
    id: "cards",
    when: () => has.db,
    cost: "model",
    why: "Rebuild project-state cards; their prompt and schema improved.",
    cmd: ["npm", "run", "cards"],
  },
  {
    id: "themes",
    when: () => has.cards > 2,
    cost: "model",
    why: "Rebuild cross-project theme cards. Needs cards to exist first.",
    cmd: ["npm", "run", "themes"],
  },
  {
    id: "state",
    when: () => true,
    cost: "local",
    why: "Generate TODAY.md, the digest injected at every session start. Did not exist in the old version.",
    cmd: ["npm", "run", "state"],
  },
  {
    id: "moc",
    when: () => has.db,
    cost: "free",
    why: "Rebuild the Obsidian HOME map so the vault is browsable by hand.",
    cmd: ["npm", "run", "moc"],
  },
  {
    id: "lessons",
    when: () => true,
    cost: "model",
    optional: true,
    why: "Mine tool-hygiene lessons from past sessions. This is the new capability, not a repair: it reads transcripts already on disk and learns what tends to go wrong on this machine. Nothing breaks if it is skipped.",
    cmd: ["npm", "run", "learn:mine", "--", "--all", "--max-clusters", "12"],
  },
  {
    id: "lessons-embed",
    when: () => true,
    cost: "local",
    optional: true,
    why: "Render the mined lessons into the playbook and the PreToolUse trigger index.",
    cmd: ["npm", "run", "learn:embed"],
  },
];

const active = STEPS.filter(s => s.when()).filter(s => !ONLY.length || ONLY.includes(s.id));
const done = (() => { try { return new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []); } catch { return new Set(); } })();

console.log(`Claude Mind — post-upgrade migration\n`);
console.log(`  engine version now:  ${ENGINE_VERSION}`);
console.log(`  vault last built by: ${fromVersion}`);
console.log(`  this vault has: ${has.db ? "a store" : "NO store"}, ${has.journals} journal(s), ${has.cards} card(s), ` +
  `${has.persona ? "a persona layer" : "no persona"}, ${has.facts ? "facts" : "no facts"}\n`);

if (!has.db) {
  console.log(`  No store found. This looks like a FRESH install, not an upgrade —`);
  console.log(`  follow SETUP.md instead of running this.\n`);
  process.exit(0);
}

const icon = { free: " ", local: "~", model: "$" };
console.log(`  ${"".padEnd(7)}${"step".padEnd(15)}cost  what it does`);
for (const s of active) {
  const mark = done.has(s.id) ? "[done] " : s.optional ? "[opt]  " : "       ";
  const first = s.why.split(". ")[0].replace(/\.$/, "");
  console.log(`  ${mark}${s.id.padEnd(15)} ${icon[s.cost]}    ${first}.`);
}
console.log(`\n  legend:    = free/instant,  ~ = local compute,  $ = spends model tokens`);
console.log(`\n  NOT doing a full re-embed. Existing embeddings stay valid: same model, same`);
console.log(`  dimension, and the contextual prefix is byte-identical across versions.`);
console.log(`  Only journal chunks are re-embedded, to gain temporal metadata.`);

if (!APPLY) {
  console.log(`\n  Nothing above has been changed — this is a read-only report. It is safe to run`);
  console.log(`  on an unfamiliar install just to see what state it is in.`);
  console.log(`\n  Run it:  node scripts/migrate-vault.mjs --apply`);
  console.log(`  Or a subset:  node scripts/migrate-vault.mjs --apply --only graph,skills`);
  process.exit(0);
}

// ---- run --------------------------------------------------------------------
let failed = 0;
for (const s of active) {
  if (done.has(s.id)) { console.log(`\n== ${s.id} — already done, skipping ==`); continue; }
  console.log(`\n== ${s.id} ==`);
  console.log(`   ${s.why}`);
  let status;
  if (s.fn) {
    try { status = s.fn(); }
    catch (e) { console.error(`   ! ${e.message}`); status = 1; }
  } else {
    const [cmd, ...args] = s.cmdFn ? s.cmdFn() : s.cmd;
    status = spawnSync(cmd, args, { cwd: VAULT, stdio: "inherit", shell: process.platform === "win32" }).status;
  }
  const r = { status };
  if (r.status === 0) {
    done.add(s.id);
    fs.mkdirSync(MEM, { recursive: true });
    fs.writeFileSync(PROGRESS, JSON.stringify({ done: [...done], updated: new Date().toISOString() }, null, 2));
  } else {
    failed++;
    console.error(`   ! ${s.id} failed (exit ${r.status}).`);
    // A failed OPTIONAL step is not a failed migration; the vault is already usable.
    if (s.optional) console.error(`     This step is optional — the vault works without it. Continuing.`);
    else console.error(`     Re-run just this step with:  node scripts/migrate-vault.mjs --apply --only ${s.id}`);
  }
}

// Stamp the version only if EVERY required step this vault needs has been done — checked
// against the full applicable list, not the --only subset. Checking `active` meant that
// `--apply --only backup` stamped the vault as fully migrated: the one filtered step
// succeeded, so nothing looked outstanding, the upgrade gate would never fire again, and
// the graph rebuild and journal re-embed would be stranded undone forever.
const requiredFailed = STEPS.filter(s => s.when() && !s.optional).some(s => !done.has(s.id));
if (!requiredFailed) {
  fs.writeFileSync(STAMP, JSON.stringify({ version: ENGINE_VERSION, migratedAt: new Date().toISOString(), from: fromVersion }, null, 2));
  console.log(`\n===========================================================`);
  console.log(` Migration complete. Vault stamped at ${ENGINE_VERSION}.`);
  console.log(` Verify with:  npm run doctor`);
  console.log(`===========================================================`);
} else {
  const outstanding = STEPS.filter(s => s.when() && !s.optional && !done.has(s.id)).map(s => s.id);
  console.log(`\nNot stamped yet — still outstanding: ${outstanding.join(", ")}`);
  if (failed) console.log(`${failed} step(s) failed above; fix and re-run.`);
  else console.log(`(Nothing failed; these were filtered out by --only.)`);
  console.log(`Re-running picks up where it stopped — completed steps are skipped.`);
  process.exit(failed ? 1 : 0);
}
