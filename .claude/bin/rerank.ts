/**
 * Local cross-encoder reranker for LKHS.
 *
 * The bi-encoder (bge-small) retrieves a broad candidate pool fast but cannot
 * separate "relevant to this query" from "shares vocabulary" (proven: generic
 * prompts score ~0.8 cosine against the personal corpus, same as real hits). A
 * cross-encoder reads the (query, passage) PAIR jointly and scores actual
 * relevance with a wide dynamic range, so it both reorders the pool AND gives the
 * gate a trustworthy inject/skip signal.
 *
 * Model: ms-marco-MiniLM-L-6-v2 (q8), run locally via Transformers.js on
 * onnxruntime. Cached under local_cache/transformers (gitignored, re-downloads on
 * a fresh clone). score = sigmoid(logit) in [0,1].
 *
 * Dynamic import keeps the ESM-only transformers package out of the CJS load path
 * until first use, and makes the daemon degrade gracefully if it can't load.
 */
import { cacheDir } from "./config";

const MODEL_ID = process.env.LKHS_RERANK_MODEL || "Xenova/ms-marco-MiniLM-L-6-v2";

let _lib: Promise<any> | null = null;
async function lib(): Promise<any> {
  if (!_lib) _lib = (async () => {
    const t = await import("@huggingface/transformers");
    t.env.cacheDir = cacheDir();
    t.env.allowRemoteModels = true;
    return t;
  })();
  return _lib;
}

let _tok: Promise<any> | null = null;
let _model: Promise<any> | null = null;
async function tokenizer(): Promise<any> { return (_tok ??= lib().then(t => t.AutoTokenizer.from_pretrained(MODEL_ID))); }
async function model(): Promise<any> {
  return (_model ??= lib().then(t =>
    t.AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { dtype: "q8" })
      .catch(() => t.AutoModelForSequenceClassification.from_pretrained(MODEL_ID)) // fall back to default dtype
  ));
}

/** Load tokenizer + model AND run one inference so ORT graph-optimizes before the
 *  first real query (otherwise the first gate pays a multi-second one-off cost). */
export async function warm(): Promise<void> {
  await Promise.all([tokenizer(), model()]);
  try { await rerank("warm up", ["warm up passage"], x => x); } catch { /* best effort */ }
}

export interface Reranked<T> { item: T; score: number; logit: number }

/**
 * Score `query` against each candidate's text and return them sorted by relevance
 * (descending). score = sigmoid(logit) in [0,1]; logit kept for calibration.
 * Batched to bound memory. Throws if the model can't load (caller may fall back).
 */
export async function rerank<T>(
  query: string,
  candidates: T[],
  getText: (c: T) => string,
  batchSize = 32
): Promise<Reranked<T>[]> {
  if (candidates.length === 0) return [];
  const tok = await tokenizer();
  const mdl = await model();
  const results: Reranked<T>[] = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const texts = batch.map(getText);
    const inputs = tok(texts.map(() => query), { text_pair: texts, padding: true, truncation: true });
    const out = await mdl(inputs);
    const logits: number[] = out.logits.tolist().map((x: number[]) => x[0]!);
    batch.forEach((c, j) => {
      const logit = logits[j]!;
      results.push({ item: c, logit, score: 1 / (1 + Math.exp(-logit)) });
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
