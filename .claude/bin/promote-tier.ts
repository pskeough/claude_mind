/**
 * LKHS tier promotion (P6, LKHS-V2-UPGRADE-PATH.md): episodic -> semantic retirement.
 *
 * TiMem/RecMem finding: a smaller hot pool RAISES retrieval accuracy; the same event
 * recapped across months of session chunks competes with the current state. Rule
 * (deterministic, reversible, usage-aware):
 *
 *   A session-layer chunk goes COLD when ALL hold:
 *     - its section date is older than COLD_AFTER_DAYS (default 90)
 *     - its project has an L2 card updated more recently than the chunk's date
 *       (the episode has been distilled into stable state)
 *     - chunk_stats shows no injection of it within USAGE_WINDOW_DAYS (default 60)
 *       (never penalize what is actually being used - the ACT-R frequency guard)
 *
 * Cold chunks stay in the store (tombstone-style: tier='cold') and remain reachable
 * via includeCold / explicit deep search; they just stop competing in the default
 * pool. Undo everything: npm run tier -- --thaw
 *
 *   npm run tier               # promote (prints per-project counts)
 *   npm run tier -- --dry      # report only
 *   npm run tier -- --thaw     # reset ALL cold chunks back to hot
 */
import * as fs from "fs";
import * as path from "path";
import { vaultRoot } from "./config";
import { getDb, sha256, ensureChunkStats } from "./store";

const VAULT = vaultRoot();
const LOG_FILE = path.join(VAULT, ".claude", "logs", "ambient.log");
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const THAW = argv.includes("--thaw");
const argOf = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const COLD_AFTER_DAYS = Number(argOf("--cold-after") || 90);
const USAGE_WINDOW_DAYS = Number(argOf("--usage-window") || 60);
const MAX_PER_RUN = Number(argOf("--max") || 2000);

function log(m: string): void {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] tier:${m}\n`); } catch { /* */ }
  console.log(m);
}

function cardUpdated(project: string): number {
  try {
    const p = path.join(VAULT, "cards", `${project}.md`);
    const m = fs.readFileSync(p, "utf-8").match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m);
    return m ? Date.parse(m[1]!) : fs.statSync(p).mtimeMs;
  } catch { return NaN; }
}

async function main() {
  const db = getDb();
  ensureChunkStats(db);

  if (THAW) {
    const n = db.prepare("UPDATE chunks SET tier = NULL WHERE tier = 'cold'").run().changes;
    log(`thawed ${n} chunk(s) back to hot`);
    return;
  }

  const cutoffMs = Date.now() - COLD_AFTER_DAYS * 86_400_000;
  const usageCutIso = new Date(Date.now() - USAGE_WINDOW_DAYS * 86_400_000).toISOString();

  // Candidates: hot session-layer chunks with a dated meta older than the cutoff.
  const rows = db.prepare(`
    SELECT id, file, text, meta FROM chunks
    WHERE layer = 'session' AND (tier IS NULL OR tier != 'cold') AND meta IS NOT NULL
  `).all() as Array<{ id: number; file: string; text: string; meta: string }>;

  const recentHit = db.prepare("SELECT 1 FROM chunk_stats WHERE file = ? AND text_hash = ? AND last_injected_at >= ?");
  const cardCache = new Map<string, number>();
  const toCold: number[] = [];
  const perProject = new Map<string, number>();

  for (const r of rows) {
    if (toCold.length >= MAX_PER_RUN) break;
    let d: number = NaN;
    try { const m = JSON.parse(r.meta); d = Date.parse(m.valid_at || m.source_date || ""); } catch { /* */ }
    if (isNaN(d) || d > cutoffMs) continue;

    const project = path.basename(r.file, ".md");
    if (!cardCache.has(project)) cardCache.set(project, cardUpdated(project));
    const cu = cardCache.get(project)!;
    if (isNaN(cu) || cu <= d) continue;                        // no newer distillation exists: keep hot

    if (recentHit.get(r.file, sha256(r.text).slice(0, 16), usageCutIso)) continue; // actively used: keep hot

    toCold.push(r.id);
    perProject.set(project, (perProject.get(project) || 0) + 1);
  }

  if (!DRY && toCold.length) {
    const stmt = db.prepare("UPDATE chunks SET tier = 'cold' WHERE id = ?");
    const tx = db.transaction((ids: number[]) => { for (const id of ids) stmt.run(id); });
    tx(toCold);
  }
  const detail = [...perProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, n]) => `${p}:${n}`).join(", ");
  const hot = (db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE layer = 'session' AND (tier IS NULL OR tier != 'cold')").get() as any).n;
  const cold = (db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE tier = 'cold'").get() as any).n;
  log(`${DRY ? "[dry] would promote" : "promoted"} ${toCold.length} session chunk(s) to cold (${detail || "none"}); session pool now hot=${hot} cold=${cold}`);
}

main().catch(e => { log(`fatal ${e.message}`); process.exit(1); });
