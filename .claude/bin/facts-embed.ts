/**
 * facts-embed.ts — P2 fact ingestion: make persona facts first-class embedded
 * retrieval units.
 *
 * Loads .claude/memory/persona_facts.jsonl (+ persona_clinical.jsonl), embeds each
 * fact's statement with a facet context prefix (contextual-chunk style, same
 * bge-small 384-dim space as prose via vector-engine embedPassages), and stores the
 * row in `fact` + the vector in `vec_facts` (store.ts).
 *
 * Contracts:
 *   - hash-skip: stmt_hash = sha256(context + " " + statement) mirrors the chunk
 *     hashing scheme; unchanged facts update scalar columns only (temporal state,
 *     confidence) and keep their stored vector.
 *   - clinical facts ARE embedded but tagged sensitivity=clinical; factKnn excludes
 *     them by default (quarantine identical to clinical prose).
 *   - subject_id defaults to the persona hub entity; relation/object_id are null
 *     until a later extraction pass populates them.
 *   - prune: fact keys no longer present in either jsonl are deleted.
 *
 *   npm run facts:embed          (add --dry to count without writing)
 */
import * as path from "path";
import { loadFactsFile, facetDefaultScope, type Fact } from "./persona-facts";
import { embedPassages } from "./vector-engine";
import { sha256, factHashes, upsertFact, deleteFact, factStats, getDb, type FactRow } from "./store";
import { memDir, personaHub } from "./config";

const DRY = process.argv.includes("--dry");

/** Facet context prefix (contextual retrieval): a bare statement embeds better
 *  anchored to whose fact it is and which facet it belongs to. */
export function factContext(facet: string): string {
  return `${personaHub().label} persona fact (${facet})`;
}

function toRow(f: Fact, sensitivity: "normal" | "clinical", ctx: string): FactRow {
  return {
    key: f.key,
    facet: f.facet,
    statement: f.statement,
    subject_id: personaHub().id,          // persona facts are about the hub by construction
    relation: null,                        // best-effort; populated by a later extraction pass
    object_id: null,
    t_event: f.t_event || null,
    valid_at: f.valid_at || null,
    invalid_at: f.invalid_at ?? null,
    confidence: f.confidence ?? null,
    sensitivity,
    provenance: JSON.stringify(f.sources || []),
    supersedes: JSON.stringify(f.supersedes || []),
    created: f.created || null,
    stmt_hash: sha256(ctx + " " + f.statement),
    // scope is NOT part of stmt_hash: a scope change is a scalar-only refresh, no
    // re-embed. Unscoped facts (added between scope passes) land at their facet's
    // fail-closed floor rather than NULL(=personal).
    scope: sensitivity === "clinical" ? "clinical" : (f.scope ?? facetDefaultScope(f.facet)),
  };
}

async function main() {
  const normal = loadFactsFile(path.join(memDir(), "persona_facts.jsonl"));
  const clinical = loadFactsFile(path.join(memDir(), "persona_clinical.jsonl"));
  if (normal.length === 0) { console.error("no facts in persona_facts.jsonl; aborting"); process.exit(1); }

  // Tag sensitivity by SOURCE FILE (belt and braces over the per-fact field): anything
  // from the clinical jsonl is quarantined regardless of what its record claims.
  const rows: FactRow[] = [
    ...normal.map(f => toRow(f, f.sensitivity === "clinical" ? "clinical" : "normal", factContext(f.facet))),
    ...clinical.map(f => toRow(f, "clinical", factContext(f.facet))),
  ];

  // Duplicate keys across files: keep the first occurrence (normal wins is impossible —
  // the builder routes each fact to exactly one file; this only guards a hand-edited overlap).
  const byKey = new Map<string, FactRow>();
  for (const r of rows) if (!byKey.has(r.key)) byKey.set(r.key, r);

  getDb();
  const stored = factHashes();
  const toEmbed: FactRow[] = [];
  const toUpdate: FactRow[] = [];
  for (const r of byKey.values()) {
    if (stored.get(r.key) === r.stmt_hash) toUpdate.push(r);  // vector reusable; scalars may have changed
    else toEmbed.push(r);
  }
  const stale = [...stored.keys()].filter(k => !byKey.has(k));

  console.log(`facts: ${byKey.size} total (${rows.length - byKey.size} duplicate keys collapsed)`);
  console.log(`embed: ${toEmbed.length} new/changed | metadata-only: ${toUpdate.length} | prune: ${stale.length}`);
  if (DRY) return;

  // Embed in bulk (contextual-chunk style: "<context>\n\n<statement>").
  const BATCH = 256;
  let inserted = 0, reembedded = 0;
  for (let i = 0; i < toEmbed.length; i += BATCH) {
    const batch = toEmbed.slice(i, i + BATCH);
    const vecs = await embedPassages(batch.map(r => `${factContext(r.facet!)}\n\n${r.statement}`));
    batch.forEach((r, j) => {
      const res = upsertFact(r, vecs[j]);
      if (res === "inserted") inserted++; else if (res === "reembedded") reembedded++;
    });
    console.log(`  embedded ${Math.min(i + BATCH, toEmbed.length)}/${toEmbed.length}`);
  }
  for (const r of toUpdate) upsertFact(r);       // no vector: scalar refresh only
  for (const k of stale) deleteFact(k);

  const s = factStats();
  console.log(`done. inserted=${inserted} reembedded=${reembedded} refreshed=${toUpdate.length} pruned=${stale.length}`);
  console.log(`fact store now: ${s.total} facts (${s.total - s.clinical} normal, ${s.clinical} clinical)`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
