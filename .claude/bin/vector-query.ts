/**
 * CLI / library semantic search over the LKHS store (SQLite + sqlite-vec).
 *
 *   npx tsx .claude/bin/vector-query.ts "<query>"
 *
 * For the per-prompt hot path use the warm daemon (/query) instead; this loads the
 * model cold on each invocation and is meant for manual one-off lookups.
 */
import { FlagEmbedding, EmbeddingModel } from "fastembed";
import { hybridSearch } from "./store";
import { rerank } from "./rerank";
import { factBoost, lexicalRrf, rrfK } from "./config";

export interface QueryHit {
  filePath: string; text: string; score: number; layer?: string;
  /** set only on embedded-fact hits (layer "fact"): the rebuild-stable fact key */
  factKey?: string;
}

let _model: any = null;
async function getModel() {
  if (!_model) _model = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15 });
  return _model;
}

export async function queryVectorStore(query: string, topK = 5): Promise<QueryHit[]> {
  const model = await getModel();
  const queryText = `query: ${query.replace(/\s+/g, " ").trim()}`;
  let queryVec: number[] = [];
  for await (const batch of model.embed([queryText])) {
    for (const v of batch) { queryVec = Array.from(v as ArrayLike<number>); break; }
    break;
  }
  if (queryVec.length === 0) return [];
  // P4a hybrid pool (store.hybridSearch): dense knn prose + factKnn facts as before
  // (skill layer excluded; quarantine + validity enforced at the vector layer; facts
  // carry the structural boost), with FTS5 lexical lists RRF-fused in when enabled.
  return hybridSearch(queryVec, query, topK, { factK: topK, exclude: ["skill"], factBoost: factBoost(), lexical: lexicalRrf(), rrfK: rrfK() })
    .map(h => ({ filePath: h.file, text: h.text, score: h.score, layer: h.layer, factKey: h.factKey }));
}

if (require.main === module) {
  const doRerank = process.argv.includes("--rerank");
  const q = process.argv.slice(2).filter(a => !a.startsWith("--")).join(" ");
  if (!q) { console.error("Usage: tsx vector-query.ts [--rerank] <query>"); process.exit(1); }
  (async () => {
    if (doRerank) {
      const pool = await queryVectorStore(q, 20);
      const ranked = await rerank(q, pool, h => h.text.slice(0, 400));
      for (const r of ranked.slice(0, 5)) {
        console.log(`\n[rerank ${r.score.toFixed(4)}] (${r.item.layer}) ${r.item.filePath}`);
        console.log(r.item.text.slice(0, 200) + (r.item.text.length > 200 ? "..." : ""));
      }
    } else {
      for (const h of await queryVectorStore(q, 5)) {
        console.log(`\n[${h.score.toFixed(4)}] (${h.layer}) ${h.filePath}`);
        console.log(h.text.slice(0, 200) + (h.text.length > 200 ? "..." : ""));
      }
    }
  })().catch(e => { console.error(e); process.exit(1); });
}
