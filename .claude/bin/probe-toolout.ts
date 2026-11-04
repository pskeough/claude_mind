/**
 * probe-toolout.ts — how much does lkhs-mcp tool output cost, and how much does
 * it silently throw away?
 *
 *   npx tsx .claude/bin/probe-toolout.ts
 *
 * READ-ONLY diagnostic. Touches no vault state, mutates nothing, registers no
 * tools. Added 2026-08-16 as the baseline probe for the "dual output
 * projection" port candidate (see Claude_Personal_Conv/notes/
 * oss-harness-mining-workflow.md).
 *
 * What it measures, per query, replicating search_memory's render EXACTLY as
 * lkhs-mcp.ts:270-271 performs it:
 *
 *   rendered   tokens actually returned to the model
 *   full       tokens the retrieved chunks contain before the .slice(0, 500)
 *   dropped    full - rendered, i.e. content retrieved, paid for in retrieval
 *              cost, and then discarded with no locator to recover it
 *
 * The dropped column is the point. A head-truncation at a fixed character
 * count is not a summary; it is a biased prefix. If the answer-bearing sentence
 * sits at character 700 of a hit, the model cannot see it and cannot ask for
 * it, because nothing in the output says the hit was cut or where the rest is.
 *
 * Tokens are chars/4, matching injection-cost.ts deliberately: the ratio is the
 * finding, and a real tokenizer would change neither the ratio nor the verdict.
 */
import { queryVectorStore } from "./vector-query";
import { rerank } from "./rerank";

const tok = (s: string) => Math.ceil(s.length / 4);

// The exact constants lkhs-mcp.ts search_memory uses.
const RENDER_SLICE = 500;   // lkhs-mcp.ts:271
const RERANK_SLICE = 400;   // lkhs-mcp.ts:269
const POOL = 24;            // lkhs-mcp.ts:266
const DEFAULT_K = 6;        // lkhs-mcp.ts:265

/**
 * Queries chosen to span the layers search_memory serves (card, session,
 * project, wiki, theme) and to look like real prompts rather than keyword
 * probes. No clinical content, matching eval-memory.ts policy.
 */
const QUERIES = [
  "what is the current state of a paper project",
  "where did I leave a research paper paper",
  "what did I decide about local agentic coding",
  "how does the NewsBrief system work",
  "what is my publication pipeline status",
  "what did I conclude about income from my software",
  "what are the AU PhD funding deadlines",
  "how does the mimesis voice system work",
];

interface Row {
  query: string;
  hits: number;
  renderedTok: number;
  fullTok: number;
  droppedTok: number;
  cutHits: number;      // hits whose text exceeded RENDER_SLICE
  worstCutChars: number; // largest single-hit discard
}

async function probe(query: string): Promise<Row | null> {
  const pool = await queryVectorStore(query, POOL);
  if (!pool.length) return null;
  const ranked = await rerank(query, pool, (h: any) => h.text.slice(0, RERANK_SLICE));
  const top = ranked.slice(0, DEFAULT_K);

  let renderedTok = 0, fullTok = 0, cutHits = 0, worstCutChars = 0;
  for (const r of top) {
    const norm = r.item.text.replace(/\s+/g, " ");
    const shown = norm.slice(0, RENDER_SLICE);
    const header = `[${r.score.toFixed(3)} ${r.item.layer}] ${r.item.filePath}\n`;
    renderedTok += tok(header + shown);
    fullTok += tok(header + norm);
    const cut = norm.length - shown.length;
    if (cut > 0) { cutHits++; worstCutChars = Math.max(worstCutChars, cut); }
  }
  return {
    query, hits: top.length, renderedTok, fullTok,
    droppedTok: fullTok - renderedTok, cutHits, worstCutChars,
  };
}

async function main() {
  const rows: Row[] = [];
  for (const q of QUERIES) {
    try {
      const r = await probe(q);
      if (r) rows.push(r);
      else console.error(`  (no matches: "${q}")`);
    } catch (e: any) {
      console.error(`  (failed: "${q}" -> ${e.message})`);
    }
  }
  if (!rows.length) { console.error("No queries returned results; is the vector store built?"); process.exit(1); }

  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log("\nsearch_memory baseline (k=6, render slice 500 chars)\n");
  console.log("  rendered   full  dropped  cut/hits  worst  query");
  for (const r of rows) {
    console.log(
      `  ${pad(r.renderedTok, 8)} ${pad(r.fullTok, 6)} ${pad(r.droppedTok, 8)}` +
      `  ${pad(r.cutHits + "/" + r.hits, 8)} ${pad(r.worstCutChars, 6)}  ${r.query}`
    );
  }

  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const rendered = sum(r => r.renderedTok), full = sum(r => r.fullTok), dropped = sum(r => r.droppedTok);
  const totalHits = sum(r => r.hits), totalCut = sum(r => r.cutHits);

  console.log(`\n  TOTAL   rendered ${rendered} tok | retrieved ${full} tok | dropped ${dropped} tok`);
  console.log(`  Silent loss: ${(100 * dropped / full).toFixed(1)}% of retrieved content discarded`);
  console.log(`  Truncated hits: ${totalCut}/${totalHits} (${(100 * totalCut / totalHits).toFixed(0)}%)`);
  console.log(`  Mean per call: ${Math.round(rendered / rows.length)} tok returned, ${Math.round(dropped / rows.length)} tok thrown away`);
  console.log(`\n  P1 verdict: baseline provides NO locator for dropped content — a cut hit is unrecoverable from the tool output alone.`);
  console.log(`  Threshold to beat: >=25% reduction in rendered tokens at equal recall, with dropped content addressable.\n`);

  console.log(JSON.stringify({ probe: "toolout-baseline", rendered, full, dropped, totalHits, totalCut, rows }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
