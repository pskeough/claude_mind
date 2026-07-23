/**
 * Calibration harness: find the reranker score that separates "needs my memory"
 * from "general knowledge". Runs a battery of personal and general prompts through
 * the real pipeline (bi-encoder KNN pool -> cross-encoder rerank) and prints the
 * top cosine vs top rerank score for each, so the gate threshold is grounded in
 * data, not guessed.
 *
 *   tsx calibrate-rerank.ts
 */
import { queryVectorStore } from "./vector-query";
import { rerank, warm } from "./rerank";

const PERSONAL = [
  "what did I conclude about sycophancy severity scoring",
  "how did I set up the Tai RAG ingestion",
  "summarize the demographic bias findings from my research project",
  "what is the architecture of the LKHS memory system",
  "what did I decide about the abliteration active suppression hypothesis",
  "what are the open threads on my novel draft",
  "what models did I run for the Train LLM experiments",
];
const GENERAL = [
  "what is the capital of France",
  "write a function to reverse a linked list",
  "explain how TCP congestion control works",
  "what is a good recipe for pancakes",
  "translate hello into Spanish",
  "center a div with flexbox",
  "what year did the Roman empire fall",
];

const POOL = 30;

async function main() {
  console.log("warming reranker...");
  await warm();
  const rows: Array<{ cat: string; q: string; cos: number; rr: number; top: string }> = [];
  for (const [cat, list] of [["PERSONAL", PERSONAL], ["GENERAL", GENERAL]] as const) {
    for (const q of list) {
      const hits = await queryVectorStore(q, POOL);
      const ranked = await rerank(q, hits, h => h.text);
      rows.push({
        cat, q,
        cos: hits[0]?.score ?? 0,
        rr: ranked[0]?.score ?? 0,
        top: ranked[0]?.item.filePath ?? "(none)",
      });
    }
  }
  console.log("\nCAT       rerank  cosine  prompt");
  for (const r of rows) console.log(`${r.cat.padEnd(8)}  ${r.rr.toFixed(3)}   ${r.cos.toFixed(3)}   ${r.q}`);

  const p = rows.filter(r => r.cat === "PERSONAL").map(r => r.rr);
  const g = rows.filter(r => r.cat === "GENERAL").map(r => r.rr);
  const minP = Math.min(...p), maxG = Math.max(...g);
  console.log(`\nrerank: personal min=${minP.toFixed(3)}  general max=${maxG.toFixed(3)}  ${minP > maxG ? `SEPARATED (gap ${(minP - maxG).toFixed(3)}) -> threshold ~${((minP + maxG) / 2).toFixed(3)}` : "OVERLAP (no clean cut)"}`);
  const cp = rows.filter(r => r.cat === "PERSONAL").map(r => r.cos);
  const cg = rows.filter(r => r.cat === "GENERAL").map(r => r.cos);
  console.log(`cosine: personal min=${Math.min(...cp).toFixed(3)}  general max=${Math.max(...cg).toFixed(3)}  (for contrast: this is why cosine alone cannot gate)`);
}

main().catch(e => { console.error(e); process.exit(1); });
