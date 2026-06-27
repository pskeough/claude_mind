/**
 * LKHS vector store: SQLite + sqlite-vec backend.
 *
 * Replaces the flat vector_store.json (whole-file rewrite on every change, which
 * caused the Windows EPERM rename crash and put the entire store in daemon RAM).
 * SQLite gives incremental row writes, WAL concurrency (many readers + one writer
 * across processes, no custom lock), bounded memory, and metadata columns for
 * per-layer / per-file / recency filtering.
 *
 * Schema:
 *   files       (file PK, file_hash, layer, updated_at)         -- per-file skip cache
 *   chunks      (id PK, file, chunk_index, chunk_hash, layer, text)
 *   vec_chunks  vec0(embedding float[384] distance=cosine)      -- rowid == chunks.id
 *
 * Cosine: vec0 returns distance in [0,2]; similarity = 1 - distance, so the old
 * 0.62 cosine threshold carries over unchanged.
 */
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { dbPath as defaultDbPath } from "./config";

export const DIM = 384;

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex");
}

/** Coarse provenance layer from the vault-relative path. Drives future filtering
 *  (resume-by-project, recency, global vs specific queries). */
export function layerOf(file: string): string {
  const f = file.replace(/\\/g, "/");
  if (f.startsWith("persona_clinical/")) return "persona-clinical"; // quarantined health tier: retrievable only on direct match, never boosted/always-on
  if (f.startsWith("persona/")) return "persona";  // identity layer: deep user model (heavily weighted)
  if (f.startsWith("themes/")) return "theme";     // L3 cross-project theme cards (synthesized)
  if (f.startsWith("cards/")) return "card";       // L2 project-state cards (synthesized)
  if (f.startsWith("journal/")) return "session";
  if (f.startsWith("library/")) return "project";
  if (f.startsWith("wiki/")) return "wiki";
  if (f.startsWith(".claude/memory")) return "memory";
  if (f.startsWith("raw/")) return "raw";
  return "other";
}

function toBlob(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

let _db: Database.Database | null = null;
let _dbPath = "";

export function getDb(dbPath = defaultDbPath()): Database.Database {
  if (_db && _dbPath === dbPath) return _db;
  if (_db) { try { _db.close(); } catch { /* */ } _db = null; }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");      // concurrent readers + 1 writer across processes
  db.pragma("busy_timeout = 15000");    // wait out a concurrent writer instead of erroring
  db.pragma("synchronous = NORMAL");    // WAL-safe, much faster bulk writes
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      file TEXT PRIMARY KEY,
      file_hash TEXT NOT NULL,
      layer TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      file TEXT NOT NULL,
      chunk_index INTEGER,
      chunk_hash TEXT NOT NULL,
      layer TEXT,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${DIM}] distance=cosine);
  `);
  _db = db; _dbPath = dbPath;
  return db;
}

/** Current stored content hash for a file, or null if not indexed. */
export function storedFileHash(file: string): string | null {
  const row = getDb().prepare("SELECT file_hash FROM files WHERE file = ?").get(file) as { file_hash: string } | undefined;
  return row?.file_hash ?? null;
}

/** Content hashes of the chunks currently stored for a file (incremental reuse). */
export function existingChunkHashes(file: string): Set<string> {
  const rows = getDb().prepare("SELECT chunk_hash FROM chunks WHERE file = ?").all(file) as Array<{ chunk_hash: string }>;
  return new Set(rows.map(r => r.chunk_hash));
}

export interface UpsertItem { text: string; hash: string; chunkIndex: number; vector?: number[] }

/**
 * Replace a file's chunk set. Unchanged chunks (matching hash) are kept in place;
 * only genuinely new chunks need a vector and get inserted; removed chunks are
 * deleted. All in one transaction, so a reader never sees a half-updated file.
 */
export function upsertFile(file: string, fileHash: string, items: UpsertItem[]): { inserted: number; deleted: number; kept: number } {
  const db = getDb();
  const layer = layerOf(file);
  const wantHashes = new Set(items.map(i => i.hash));

  const existing = db.prepare("SELECT id, chunk_hash FROM chunks WHERE file = ?").all(file) as Array<{ id: number; chunk_hash: string }>;
  const haveHashes = new Set(existing.map(e => e.chunk_hash));

  const delChunk = db.prepare("DELETE FROM chunks WHERE id = ?");
  const delVec = db.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
  const insChunk = db.prepare("INSERT INTO chunks (file, chunk_index, chunk_hash, layer, text) VALUES (?, ?, ?, ?, ?)");
  const insVec = db.prepare("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
  const upFile = db.prepare(`INSERT INTO files (file, file_hash, layer, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(file) DO UPDATE SET file_hash = excluded.file_hash, layer = excluded.layer, updated_at = excluded.updated_at`);

  let inserted = 0, deleted = 0, kept = 0;
  const tx = db.transaction(() => {
    for (const e of existing) {
      if (!wantHashes.has(e.chunk_hash)) { delChunk.run(e.id); delVec.run(BigInt(e.id)); deleted++; }
      else kept++;
    }
    for (const it of items) {
      if (haveHashes.has(it.hash)) continue;           // unchanged chunk already present
      if (!it.vector) throw new Error(`upsertFile: missing vector for new chunk in ${file}`);
      const info = insChunk.run(file, it.chunkIndex, it.hash, layer, it.text);
      insVec.run(BigInt(info.lastInsertRowid as number), toBlob(it.vector));
      inserted++;
    }
    upFile.run(file, fileHash, layer, new Date().toISOString());
  });
  tx();
  return { inserted, deleted, kept };
}

/** Remove a file's entire footprint (used by migration cleanup / dream pruning). */
export function deleteFile(file: string): void {
  const db = getDb();
  const ids = db.prepare("SELECT id FROM chunks WHERE file = ?").all(file) as Array<{ id: number }>;
  const tx = db.transaction(() => {
    const delVec = db.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
    for (const r of ids) delVec.run(BigInt(r.id));
    db.prepare("DELETE FROM chunks WHERE file = ?").run(file);
    db.prepare("DELETE FROM files WHERE file = ?").run(file);
  });
  tx();
}

export interface Hit { file: string; chunkIndex: number; text: string; score: number; layer: string }

/**
 * K nearest distinct files (best chunk per file). vec0 KNN needs a LIMIT, so we
 * pull a candidate pool by distance, then collapse to one best chunk per file and
 * take the top k. Optional layer filter for scoped queries.
 */
export function knn(queryVec: number[], k = 4, opts: { layers?: string[] } = {}): Hit[] {
  const db = getDb();
  const pool = Math.min(1000, Math.max(k * 50, 200));
  const rows = db.prepare(`
    SELECT c.file AS file, c.chunk_index AS chunkIndex, c.text AS text, c.layer AS layer, m.distance AS distance
    FROM (SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?) m
    JOIN chunks c ON c.id = m.rowid
    ORDER BY m.distance
  `).all(toBlob(queryVec), pool) as Array<{ file: string; chunkIndex: number; text: string; layer: string; distance: number }>;

  const layers = opts.layers && opts.layers.length ? new Set(opts.layers) : null;
  const bestByFile = new Map<string, Hit>();
  for (const r of rows) {
    if (layers && !layers.has(r.layer)) continue;
    if (bestByFile.has(r.file)) continue;            // rows are distance-sorted, first per file is best
    bestByFile.set(r.file, { file: r.file, chunkIndex: r.chunkIndex, text: r.text, layer: r.layer, score: 1 - r.distance });
  }
  return [...bestByFile.values()].slice(0, k);
}

export function stats(): { files: number; chunks: number } {
  const db = getDb();
  const files = (db.prepare("SELECT COUNT(*) AS n FROM files").get() as { n: number }).n;
  const chunks = (db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;
  return { files, chunks };
}

/** Per-layer file + chunk counts, for the status dashboard. */
export function layerStats(): Array<{ layer: string; files: number; chunks: number }> {
  return getDb().prepare(
    "SELECT COALESCE(layer,'other') AS layer, COUNT(DISTINCT file) AS files, COUNT(*) AS chunks FROM chunks GROUP BY layer ORDER BY chunks DESC"
  ).all() as Array<{ layer: string; files: number; chunks: number }>;
}

/** All indexed file keys (for bulk maintenance passes). */
export function allFiles(): string[] {
  return (getDb().prepare("SELECT file FROM files ORDER BY file").all() as Array<{ file: string }>).map(r => r.file);
}

/** Stored chunks for a file, in order (text only; vectors stay in vec_chunks). */
export function fileChunks(file: string): Array<{ text: string; chunkIndex: number }> {
  return getDb().prepare("SELECT text, chunk_index AS chunkIndex FROM chunks WHERE file = ? ORDER BY chunk_index").all(file) as Array<{ text: string; chunkIndex: number }>;
}

export function close(): void { if (_db) { try { _db.close(); } catch { /* */ } _db = null; } }
