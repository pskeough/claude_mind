/**
 * One-time migration: flat vector_store.json -> SQLite (store.ts).
 *
 * Reuses the embeddings already in the JSON (no recompute). Idempotent: re-running
 * upserts each file, so a partial/interrupted run is safe to repeat. Run this once
 * after the JSON store is final (no writer active), then switch the engine/daemon
 * to the SQLite backend.
 *
 *   LKHS_DB_PATH=<dest.db>     (optional) target db; defaults to vector_store.db
 *   LKHS_JSON_PATH=<src.json>  (optional) source; defaults to vector_store.json
 *
 *   tsx migrate-store.ts          # migrate into the real db
 *   tsx migrate-store.ts --dry    # parse + count only, no writes
 */
import * as fs from "fs";
import * as path from "path";
import { upsertFile, stats, sha256, getDb, storedFileHash } from "./store";
import { vaultRoot } from "./config";

const VAULT_ROOT = vaultRoot();
const JSON_PATH = process.env.LKHS_JSON_PATH || path.join(VAULT_ROOT, ".claude", "memory", "vector_store.json");
const DRY = process.argv.includes("--dry");

interface JsonChunk { text: string; vector: number[]; h?: string }
interface JsonRec { filePath: string; hash: string; chunks: JsonChunk[] }

function readJson(): Record<string, JsonRec> {
  // Tolerate a transient read collision if a writer is somehow still active.
  for (let i = 0; i < 5; i++) {
    try {
      const raw = fs.readFileSync(JSON_PATH, "utf-8").trim();
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      if (i === 4) throw e;
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); } catch { /* */ }
    }
  }
  return {};
}

function main() {
  if (!fs.existsSync(JSON_PATH)) { console.error("No JSON store at", JSON_PATH); process.exit(1); }
  console.log(`Reading ${JSON_PATH} ...`);
  const obj = readJson();
  const recs = Object.values(obj);
  console.log(`${recs.length} files in JSON store.`);

  if (DRY) {
    let chunks = 0, dimBad = 0, noVec = 0;
    for (const r of recs) for (const c of r.chunks) {
      chunks++;
      if (!c.vector) noVec++;
      else if (c.vector.length !== 384) dimBad++;
    }
    console.log(`DRY: ${recs.length} files, ${chunks} chunks. bad-dim=${dimBad} missing-vector=${noVec}.`);
    return;
  }

  getDb(); // open/create dest
  let nf = 0, nc = 0, skipped = 0;
  for (const r of recs) {
    if (!r.filePath || !Array.isArray(r.chunks)) continue;
    // Skip files already in the dest: preserves anything a live capture wrote to
    // SQLite during the cutover window, and makes re-runs cheap/idempotent.
    if (storedFileHash(r.filePath)) { skipped++; continue; }
    const items = r.chunks
      .filter(c => Array.isArray(c.vector) && c.vector.length === 384)
      .map((c, i) => ({ text: c.text, hash: c.h || sha256(c.text), chunkIndex: i, vector: c.vector }));
    if (items.length === 0) continue;
    upsertFile(r.filePath, r.hash || sha256(r.chunks.map(c => c.text).join("\n")), items);
    nf++; nc += items.length;
    if (nf % 50 === 0) console.log(`  ${nf}/${recs.length} files (${nc} chunks)...`);
  }
  const s = stats();
  console.log(`\nMigration complete. Imported ${nf} files / ${nc} chunks (skipped ${skipped} already present). DB now holds ${s.files} files, ${s.chunks} chunks.`);
}

main();
