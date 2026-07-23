/**
 * store-hygiene.ts — weekly RAG-store integrity + drift accounting.
 *
 * The content level has curation (memory-curation-companion, sleep-reconcile);
 * this is the STORE level: is the vector store internally consistent, is it
 * tracking disk, and is retrieval quality drifting? Read-only over the store —
 * it measures and reports; fixes stay propose-only per vault policy.
 *
 * Checks:
 *   1. eval drift    — latest eval:memory composite vs the previous run
 *                      (alarm when it drops > driftAlarm, default 0.05)
 *   2. census drift  — unresolved-path count (prune-stale logic) vs last week:
 *                      NEW orphans mean something moved/was deleted this week
 *   3. exact dupes   — identical chunk text stored under multiple rows
 *   4. coverage      — chunks without vectors, vectors without chunks,
 *                      jsonl facts missing from the fact table, unscoped facts
 *
 * Output: .claude/memory/store_hygiene.json (trend appended) — state-rollup
 * surfaces the headline + alarms in TODAY.md.
 *
 *   npx tsx .claude/bin/store-hygiene.ts   (npm run hygiene; Sunday step in refresh)
 */
import * as fs from "fs";
import * as path from "path";
import { getDb } from "./store";
import { vaultRoot, memDir, config } from "./config";
import { loadFactsFile } from "./persona-facts";

const VAULT = vaultRoot();
const OUT = path.join(memDir(), "store_hygiene.json");
const DRIFT_ALARM = Number(process.env.LKHS_DRIFT_ALARM || config().driftAlarm || 0.05);

// same resolution contract as prune-stale.ts
const INGEST_ROOTS: string[] = (Array.isArray(config().ingestRoots) ? config().ingestRoots : []).map((r: string) => path.resolve(String(r)));
function existsSomewhere(file: string): boolean | null {
  if (file.startsWith("skills/")) return true;
  if (file.startsWith("library/")) {
    const rest = file.slice("library/".length);
    if (fs.existsSync(path.join(VAULT, "library", rest))) return true;
    for (const root of INGEST_ROOTS) if (fs.existsSync(path.join(root, rest))) return true;
    return INGEST_ROOTS.length === 0 ? null : false;
  }
  return fs.existsSync(path.join(VAULT, file));
}

function latestEval(): { file: string; composite: number; recall: number; generated: string } | null {
  const dir = path.join(memDir(), "eval", "runs");
  try {
    const runs = fs.readdirSync(dir).filter(f => /^\d{4}-/.test(f)).sort(); // offline eval runs only (quality-* excluded)
    for (let i = runs.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, runs[i]!), "utf8"));
        const m = j.metrics || {};
        if (typeof m.composite === "number") return { file: runs[i]!, composite: m.composite, recall: m.recall_at_k ?? null, generated: j.generated || runs[i]! };
      } catch { /* skip bad run */ }
    }
  } catch { /* no runs */ }
  return null;
}

function main() {
  const db = getDb();
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { trend: [] };
  const last = prev.trend?.length ? prev.trend[prev.trend.length - 1] : null;

  // 1. eval drift
  const ev = latestEval();
  const evalDrop = ev && last?.eval_composite != null ? Number((last.eval_composite - ev.composite).toFixed(4)) : null;

  // 2. census drift
  const files = db.prepare("SELECT file FROM files").all() as Array<{ file: string }>;
  let unresolved = 0;
  for (const r of files) if (existsSomewhere(r.file) === false) unresolved++;
  const newOrphans = last?.unresolved != null ? unresolved - last.unresolved : null;

  // 3. exact duplicate chunk texts (hot tier only — cold is archived by design).
  // Two different problems: WITHIN-file dupes are chunking defects; CROSS-file
  // dupes are mostly ingested boilerplate (measured 2026-07-23: 660 copies of
  // the HuggingFace "[More Information Needed]" template, prompt templates) —
  // retrieval noise that has previously flipped the gate on generic prompts.
  const dupWithin = (db.prepare(`SELECT COALESCE(SUM(c), 0) AS n FROM (
      SELECT COUNT(*) - 1 AS c FROM chunks WHERE tier IS NULL OR tier != 'cold'
      GROUP BY file, text HAVING COUNT(*) > 1)`).get() as any).n;
  const dupExtra = (db.prepare(`SELECT COALESCE(SUM(c), 0) AS n FROM (
      SELECT COUNT(*) - 1 AS c FROM chunks WHERE tier IS NULL OR tier != 'cold'
      GROUP BY text HAVING COUNT(*) > 1)`).get() as any).n;

  // 4. coverage integrity
  const chunksNoVec = (db.prepare("SELECT COUNT(*) AS n FROM chunks c WHERE NOT EXISTS (SELECT 1 FROM vec_chunks v WHERE v.rowid = c.id)").get() as any).n;
  const vecsNoChunk = (db.prepare("SELECT COUNT(*) AS n FROM vec_chunks v WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.id = v.rowid)").get() as any).n;
  const factsInDb = (db.prepare("SELECT COUNT(*) AS n FROM fact").get() as any).n;
  const factsUnscoped = (db.prepare("SELECT COUNT(*) AS n FROM fact WHERE scope IS NULL").get() as any).n;
  const factsInJsonl = loadFactsFile(path.join(memDir(), "persona_facts.jsonl")).length
    + loadFactsFile(path.join(memDir(), "persona_clinical.jsonl")).length;

  const snapshot = {
    ts: new Date().toISOString().slice(0, 10),
    eval_composite: ev?.composite ?? null, eval_recall: ev?.recall ?? null, eval_run: ev?.file ?? null, eval_drop: evalDrop,
    unresolved, new_orphans: newOrphans,
    dup_extra_chunks: dupExtra, dup_within_file: dupWithin, chunks_no_vec: chunksNoVec, vecs_no_chunk: vecsNoChunk,
    facts_db: factsInDb, facts_jsonl: factsInJsonl, facts_unscoped: factsUnscoped,
  };
  const alarms: string[] = [];
  if (evalDrop != null && evalDrop > DRIFT_ALARM) alarms.push(`eval composite dropped ${evalDrop} (${last.eval_composite} -> ${ev!.composite}) — retrieval quality drift, run eval:memory item diff`);
  if (newOrphans != null && newOrphans > 0) alarms.push(`${newOrphans} NEW unresolved store path(s) this week (moved/deleted sources) — npm run prune:stale for the census`);
  if (chunksNoVec > 0) alarms.push(`${chunksNoVec} chunk(s) have no vector — re-run npm run embed`);
  if (vecsNoChunk > 0) alarms.push(`${vecsNoChunk} orphan vector row(s) — store integrity, investigate before reindex`);
  if (factsInDb !== factsInJsonl) alarms.push(`fact table (${factsInDb}) != jsonl facts (${factsInJsonl}) — run npm run facts:embed`);
  if (factsUnscoped > 0) alarms.push(`${factsUnscoped} unscoped fact(s) in DB — run npm run persona:scope -- --apply && npm run facts:embed`);

  const trend = [...(prev.trend || []), snapshot].slice(-26); // ~6 months of weekly points
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), driftAlarm: DRIFT_ALARM, alarms, trend }, null, 1));

  console.log(`store hygiene ${snapshot.ts}: composite=${snapshot.eval_composite ?? "n/a"}${evalDrop != null ? ` (drop ${evalDrop})` : ""} | unresolved=${unresolved}${newOrphans != null ? ` (+${newOrphans} new)` : ""} | dup cross-file=${dupExtra} within-file=${dupWithin} | no-vec=${chunksNoVec} | orphan-vec=${vecsNoChunk} | facts db/jsonl=${factsInDb}/${factsInJsonl} unscoped=${factsUnscoped}`);
  if (alarms.length) { console.log("ALARMS:"); for (const a of alarms) console.log(`  - ${a}`); }
  else console.log("no alarms.");
}

main();
