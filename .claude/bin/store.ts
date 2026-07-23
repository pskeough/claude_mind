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
 *   chunks      (id PK, file, chunk_index, chunk_hash, layer, text, meta)
 *   vec_chunks  vec0(embedding float[384] distance=cosine)      -- rowid == chunks.id
 *   fact        (key PK, facet, statement, ..., sensitivity, stmt_hash)  -- bi-temporal atomic facts (P2)
 *   vec_facts   vec0(embedding float[384] distance=cosine)      -- rowid == fact.rowid
 *
 * Cosine: vec0 returns distance in [0,2]; similarity = 1 - distance, so the old
 * 0.62 cosine threshold carries over unchanged.
 */
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { dbPath as defaultDbPath, personaHalfLifeDays, graphExpansion, supersedeCarry, scopeRank, scopeOfChunk } from "./config";

export const DIM = 384;

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex");
}

/** Coarse provenance layer from the vault-relative path. Drives future filtering
 *  (resume-by-project, recency, global vs specific queries). */
export function layerOf(file: string): string {
  const f = file.replace(/\\/g, "/");
  if (f.startsWith("skills/")) return "skill";     // synthetic namespace: SKILL.md name+description, for the semantic skill router
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
  migrateSchema(db); // P2: additive, nullable, idempotent (facts + chunk meta)
  _db = db; _dbPath = dbPath;
  return db;
}

/**
 * P2 schema evolution (fact embedding). Additive + nullable + idempotent:
 *   - chunks.meta          nullable JSON TEXT ({valid_at, invalid_at, source_date} when known;
 *                          NULL = always valid, no decay). Projected through knn.
 *   - fact                 bi-temporal atomic facts promoted from persona_facts.jsonl.
 *                          key = rebuild-stable sha1 (persona-facts.ts factKey). stmt_hash is the
 *                          embed-skip cache (hash of context+statement, mirroring chunk_hash).
 *   - vec_facts            embeddings for fact statements, same 384-dim bge-small space as prose
 *                          so facts and chunks pool in one retrieval pass. rowid == fact.rowid.
 * Safe to call on every open (getDb does); every step checks existence first.
 * Returns what it actually changed so migrate-store.ts --schema can verify idempotency.
 */
export function migrateSchema(db: Database.Database): { addedChunkMeta: boolean; createdFact: boolean; createdVecFacts: boolean; createdFtsChunks: boolean; createdFtsFacts: boolean; addedFactScope: boolean } {
  const out = { addedChunkMeta: false, createdFact: false, createdVecFacts: false, createdFtsChunks: false, createdFtsFacts: false, addedFactScope: false };

  const chunkCols = db.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string }>;
  // P6 hot/cold tiering: NULL/absent = hot (default pool); 'cold' = archived out of the
  // default candidate pool, reachable only via includeCold (explicit deep search).
  // Reversible per row (UPDATE tier = NULL); promotion decided by promote-tier.ts.
  if (!chunkCols.some(c => c.name === "tier")) db.exec("ALTER TABLE chunks ADD COLUMN tier TEXT");
  if (!chunkCols.some(c => c.name === "meta")) {
    db.exec("ALTER TABLE chunks ADD COLUMN meta TEXT"); // nullable JSON; NULL = no temporal metadata
    out.addedChunkMeta = true;
  }

  const hasTable = (name: string) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name);

  if (!hasTable("fact")) {
    db.exec(`
      CREATE TABLE fact (
        key         TEXT PRIMARY KEY,
        facet       TEXT,
        statement   TEXT NOT NULL,
        subject_id  TEXT,
        relation    TEXT,
        object_id   TEXT,
        t_event     TEXT,
        valid_at    TEXT,
        invalid_at  TEXT,
        confidence  REAL,
        sensitivity TEXT,
        provenance  TEXT,
        supersedes  TEXT,
        created     TEXT,
        stmt_hash   TEXT,
        scope       TEXT
      );
      CREATE INDEX idx_fact_facet ON fact(facet);
      CREATE INDEX idx_fact_sensitivity ON fact(sensitivity);
    `);
    out.createdFact = true;
  } else {
    // Synthesis P1: audience scope on facts (nullable; NULL = personal via scopeRank).
    // Chunk scope is DERIVED from file/layer (config.scopeOfChunk), so chunks need no column.
    const factCols = db.prepare("PRAGMA table_info(fact)").all() as Array<{ name: string }>;
    if (!factCols.some(c => c.name === "scope")) {
      db.exec("ALTER TABLE fact ADD COLUMN scope TEXT");
      out.addedFactScope = true;
    }
  }
  if (!hasTable("vec_facts")) {
    db.exec(`CREATE VIRTUAL TABLE vec_facts USING vec0(embedding float[${DIM}] distance=cosine)`);
    out.createdVecFacts = true;
  }

  // P4a: lexical (FTS5) indexes over prose chunks and fact statements, fused with the
  // vector pool via RRF at query time. External-content tables (no text duplication);
  // triggers keep them in sync with every write path (upsertFile/deleteFile/upsertFact/
  // deleteFact all go through plain INSERT/UPDATE/DELETE on the content tables). The
  // one-time 'rebuild' right after creation backfills existing rows, so this is
  // additive + idempotent: on an already-migrated store nothing here runs.
  if (!hasTable("fts_chunks")) {
    db.exec(`
      CREATE VIRTUAL TABLE fts_chunks USING fts5(text, content='chunks', content_rowid='id', tokenize='porter unicode61');
      CREATE TRIGGER chunks_fts_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO fts_chunks(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER chunks_fts_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO fts_chunks(fts_chunks, rowid, text) VALUES ('delete', old.id, old.text);
      END;
      CREATE TRIGGER chunks_fts_au AFTER UPDATE OF text ON chunks BEGIN
        INSERT INTO fts_chunks(fts_chunks, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO fts_chunks(rowid, text) VALUES (new.id, new.text);
      END;
      INSERT INTO fts_chunks(fts_chunks) VALUES ('rebuild');
    `);
    out.createdFtsChunks = true;
  }
  if (!hasTable("fts_facts")) {
    db.exec(`
      CREATE VIRTUAL TABLE fts_facts USING fts5(statement, content='fact', content_rowid='rowid', tokenize='porter unicode61');
      CREATE TRIGGER fact_fts_ai AFTER INSERT ON fact BEGIN
        INSERT INTO fts_facts(rowid, statement) VALUES (new.rowid, new.statement);
      END;
      CREATE TRIGGER fact_fts_ad AFTER DELETE ON fact BEGIN
        INSERT INTO fts_facts(fts_facts, rowid, statement) VALUES ('delete', old.rowid, old.statement);
      END;
      CREATE TRIGGER fact_fts_au AFTER UPDATE OF statement ON fact BEGIN
        INSERT INTO fts_facts(fts_facts, rowid, statement) VALUES ('delete', old.rowid, old.statement);
        INSERT INTO fts_facts(rowid, statement) VALUES (new.rowid, new.statement);
      END;
      INSERT INTO fts_facts(fts_facts) VALUES ('rebuild');
    `);
    out.createdFtsFacts = true;
  }
  return out;
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

export interface UpsertItem {
  text: string; hash: string; chunkIndex: number; vector?: number[];
  /** optional JSON string ({valid_at, invalid_at, source_date}) — temporal metadata for the chunk (P3) */
  meta?: string | null;
}

/**
 * Replace a file's chunk set. Unchanged chunks (matching hash) are kept in place;
 * only genuinely new chunks need a vector and get inserted; removed chunks are
 * deleted. All in one transaction, so a reader never sees a half-updated file.
 */
export function upsertFile(file: string, fileHash: string, items: UpsertItem[]): { inserted: number; deleted: number; kept: number } {
  const db = getDb();
  const layer = layerOf(file);
  const wantHashes = new Set(items.map(i => i.hash));

  const existing = db.prepare("SELECT id, chunk_hash, meta FROM chunks WHERE file = ?").all(file) as Array<{ id: number; chunk_hash: string; meta: string | null }>;
  const haveHashes = new Set(existing.map(e => e.chunk_hash));
  const existingByHash = new Map(existing.map(e => [e.chunk_hash, e]));

  const delChunk = db.prepare("DELETE FROM chunks WHERE id = ?");
  const delVec = db.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
  const insChunk = db.prepare("INSERT INTO chunks (file, chunk_index, chunk_hash, layer, text, meta) VALUES (?, ?, ?, ?, ?, ?)");
  const updMeta = db.prepare("UPDATE chunks SET meta = ? WHERE id = ?");
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
      if (haveHashes.has(it.hash)) {                   // unchanged chunk already present
        // P3: refresh temporal meta on kept chunks (meta is not part of the hash, so a
        // newly derived source_date must not require a re-embed to land).
        const prev = existingByHash.get(it.hash)!;
        const want = it.meta ?? null;
        if (want !== (prev.meta ?? null)) updMeta.run(want, prev.id);
        continue;
      }
      if (!it.vector) throw new Error(`upsertFile: missing vector for new chunk in ${file}`);
      const info = insChunk.run(file, it.chunkIndex, it.hash, layer, it.text, it.meta ?? null);
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

// ---- temporal weighting (P3: decay + confidence at the vector layer) ---------
//
// Ranking multiplier applied to cosine similarity for facts (and dated prose):
//     score = cosine * decayBlend(age) * confBlend(confidence)
//
// TUNING NOTE (why NOT the doc's raw `cosine * exp(-age/HL)`): facts and prose are
// pooled and ranked together, but only facts carry confidence and most persona facts
// share one build date, so any multiplier that is < 1 for a *typical* fact demotes
// the whole fact pool beneath undated prose and craters recall@k (measured: a uniform
// 0.94 confidence factor dropped recall 83%->56%). The blends are therefore designed
// to be NEUTRAL for the median fact and act only as an ORDERING signal between facts:
//
//   decayBlend: 1.0 at age 0, decaying to a DECAY_FLOOR of 0.85 as age -> inf
//     (halfLife ~540d). Recent/current content is unpenalized; only genuinely OLD
//     dated content is demoted, which is the point (newer state outranks stale state).
//   confBlend: CENTERED on the corpus-median confidence (0.7) and CAPPED at 1.0. A
//     median-or-higher-confidence fact keeps its cosine exactly (neutral, so facts are
//     never OVER-boosted beyond factBoost — an earlier >1 bump let a fact outrank an
//     exact-match doc and broke the smoke test); only sub-median-confidence facts get a
//     gentle demotion toward CONF_MIN. This preserves recall (typical/high-confidence
//     facts unpenalized) while still letting confidence break ties: a low-confidence
//     fact ranks below an equally-similar higher-confidence one.
//
// Validity (invalid_at) remains a HARD filter — exclusion, not decay, removes superseded
// facts. Decay/confidence only reorder what survives the filter.
const DECAY_FLOOR = 0.85;   // infinitely old but still-valid content keeps 85% of cosine
const CONF_REF = 0.7;       // corpus-median confidence; maps to the neutral 1.0 ceiling
const CONF_GAIN = 0.2;      // slope below the median: conf 0.5 -> 0.96, conf 0.2 -> 0.90
const CONF_MIN = 0.90, CONF_MAX = 1.0;  // capped at 1.0: facts are never boosted past cosine here

/** Parse a loose ISO date ("2024" | "2024-05" | "2024-05-12[...]") to UTC ms; NaN if absent/bad.
 *  Same semantics as recallPersonaFacts so all temporal filters agree. */
export function factDateMs(s?: string | null): number {
  if (!s) return NaN;
  const m = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return NaN;
  return Date.UTC(+m[1]!, m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1);
}

/** Recency-decay multiplier in [DECAY_FLOOR, 1]. Undated (NaN) or future dates = 1 (no decay).
 *  halfLifeDays defaults to the persona half-life; callers pass a shorter one for
 *  volatile layers (P1: session chunks decay on ~sessionHalfLifeDays). */
export function decayBlend(dateStr: string | null | undefined, nowMs = Date.now(), halfLifeDays = personaHalfLifeDays()): number {
  const t = factDateMs(dateStr);
  if (isNaN(t)) return 1;
  const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
  return DECAY_FLOOR + (1 - DECAY_FLOOR) * Math.exp(-ageDays / halfLifeDays);
}

/** Best date from a chunk's meta JSON string (valid_at, else source_date); null if undated. */
export function metaDate(meta: string | null | undefined): string | null {
  const m = parseMeta(meta);
  return m ? (m.valid_at || m.source_date || null) : null;
}

/** Confidence multiplier centered on CONF_REF (0.7 -> 1.0), clamped to [CONF_MIN, CONF_MAX].
 *  Missing/invalid confidence is treated as the median, i.e. neutral. */
export function confBlend(confidence: number | null | undefined): number {
  const c = typeof confidence === "number" && isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : CONF_REF;
  return Math.min(CONF_MAX, Math.max(CONF_MIN, 1 + CONF_GAIN * (c - CONF_REF)));
}

/** Parsed chunk meta ({valid_at, invalid_at, source_date}); null when absent/unparseable. */
function parseMeta(meta: string | null | undefined): { valid_at?: string; invalid_at?: string; source_date?: string } | null {
  if (!meta) return null;
  try { const m = JSON.parse(meta); return m && typeof m === "object" ? m : null; } catch { return null; }
}

export interface Hit {
  file: string; chunkIndex: number; text: string; score: number; layer: string;
  /** nullable JSON string ({valid_at, invalid_at, source_date}); null for undated prose (= always valid, no decay) */
  meta?: string | null;
}

/**
 * K nearest distinct files (best chunk per file). vec0 KNN needs a LIMIT, so we
 * pull a candidate pool by distance, then collapse to one best chunk per file and
 * take the top k. Optional layer filter for scoped queries.
 */
export function knn(queryVec: number[], k = 4, opts: { layers?: string[]; exclude?: string[]; includeCold?: boolean; ceiling?: number } = {}): Hit[] {
  const db = getDb();
  const pool = Math.min(1000, Math.max(k * 50, 200));
  const rows = db.prepare(`
    SELECT c.file AS file, c.chunk_index AS chunkIndex, c.text AS text, c.layer AS layer, c.meta AS meta, c.tier AS tier, m.distance AS distance
    FROM (SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?) m
    JOIN chunks c ON c.id = m.rowid
    ORDER BY m.distance
  `).all(toBlob(queryVec), pool) as Array<{ file: string; chunkIndex: number; text: string; layer: string; meta: string | null; tier: string | null; distance: number }>;

  const layers = opts.layers && opts.layers.length ? new Set(opts.layers) : null;
  const excluded = opts.exclude && opts.exclude.length ? new Set(opts.exclude) : null;
  const nowMs = Date.now();
  const bestByFile = new Map<string, Hit>();
  for (const r of rows) {
    if (!opts.includeCold && r.tier === "cold") continue; // P6: archived out of the hot pool
    if (isSealed(r.file)) continue;                        // P10: sealed never auto-surfaces
    if (layers && !layers.has(r.layer)) continue;
    if (excluded && excluded.has(r.layer)) continue;
    // Synthesis P1: profile scope ceiling — chunks below the active profile's ceiling
    // never enter the candidate pool (scope derived from file/layer, see config).
    if (opts.ceiling !== undefined && scopeRank(scopeOfChunk(r.file, r.layer)) < opts.ceiling) continue;
    // P3 prose temporal: chunks whose meta carries a real date get validity + decay
    // at the vector layer, exactly like facts. Undated prose (meta NULL / no date)
    // is untouched — no fabricated dates, no decay.
    const m = parseMeta(r.meta);
    let score = 1 - r.distance;
    if (m) {
      const inv = factDateMs(m.invalid_at);
      if (!isNaN(inv) && inv <= nowMs) continue;              // dated prose past its validity: hard filter
      score *= decayBlend(m.valid_at || m.source_date, nowMs); // dated prose decays (ordering signal only)
    }
    const prev = bestByFile.get(r.file);
    if (!prev || score > prev.score)
      bestByFile.set(r.file, { file: r.file, chunkIndex: r.chunkIndex, text: r.text, layer: r.layer, meta: r.meta ?? null, score });
  }
  return [...bestByFile.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Exhaustive cosine over a single (small) layer. knn()'s layer filter is applied
 * AFTER the vec0 KNN LIMIT, so a tiny layer (e.g. `skill`, a few rows in a store of
 * tens of thousands) is invisible to it: its rows never enter the distance-bounded
 * candidate pool. This brute-forces cosine over just that layer's stored vectors, so
 * a handful of skills are always scored. Cheap because the layer is small.
 */
export function layerKnn(queryVec: number[], layer: string, k = 8): Hit[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.file AS file, c.chunk_index AS chunkIndex, c.text AS text, c.layer AS layer, v.embedding AS emb
    FROM chunks c JOIN vec_chunks v ON v.rowid = c.id
    WHERE c.layer = ?
  `).all(layer) as Array<{ file: string; chunkIndex: number; text: string; layer: string; emb: Uint8Array }>;

  let qn = 0; for (const x of queryVec) qn += x * x; qn = Math.sqrt(qn) || 1;
  const bestByFile = new Map<string, Hit>();
  for (const r of rows) {
    const buf = r.emb as any as Buffer;
    const vec = new Float32Array(buf.buffer, buf.byteOffset, DIM);
    let dot = 0, vn = 0;
    for (let i = 0; i < DIM; i++) { const c = vec[i]!; dot += queryVec[i]! * c; vn += c * c; }
    const score = dot / (qn * (Math.sqrt(vn) || 1));
    const prev = bestByFile.get(r.file);
    if (!prev || score > prev.score) bestByFile.set(r.file, { file: r.file, chunkIndex: r.chunkIndex, text: r.text, layer: r.layer, score });
  }
  return [...bestByFile.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

// ---- fact store (P2: embedded bi-temporal atomic facts) ----------------------

export interface FactRow {
  key: string; facet: string; statement: string;
  subject_id?: string | null; relation?: string | null; object_id?: string | null;
  t_event?: string | null; valid_at?: string | null; invalid_at?: string | null;
  confidence?: number | null; sensitivity?: string | null;
  provenance?: string | null;   // JSON array of sources
  supersedes?: string | null;   // JSON array of keys
  created?: string | null;
  stmt_hash: string;            // hash-skip cache: sha256(context + " " + statement)
  scope?: string | null;        // audience scope (config.SCOPE_ORDER); NULL = personal
}

export interface FactHit {
  key: string; facet: string; statement: string; score: number;
  sensitivity: string | null; confidence: number | null;
  t_event: string | null; valid_at: string | null; invalid_at: string | null;
  scope?: string | null;
}

/** key -> stmt_hash for every stored fact (drives the ingest hash-skip). */
export function factHashes(): Map<string, string> {
  const rows = getDb().prepare("SELECT key, stmt_hash FROM fact").all() as Array<{ key: string; stmt_hash: string }>;
  return new Map(rows.map(r => [r.key, r.stmt_hash]));
}

/**
 * Insert or update one fact. A vector is required when the fact is new or its
 * stmt_hash changed (statement/context drift => stale embedding); an unchanged
 * stmt_hash updates the scalar columns only (temporal state, confidence) and
 * keeps the stored vector.
 */
export function upsertFact(row: FactRow, vector?: number[]): "inserted" | "reembedded" | "updated" {
  const db = getDb();
  const existing = db.prepare("SELECT rowid AS rid, stmt_hash FROM fact WHERE key = ?").get(row.key) as { rid: number; stmt_hash: string } | undefined;
  const cols = [row.facet, row.statement, row.subject_id ?? null, row.relation ?? null, row.object_id ?? null,
    row.t_event ?? null, row.valid_at ?? null, row.invalid_at ?? null, row.confidence ?? null,
    row.sensitivity ?? null, row.provenance ?? null, row.supersedes ?? null, row.created ?? null, row.stmt_hash,
    row.scope ?? null];

  if (!existing) {
    if (!vector) throw new Error(`upsertFact: missing vector for new fact ${row.key}`);
    const tx = db.transaction(() => {
      const info = db.prepare(`INSERT INTO fact (key, facet, statement, subject_id, relation, object_id, t_event,
        valid_at, invalid_at, confidence, sensitivity, provenance, supersedes, created, stmt_hash, scope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(row.key, ...cols);
      db.prepare("INSERT INTO vec_facts (rowid, embedding) VALUES (?, ?)").run(BigInt(info.lastInsertRowid as number), toBlob(vector));
    });
    tx();
    return "inserted";
  }

  const changed = existing.stmt_hash !== row.stmt_hash;
  if (changed && !vector) throw new Error(`upsertFact: statement changed but no vector for fact ${row.key}`);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE fact SET facet=?, statement=?, subject_id=?, relation=?, object_id=?, t_event=?,
      valid_at=?, invalid_at=?, confidence=?, sensitivity=?, provenance=?, supersedes=?, created=?, stmt_hash=?, scope=?
      WHERE key = ?`).run(...cols, row.key);
    if (changed) {
      db.prepare("DELETE FROM vec_facts WHERE rowid = ?").run(BigInt(existing.rid));
      db.prepare("INSERT INTO vec_facts (rowid, embedding) VALUES (?, ?)").run(BigInt(existing.rid), toBlob(vector!));
    }
  });
  tx();
  return changed ? "reembedded" : "updated";
}

/** Remove a fact and its vector (used when a key disappears from the jsonl). */
export function deleteFact(key: string): void {
  const db = getDb();
  const row = db.prepare("SELECT rowid AS rid FROM fact WHERE key = ?").get(key) as { rid: number } | undefined;
  if (!row) return;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM vec_facts WHERE rowid = ?").run(BigInt(row.rid));
    db.prepare("DELETE FROM fact WHERE key = ?").run(key);
  });
  tx();
}

export function factStats(): { total: number; clinical: number } {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) AS n FROM fact").get() as { n: number }).n;
  const clinical = (db.prepare("SELECT COUNT(*) AS n FROM fact WHERE sensitivity = 'clinical'").get() as { n: number }).n;
  return { total, clinical };
}

/**
 * K nearest facts by statement embedding. DEFAULTS are the quarantine + validity
 * contract: clinical facts are excluded unless includeClinical, and facts whose
 * invalid_at has passed (relative to asOf, default today) are excluded unless
 * includeSuperseded. The validity filter lives here, at the vector layer, so
 * superseded facts cannot pollute recall anywhere facts are pooled (daemon gate,
 * queryVectorStore, MCP).
 *
 * P3 ranking: surviving facts are RANKED by cosine * decayBlend * confBlend
 * (age from valid_at || t_event || created; see the tuning note on the blend
 * constants above). Because every caller (daemon gate, vector-query, MCP) goes
 * through this function, the live gate honors validity + decay + confidence,
 * not just recall_persona.
 */
/** Reverse supersession map (superseded key -> superseding FactRow-lite), built from
 *  the fact table's `supersedes` JSON arrays. Small (tens of rows), rebuilt per call. */
function supersederIndex(db: Database.Database): Map<string, { key: string; facet: string; statement: string; sensitivity: string | null; confidence: number | null; t_event: string | null; valid_at: string | null; invalid_at: string | null; created: string | null; scope: string | null }> {
  const out = new Map();
  const rows = db.prepare(`SELECT key, facet, statement, sensitivity, confidence, t_event, valid_at, invalid_at, created, scope, supersedes
    FROM fact WHERE supersedes IS NOT NULL AND supersedes != '[]'`).all() as any[];
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.supersedes);
      if (Array.isArray(arr)) for (const k of arr) out.set(String(k), r);
    } catch { /* malformed supersedes: skip */ }
  }
  return out;
}

/** Effective scope rank of a fact row: clinical sensitivity is clinical scope
 *  regardless of the scope column (belt and braces); otherwise the judged scope,
 *  with NULL = personal (fail-closed default). */
function factScopeRank(r: { sensitivity: string | null; scope?: string | null }): number {
  return r.sensitivity === "clinical" ? scopeRank("clinical") : scopeRank(r.scope);
}

export function factKnn(queryVec: number[], k = 8, opts: { asOf?: string; includeSuperseded?: boolean; includeClinical?: boolean; expandSupersession?: boolean; ceiling?: number } = {}): FactHit[] {
  const db = getDb();
  const pool = Math.min(500, Math.max(k * 20, 100));
  let rows: Array<{ key: string; facet: string; statement: string; sensitivity: string | null; confidence: number | null; t_event: string | null; valid_at: string | null; invalid_at: string | null; created: string | null; scope: string | null; distance: number }>;
  try {
    rows = db.prepare(`
      SELECT f.key AS key, f.facet AS facet, f.statement AS statement, f.sensitivity AS sensitivity,
             f.confidence AS confidence, f.t_event AS t_event, f.valid_at AS valid_at, f.invalid_at AS invalid_at,
             f.created AS created, f.scope AS scope, m.distance AS distance
      FROM (SELECT rowid, distance FROM vec_facts WHERE embedding MATCH ? ORDER BY distance LIMIT ?) m
      JOIN fact f ON f.rowid = m.rowid
      ORDER BY m.distance
    `).all(toBlob(queryVec), pool) as any;
  } catch {
    return []; // empty vec_facts (facts never ingested) must not break prose retrieval
  }

  const refMs = factDateMs(opts.asOf || new Date().toISOString().slice(0, 10));
  const out: FactHit[] = [];
  // P4b graph expansion (supersession-chain forwarding): when an INVALIDATED fact
  // matches the query semantically, the CURRENT fact that superseded it is the live
  // answer to the same question — but often a semantically weaker match (e.g. "am I
  // partnered?" matches a stale relationship fact strongly and the current
  // "broke up" successor weakly). Forward the stale hit's cosine (attenuated by
  // supersedeCarry) to its superseder, so the current state surfaces at roughly the
  // rank the stale fact earned. Exclusion of the stale fact itself is unchanged.
  const expand = (opts.expandSupersession ?? graphExpansion()) && !opts.includeSuperseded;
  const supIndex = expand ? supersederIndex(db) : null;
  const carry = supersedeCarry();
  const forwarded = new Map<string, { row: any; score: number }>();  // superseder key -> best forwarded candidate
  for (const r of rows) {
    if (!opts.includeClinical && r.sensitivity === "clinical") continue;   // quarantine
    if (opts.ceiling !== undefined && factScopeRank(r) < opts.ceiling) continue; // scope ceiling
    if (!opts.includeSuperseded) {
      const inv = factDateMs(r.invalid_at);
      if (!isNaN(inv) && inv <= refMs) {                                   // no-longer-valid
        if (supIndex) {
          // Walk the supersession chain forward to the first still-valid fact (cap
          // the walk so a malformed cycle cannot hang retrieval).
          let cur: any = supIndex.get(r.key);
          for (let hop = 0; cur && hop < 5; hop++) {
            const cinv = factDateMs(cur.invalid_at);
            if (isNaN(cinv) || cinv > refMs) break;                        // current = valid
            cur = supIndex.get(cur.key);
          }
          if (cur && (opts.includeClinical || cur.sensitivity !== "clinical")
            && !(opts.ceiling !== undefined && factScopeRank(cur) < opts.ceiling)) {  // forwarded fact honors the ceiling too
            const cinv = factDateMs(cur.invalid_at);
            if (isNaN(cinv) || cinv > refMs) {
              const score = (1 - r.distance) * carry * decayBlend(cur.created, refMs) * confBlend(cur.confidence);
              const prev = forwarded.get(cur.key);
              if (!prev || score > prev.score) forwarded.set(cur.key, { row: cur, score });
            }
          }
        }
        continue;
      }
      if (opts.asOf) { const va = factDateMs(r.valid_at); if (!isNaN(va) && va > refMs) continue; } // not-yet-valid at as_of
    }
    // P3: rank survivors by cosine * decay * confidence, not raw distance order.
    //
    // Decay anchor = `created` (when the fact entered the store = recency of KNOWLEDGE),
    // deliberately NOT valid_at/t_event. valid_at on persona facts is the described
    // EVENT date, and many still-valid facts describe old events (aphantasia since 2023,
    // a 2020 swim result, a 2023 lab experiment) that are permanently true — decaying
    // them by event-age buries the correct answer and regressed recall 87%->62% in
    // testing. Recency-of-knowledge is also the semantically correct decay signal
    // (Zep/Graphiti favor recently-LEARNED facts) and becomes a live ordering lever
    // once facts are ingested continuously (P5); today `created` is ~uniform so fact
    // decay is near-neutral by design. Supersession is handled by the hard invalid_at
    // filter above; confidence gives the intra-fact ordering (current > tentative).
    const cos = 1 - r.distance;
    const score = cos * decayBlend(r.created, refMs) * confBlend(r.confidence);
    out.push({ key: r.key, facet: r.facet, statement: r.statement, sensitivity: r.sensitivity, confidence: r.confidence, t_event: r.t_event, valid_at: r.valid_at, invalid_at: r.invalid_at, scope: r.scope ?? null, score });
  }
  // Merge forwarded supersession candidates: a superseder already in the pool keeps
  // the better of its own score and the forwarded one; otherwise it joins the pool.
  for (const [key, f] of forwarded) {
    const existing = out.find(h => h.key === key);
    if (existing) { if (f.score > existing.score) existing.score = f.score; continue; }
    out.push({ key, facet: f.row.facet, statement: f.row.statement, sensitivity: f.row.sensitivity, confidence: f.row.confidence, t_event: f.row.t_event, valid_at: f.row.valid_at, invalid_at: f.row.invalid_at, scope: f.row.scope ?? null, score: f.score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}

// ---- P4a: lexical recall (FTS5) + RRF hybrid fusion ---------------------------
//
// Dense vectors miss exact names / numbers / rare tokens ("BM25 is a feature, not
// a baseline"). The FTS5 indexes give a second, lexical ranked list over the SAME
// row space, and hybridSearch fuses the lists with Reciprocal Rank Fusion (k=60),
// the standard score-free fusion. Lexical hits are scored with their TRUE cosine
// (embedding fetched by rowid) so every downstream consumer keeps one score scale.

const FTS_STOP = new Set(("a an the and or but of to in on at for from with by as is are was were be been has have had " +
  "his her its their this that these those it he she they i you we me my am not no do does did will would can could what " +
  "when where which who how why about into over these days now currently").split(" "));

/** Build a safe FTS5 MATCH expression: quoted content tokens OR-ed (bm25's idf does
 *  the weighting — rare tokens dominate). Null when the query has no usable tokens. */
export function ftsMatchExpr(q: string): string | null {
  const toks = [...new Set((q.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(t => t.length >= 2 && !FTS_STOP.has(t)))].slice(0, 16);
  if (toks.length === 0) return null;
  return toks.map(t => `"${t}"`).join(" OR ");
}

/** True cosine of the query vector vs a stored embedding row (point lookup). */
function cosineToRow(db: Database.Database, vecTable: "vec_chunks" | "vec_facts", rowid: number, queryVec: number[], qNorm: number): number {
  const row = db.prepare(`SELECT embedding AS emb FROM ${vecTable} WHERE rowid = ?`).get(BigInt(rowid)) as { emb: Buffer } | undefined;
  if (!row) return 0;
  const vec = new Float32Array(row.emb.buffer, row.emb.byteOffset, DIM);
  let dot = 0, vn = 0;
  for (let i = 0; i < DIM; i++) { const c = vec[i]!; dot += queryVec[i]! * c; vn += c * c; }
  return dot / (qNorm * (Math.sqrt(vn) || 1));
}

function vecNorm(v: number[]): number { let n = 0; for (const x of v) n += x * x; return Math.sqrt(n) || 1; }

/** Lexical (BM25) top-k prose chunks, best chunk per file, in bm25 order. Applies the
 *  same layer/meta-validity/decay contract as knn; score is the true cosine so hits
 *  are comparable with the dense pool. Returns [] if FTS is unavailable or query empty. */
export function lexicalKnn(queryText: string, k = 8, opts: { layers?: string[]; exclude?: string[]; includeCold?: boolean; ceiling?: number } = {}, queryVec?: number[]): Hit[] {
  const db = getDb();
  const match = ftsMatchExpr(queryText);
  if (!match) return [];
  let rows: Array<{ id: number; file: string; chunkIndex: number; text: string; layer: string; meta: string | null; tier: string | null; rank: number }>;
  try {
    rows = db.prepare(`
      SELECT c.id AS id, c.file AS file, c.chunk_index AS chunkIndex, c.text AS text, c.layer AS layer, c.meta AS meta, c.tier AS tier,
             bm25(fts_chunks) AS rank
      FROM fts_chunks JOIN chunks c ON c.id = fts_chunks.rowid
      WHERE fts_chunks MATCH ?
      ORDER BY rank LIMIT ?
    `).all(match, Math.max(k * 10, 50)) as any;
  } catch { return []; } // FTS missing/corrupt must never break retrieval
  const layers = opts.layers && opts.layers.length ? new Set(opts.layers) : null;
  const excluded = opts.exclude && opts.exclude.length ? new Set(opts.exclude) : null;
  const nowMs = Date.now();
  const qNorm = queryVec ? vecNorm(queryVec) : 1;
  const bestByFile = new Map<string, { hit: Hit; rank: number }>();
  for (const r of rows) {
    if (!opts.includeCold && r.tier === "cold") continue; // P6: same tier contract as knn
    if (isSealed(r.file)) continue;                        // P10: same seal contract as knn
    if (layers && !layers.has(r.layer)) continue;
    if (excluded && excluded.has(r.layer)) continue;
    if (opts.ceiling !== undefined && scopeRank(scopeOfChunk(r.file, r.layer)) < opts.ceiling) continue; // same scope contract as knn
    const m = parseMeta(r.meta);
    let decay = 1;
    if (m) {
      const inv = factDateMs(m.invalid_at);
      if (!isNaN(inv) && inv <= nowMs) continue; // dated prose past its validity: same hard filter as knn
      decay = decayBlend(m.valid_at || m.source_date, nowMs);
    }
    if (bestByFile.has(r.file)) continue; // rows arrive in bm25 order; first per file is best
    const score = (queryVec ? cosineToRow(db, "vec_chunks", r.id, queryVec, qNorm) : 0) * decay;
    bestByFile.set(r.file, { hit: { file: r.file, chunkIndex: r.chunkIndex, text: r.text, layer: r.layer, meta: r.meta ?? null, score }, rank: r.rank });
  }
  return [...bestByFile.values()].sort((a, b) => a.rank - b.rank).slice(0, k).map(x => x.hit);
}

/** Lexical (BM25) top-k facts, in bm25 order, honoring EXACTLY the factKnn contract:
 *  clinical quarantine and invalid_at validity are enforced here too, so the lexical
 *  path can never leak what the dense path excludes. Score = cosine * decay * conf. */
export function lexicalFactKnn(queryText: string, k = 8, opts: { asOf?: string; includeSuperseded?: boolean; includeClinical?: boolean; ceiling?: number } = {}, queryVec?: number[]): FactHit[] {
  const db = getDb();
  const match = ftsMatchExpr(queryText);
  if (!match) return [];
  let rows: Array<{ rid: number; key: string; facet: string; statement: string; sensitivity: string | null; confidence: number | null; t_event: string | null; valid_at: string | null; invalid_at: string | null; created: string | null; scope: string | null; rank: number }>;
  try {
    rows = db.prepare(`
      SELECT f.rowid AS rid, f.key AS key, f.facet AS facet, f.statement AS statement, f.sensitivity AS sensitivity,
             f.confidence AS confidence, f.t_event AS t_event, f.valid_at AS valid_at, f.invalid_at AS invalid_at,
             f.created AS created, f.scope AS scope, bm25(fts_facts) AS rank
      FROM fts_facts JOIN fact f ON f.rowid = fts_facts.rowid
      WHERE fts_facts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(match, Math.max(k * 10, 50)) as any;
  } catch { return []; }
  const refMs = factDateMs(opts.asOf || new Date().toISOString().slice(0, 10));
  const qNorm = queryVec ? vecNorm(queryVec) : 1;
  const out: FactHit[] = [];
  for (const r of rows) {
    if (!opts.includeClinical && r.sensitivity === "clinical") continue;   // quarantine (same as factKnn)
    if (opts.ceiling !== undefined && factScopeRank(r) < opts.ceiling) continue; // scope ceiling (same as factKnn)
    if (!opts.includeSuperseded) {
      const inv = factDateMs(r.invalid_at);
      if (!isNaN(inv) && inv <= refMs) continue;
      if (opts.asOf) { const va = factDateMs(r.valid_at); if (!isNaN(va) && va > refMs) continue; }
    }
    const cos = queryVec ? cosineToRow(db, "vec_facts", r.rid, queryVec, qNorm) : 0;
    out.push({ key: r.key, facet: r.facet, statement: r.statement, sensitivity: r.sensitivity, confidence: r.confidence, t_event: r.t_event, valid_at: r.valid_at, invalid_at: r.invalid_at, scope: r.scope ?? null, score: cos * decayBlend(r.created, refMs) * confBlend(r.confidence) });
    if (out.length >= k) break; // rows are in bm25 order
  }
  return out;
}

/** Reciprocal Rank Fusion over ranked candidate lists: rrf(id) = sum 1/(k + rank).
 *  Score-free (rank-based), so cosine and bm25 lists fuse without calibration. */
export function rrfFuse<T>(lists: T[][], idOf: (t: T) => string, k = 60): Array<{ item: T; rrf: number }> {
  const acc = new Map<string, { item: T; rrf: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const id = idOf(item);
      const inc = 1 / (k + rank + 1);
      const prev = acc.get(id);
      if (prev) prev.rrf += inc;
      else acc.set(id, { item, rrf: inc });
    });
  }
  return [...acc.values()].sort((a, b) => b.rrf - a.rrf);
}

/** A pooled retrieval candidate: prose chunk or embedded fact, one score scale. */
export interface PoolHit { file: string; text: string; score: number; layer: string; factKey?: string; meta?: string | null; scope?: string | null }

/**
 * P4a hybrid retrieval: the shared prose+fact pool used by the daemon gate and
 * queryVectorStore. Dense list = the pre-P4 ranking exactly (knn prose + factKnn
 * facts with factBoost, sorted by score); when `lexical` is on, FTS5 prose/fact
 * lists are fused in via RRF. With lexical off (or FTS empty) the output is
 * identical to the pre-P4 behavior.
 */
export function hybridSearch(queryVec: number[], queryText: string, k: number,
  opts: { exclude?: string[]; factK?: number; factBoost?: number; lexical?: boolean; rrfK?: number; ceiling?: number } = {}): PoolHit[] {
  const boost = opts.factBoost ?? 0;
  const factK = opts.factK ?? Math.min(k, 8);
  const lexical = opts.lexical !== false;
  const ceil = opts.ceiling;
  // With fusion on, the dense pool is pulled WIDER than k (the semantic margin,
  // ranks k..2k) so lexical confirmation has candidates to promote into the top-k.
  const proseK = lexical ? k * 2 : k;
  const denseFactK = lexical ? factK * 2 : factK;
  const prose: PoolHit[] = knn(queryVec, proseK, { exclude: opts.exclude, ceiling: ceil }).map(h => ({ file: h.file, text: h.text, score: h.score, layer: h.layer, meta: h.meta ?? null, scope: scopeOfChunk(h.file, h.layer) }));
  const facts: PoolHit[] = factKnn(queryVec, denseFactK, { ceiling: ceil }).map(f => ({ file: `fact:${f.key}`, text: f.statement, score: f.score + boost, layer: "fact", factKey: f.key, scope: f.scope ?? null }));
  const dense = [...prose, ...facts].sort((a, b) => b.score - a.score);
  if (!lexical) return dense.slice(0, k);

  const lexProse: PoolHit[] = lexicalKnn(queryText, proseK, { exclude: opts.exclude, ceiling: ceil }, queryVec).map(h => ({ file: h.file, text: h.text, score: h.score, layer: h.layer, meta: h.meta ?? null, scope: scopeOfChunk(h.file, h.layer) }));
  const lexFacts: PoolHit[] = lexicalFactKnn(queryText, denseFactK, { ceiling: ceil }, queryVec).map(f => ({ file: `fact:${f.key}`, text: f.statement, score: f.score + boost, layer: "fact", factKey: f.key, scope: f.scope ?? null }));
  if (lexProse.length === 0 && lexFacts.length === 0) return dense.slice(0, k);

  // CONFIRMATION-ONLY RRF (measured, not the naive version): lexical rank-votes are
  // added to items ALREADY IN the dense pool; a lexical-only item cannot claim a slot.
  // Two naive variants were measured and rejected on the eval before landing here:
  //   - full 3-list RRF ordering broke the smoke "exact dense match wins" invariant
  //     (a near-tied dense item leapfrogged the top answer on lexical votes alone);
  //   - full RRF membership let lexical-only hits evict the dense tail, where the
  //     expected fact often sits (recall@8 88.9%->75.0%, temporal 91.7%->41.7%).
  // Confirmation fusion targets the actual win: a semantic-margin item at dense rank
  // k..2k that ALSO matches the query's exact tokens accumulates votes and gets
  // promoted into the top-k; nothing without dense (semantic) support enters. RRF
  // decides MEMBERSHIP of the top-k; the final ORDER is by cosine-scale score, the
  // one calibrated scale every downstream gate/threshold already understands.
  const K = opts.rrfK ?? 60;
  const lexRank = new Map<string, number>();
  lexProse.forEach((h, i) => { if (!lexRank.has(h.file)) lexRank.set(h.file, i); });
  lexFacts.forEach((h, i) => { if (!lexRank.has(h.file)) lexRank.set(h.file, i); });
  const scored = dense.map((h, r) => {
    const lr = lexRank.get(h.file);
    return { h, rrf: 1 / (K + r + 1) + (lr !== undefined ? 1 / (K + lr + 1) : 0) };
  });
  scored.sort((a, b) => b.rrf - a.rrf);
  return scored.slice(0, k).map(x => x.h).sort((a, b) => b.score - a.score);
}

// ---- P10 sealed memory ----------------------------------------------------------
// A sealed file stays stored and embedded but never surfaces in retrieval unless the
// caller explicitly opts in (includeSealed). Consented forgetting: the user's right
// to say "this rests now" without deleting history. Managed via the seal_memory MCP
// tool or by editing .claude/memory/sealed.json ({"files": ["journal/X.md", ...]}).
let _sealed: Set<string> | null = null;
let _sealedMtime = -2;
export function sealedFile(): string { return path.join(path.dirname(defaultDbPath()), "sealed.json"); }
export function sealedSet(): Set<string> {
  const p = sealedFile();
  let mtime = -1;
  try { mtime = fs.statSync(p).mtimeMs; } catch { /* absent = empty */ }
  if (mtime !== _sealedMtime) {
    _sealedMtime = mtime;
    _sealed = new Set<string>();
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf-8"));
      for (const f of j.files || []) _sealed.add(String(f).replace(/\\/g, "/"));
    } catch { /* absent/bad = empty */ }
  }
  return _sealed!;
}
export function isSealed(file: string): boolean { return sealedSet().has(String(file).replace(/\\/g, "/")); }

// ---- P0 instrumentation: per-chunk injection stats ----------------------------
// chunk_stats records how often each chunk has actually been injected into a session.
// The ACT-R frequency term (P1) and the hindsight loop (P4) both feed on this.
// Keyed by (file, text_hash) where text_hash = sha256(chunk text) prefix, computed by
// the daemon at injection time: rows survive re-embeds that keep text identical and
// reset naturally when the text changes.
export function ensureChunkStats(db = getDb()): void {
  db.exec(`CREATE TABLE IF NOT EXISTS chunk_stats (
    file TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    last_injected_at TEXT,
    PRIMARY KEY (file, text_hash)
  )`);
}

export function recordInjections(items: Array<{ file: string; th: string }>): void {
  if (!items.length) return;
  const db = getDb();
  ensureChunkStats(db);
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO chunk_stats (file, text_hash, hits, last_injected_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(file, text_hash) DO UPDATE SET hits = hits + 1, last_injected_at = excluded.last_injected_at`);
  const tx = db.transaction((rows: Array<{ file: string; th: string }>) => {
    for (const r of rows) if (r.file && r.th) stmt.run(r.file, r.th, now);
  });
  tx(items);
}

export function injectionStats(file: string, th: string): { hits: number; last: string | null } {
  const db = getDb(); ensureChunkStats(db);
  const row = db.prepare("SELECT hits, last_injected_at AS last FROM chunk_stats WHERE file = ? AND text_hash = ?").get(file, th) as any;
  return row ? { hits: row.hits, last: row.last } : { hits: 0, last: null };
}

export function chunkStatsSummary(): { tracked: number; totalHits: number } {
  const db = getDb(); ensureChunkStats(db);
  const row = db.prepare("SELECT COUNT(*) AS tracked, COALESCE(SUM(hits), 0) AS totalHits FROM chunk_stats").get() as any;
  return { tracked: row.tracked, totalHits: row.totalHits };
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
