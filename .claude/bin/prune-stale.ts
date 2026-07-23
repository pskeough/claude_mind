/**
 * prune-stale.ts — reconcile the store's `files` table against the disk.
 *
 * A file deleted from the vault leaves its chunks embedded and retrievable
 * (found 2026-07-23: wiki/Biography.md surfaced in the leak harness while
 * absent on disk). Deleting those rows would DESTROY the store's last copy of
 * that content, which breaks the vault's append-only/tombstone philosophy —
 * so the default action is to move stale files' chunks to the COLD tier:
 * out of the default retrieval pool (gate, leak surface) but recoverable via
 * includeCold, and reversible per row (tier = NULL).
 *
 *   npx tsx .claude/bin/prune-stale.ts                      census: list unresolved files
 *   npx tsx .claude/bin/prune-stale.ts --tombstone f1,f2    cold-tier SPECIFIC files only
 *   npx tsx .claude/bin/prune-stale.ts --purge              print a DELETE plan (never executes)
 *
 * WHY NO BLANKET --apply: the 2026-07-23 census found 1,120 "missing" files and
 * they are mostly NOT junk — moved project roots (AI_Book_Editor incl. Basilisk
 * chapters) and the legacy `writing/` corpus namespace, i.e. content whose only
 * local embedding may be the store itself. Disk-existence is not a staleness
 * signal in a memory system; removal is a per-file human decision, so the tool
 * only reports, and tombstones exactly what it is told to.
 * Skips synthetic namespaces (skills/) whose "files" are not disk paths.
 */
import * as fs from "fs";
import * as path from "path";
import { getDb } from "./store";
import { vaultRoot, config } from "./config";

const VAULT = vaultRoot();
const argv = process.argv.slice(2);
const argOf = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const TOMBSTONE = argOf("--tombstone") ? String(argOf("--tombstone")).split(",").map(s => s.trim().replace(/\\/g, "/")) : null;
const PURGE = argv.includes("--purge");

// The `library/<project>/<rest>` namespace is ingested from EXTERNAL roots
// (config ingestRoots), NOT <vault>/library/. The first dry-run resolved
// everything vault-relative and declared 82% of the store stale — the honest
// checker must try each ingest root, and SKIP (never flag) anything it cannot
// confidently locate.
const INGEST_ROOTS: string[] = (Array.isArray(config().ingestRoots) ? config().ingestRoots : []).map((r: string) => path.resolve(String(r)));

function existsSomewhere(file: string): boolean | null {
  if (file.startsWith("library/")) {
    const rest = file.slice("library/".length);
    if (fs.existsSync(path.join(VAULT, "library", rest))) return true; // vault-local digests
    for (const root of INGEST_ROOTS) if (fs.existsSync(path.join(root, rest))) return true;
    if (INGEST_ROOTS.length === 0) return null; // cannot resolve -> never flag
    return false;
  }
  // vault-relative namespaces (wiki/cards/themes/persona/journal/raw/.claude/memory)
  return fs.existsSync(path.join(VAULT, file));
}

function main() {
  const db = getDb();
  const rows = db.prepare("SELECT file, layer FROM files ORDER BY file").all() as Array<{ file: string; layer: string | null }>;
  const stale: Array<{ file: string; layer: string | null; chunks: number; cold: number }> = [];
  for (const r of rows) {
    if (r.file.startsWith("skills/")) continue; // synthetic namespace, not a disk path
    const ex = existsSomewhere(r.file);
    if (ex === true || ex === null) continue;   // exists, or unresolvable (fail-safe skip)
    const c = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN tier='cold' THEN 1 ELSE 0 END) AS cold FROM chunks WHERE file = ?").get(r.file) as any;
    stale.push({ file: r.file, layer: r.layer, chunks: c.n, cold: c.cold || 0 });
  }

  if (!stale.length) { console.log(`no stale files: all ${rows.length} indexed files exist on disk.`); return; }
  console.log(`${stale.length} stale file(s) (indexed but absent on disk) of ${rows.length} total:`);
  for (const s of stale) console.log(`  ${s.file}  [${s.layer}] ${s.chunks} chunk(s)${s.cold === s.chunks ? " (already cold)" : ""}`);

  if (PURGE) {
    console.log(`\nPURGE PLAN (NOT executed — deleting these rows destroys the store's last copy of this content):`);
    for (const s of stale) console.log(`  store.deleteFile("${s.file}")`);
    console.log("Run these by hand only after confirming the content is preserved elsewhere or intentionally unwanted.");
    return;
  }
  if (!TOMBSTONE) { console.log(`\nCENSUS ONLY: nothing changed. Tombstone specific files with --tombstone <file,file> (reversible: UPDATE chunks SET tier=NULL).`); return; }

  const upd = db.prepare("UPDATE chunks SET tier = 'cold' WHERE file = ? AND (tier IS NULL OR tier != 'cold')");
  let moved = 0;
  const tx = db.transaction(() => {
    for (const f of TOMBSTONE) {
      const n = upd.run(f).changes;
      if (n === 0) console.error(`  --tombstone ${f}: no hot chunks matched (wrong path, or already cold)`);
      moved += n;
    }
  });
  tx();
  console.log(`\nTOMBSTONED: ${moved} chunk(s) across ${TOMBSTONE.length} requested file(s) moved to cold tier (recoverable via includeCold).`);
}

main();
