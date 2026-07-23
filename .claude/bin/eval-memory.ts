/**
 * eval-memory.ts — LongMemEval-style OFFLINE memory eval for LKHS.
 *
 *   npm run eval:memory                 run the eval against the live system
 *   npx tsx .claude/bin/eval-memory.ts --generate   (one-time) build the question set
 *   flags: --k N (recall depth, default 8), --set <path> (alternate question file)
 *
 * Question set: .claude/memory/eval/memory_eval.jsonl — natural-language questions
 * paraphrased (once, by a claude -p pass) from real persona facts, labeled with the
 * expected fact key(s) and an `expect` field:
 *   recall           the fact must surface in retrieval
 *   abstain          no supporting fact exists -> the gate must NOT inject
 *   temporal-current only the currently-valid fact is acceptable (scored as plain
 *                    recall until bi-temporal fields exist; marked for activation)
 *
 * Scoring is fully deterministic — normalized-substring / token-overlap of the
 * expected statement against retrieved text. NO LLM judge in the scoring loop.
 *
 * Drivers (each measures a distinct live path):
 *   queryVectorStore(question, k)   raw retrieval  -> recall@k
 *   POST http://127.0.0.1:7077/gate  end-to-end inject decision -> abstention
 *   recallPersonaFacts (direct import of recall_persona's fact loader in
 *   lkhs-mcp.ts)                     fact/temporal path -> temporal-correctness
 *
 * Output: table to stdout + a diffable run file .claude/memory/eval/runs/<iso>.json
 * and a one-line composite. Clinical facts never enter the eval set.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawn, spawnSync } from "child_process";
import { vaultRoot, memDir, daemonPort, summaryModel, clinicalLexicon } from "./config";
import { queryVectorStore } from "./vector-query";
import { recallPersonaFacts, PersonaFact } from "./lkhs-mcp";

const VAULT = vaultRoot();
const EVAL_DIR = path.join(memDir(), "eval");
const RUNS_DIR = path.join(EVAL_DIR, "runs");
const QSET_DEFAULT = path.join(EVAL_DIR, "memory_eval.jsonl");
const PORT = daemonPort();
const OVERLAP_HIT = 0.5; // fraction of expected content tokens present in retrieved text

// ---- stable fact key (same formula deliverable 2 will adopt) -----------------
export function normalizeStatement(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");
}
export function factKey(facet: string, statement: string): string {
  return crypto.createHash("sha1").update(facet + "|" + normalizeStatement(statement)).digest("hex").slice(0, 16);
}

// ---- deterministic text match -------------------------------------------------
const STOP = new Set(("a an the and or but of to in on at for from with by as is are was were be been has have had " +
  "his her its their this that these those it he she they i you we not no do does did will would can could about into over").split(" "));
function tokens(s: string): Set<string> {
  return new Set((s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter(t => t.length >= 3 && !STOP.has(t)));
}
/** fraction of the expected statement's content tokens present in the candidate text */
function overlap(expected: string, candidate: string): number {
  const e = tokens(expected); if (e.size === 0) return 0;
  const c = tokens(candidate);
  let hit = 0; for (const t of e) if (c.has(t)) hit++;
  return hit / e.size;
}
function matches(expected: string, candidate: string): { hit: boolean; score: number } {
  const normE = normalizeStatement(expected), normC = normalizeStatement(candidate);
  if (normE && normC.includes(normE)) return { hit: true, score: 1 };
  const s = overlap(expected, candidate);
  return { hit: s >= OVERLAP_HIT, score: s };
}

// ---- question set shapes -------------------------------------------------------
interface EvalItem {
  id: string;
  question: string;
  expect: "recall" | "abstain" | "temporal-current";
  facet?: string;
  fact_keys: string[];
  expected_statements: string[]; // copied verbatim from persona_facts at generation time
  /** temporal-current only: keys of the SUPERSEDED (older) facts this item's current
   *  fact replaced. The validity filter must keep these out of the returned set, or at
   *  least below the current fact. Their presence-above-current is the failure the
   *  temporal-correctness metric now actually tests (P3). */
  superseded_keys?: string[];
}

function loadItems(file: string): EvalItem[] {
  if (!fs.existsSync(file)) {
    console.error(`Question set not found: ${file}\nGenerate it once with: npx tsx .claude/bin/eval-memory.ts --generate`);
    process.exit(1);
  }
  return fs.readFileSync(file, "utf-8").trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}

// ---- daemon ---------------------------------------------------------------------
async function health(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(4000) });
    const j: any = await r.json(); return j.ok === true;
  } catch { return false; }
}
async function ensureDaemon(): Promise<void> {
  if (await health()) return;
  console.error(`daemon not responding on :${PORT}; starting via npm run serve (detached)...`);
  const child = spawn("npm", ["run", "serve"], { cwd: VAULT, shell: true, detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (await health()) { console.error("daemon is up."); return; }
  }
  console.error(`FATAL: daemon did not come up on :${PORT} after 90s. Start it manually: npm run serve`);
  process.exit(1);
}
async function gate(prompt: string): Promise<any> {
  const r = await fetch(`http://127.0.0.1:${PORT}/gate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }), signal: AbortSignal.timeout(60000),
  });
  return r.json();
}

// ---- run -------------------------------------------------------------------------
async function run(qsetFile: string, k: number) {
  const items = loadItems(qsetFile);
  await ensureDaemon();

  // fact/temporal path: current valid fact set, keyed
  const allFacts = recallPersonaFacts({});
  const byKey = new Map<string, PersonaFact>();
  for (const f of allFacts) byKey.set((f as any).key || factKey(f.facet, f.statement), f);
  const validNow = (f: PersonaFact | undefined): boolean => {
    if (!f) return false;
    const inv = (f as any).invalid_at;
    return !inv || String(inv) > new Date().toISOString().slice(0, 10);
  };

  const results: any[] = [];
  for (const it of items) {
    const res: any = { id: it.id, expect: it.expect, question: it.question };

    // 1) retrieval recall@k (recall + temporal items)
    if (it.expect !== "abstain") {
      const hits = await queryVectorStore(it.question, k);
      let best = { hit: false, score: 0, file: "" };
      // P3 temporal tracking: rank (0-based position in the returned, score-sorted
      // hit list) of the first CURRENT-fact hit and the first SUPERSEDED-fact hit.
      let currentRank = -1, supersededRank = -1;
      hits.forEach((h, idx) => {
        // P2 FACT-PATH scoring: embedded fact hits carry the fact's stable key, and
        // their text IS the source statement verbatim — text-overlap would trivially
        // score 1.0 and inflate recall. So a fact hit counts ONLY if its key matches
        // an expected fact key (exact provenance, not surface similarity).
        if (h.factKey) {
          if (it.fact_keys.includes(h.factKey)) {
            if (currentRank < 0) currentRank = idx;
            if (best.score < 1) best = { hit: true, score: 1, file: h.filePath };
          }
          if (supersededRank < 0 && (it.superseded_keys || []).includes(h.factKey)) supersededRank = idx;
          return;
        }
        for (const exp of it.expected_statements) {
          const m = matches(exp, h.text);
          if (m.score > best.score) best = { hit: m.hit, score: m.score, file: h.filePath };
        }
      });
      res.recall_hit = best.hit;
      res.recall_best = { score: Number(best.score.toFixed(3)), file: best.file };
      if (it.expect === "temporal-current") { res._currentRank = currentRank; res._supersededRank = supersededRank; }
    }

    // 2) gate decision (all items; scored for abstain, informational otherwise)
    try {
      const g = await gate(it.question);
      res.gate = { inject: !!g.inject, reason: g.reason || g.signal || "", topScore: g.topScore ?? (g.hits?.[0]?.score ?? null) };
    } catch (e: any) { res.gate = { inject: null, reason: `gate-error: ${e.message}` }; }
    if (it.expect === "abstain") res.abstain_correct = res.gate.inject === false;

    // 3) temporal-correctness (P3: now a REAL end-to-end test of the validity filter).
    //    The item's fact_keys are the CURRENT (valid) fact; superseded_keys are the
    //    older facts it replaced. Correct iff:
    //      (a) the current fact is actually the still-valid one (invalid_at not passed), AND
    //      (b) it was retrieved, AND
    //      (c) no superseded version outranks it — the filter either excluded the
    //          superseded fact (supersededRank < 0) or ranked it below the current one.
    //    Before P3 this was `resolved.every(validNow)` — always true, because the eval
    //    only referenced still-valid facts, so nothing exercised the filter (saturated).
    if (it.expect === "temporal-current") {
      const resolved = it.fact_keys.map(kk => byKey.get(kk));
      const currentStillValid = resolved.length > 0 && resolved.every(validNow);
      const currentRank = res._currentRank ?? -1;
      const supersededRank = res._supersededRank ?? -1;
      const retrieved = currentRank >= 0;
      const notOutranked = supersededRank < 0 || (currentRank >= 0 && currentRank < supersededRank);
      res.temporal_correct = currentStillValid && retrieved && notOutranked;
      res.temporal_detail = { currentStillValid, currentRank, supersededRank, notOutranked };
    }

    results.push(res);
    const mark = it.expect === "abstain" ? (res.abstain_correct ? "OK " : "MISS")
      : (res.recall_hit ? "OK " : "MISS");
    console.log(`[${mark}] ${it.id} (${it.expect}) ${it.question.slice(0, 78)}`);
  }

  // ---- aggregate -----------------------------------------------------------------
  const recallItems = results.filter(r => r.expect !== "abstain");
  const abstainItems = results.filter(r => r.expect === "abstain");
  const temporalItems = results.filter(r => r.expect === "temporal-current");
  const frac = (arr: any[], f: (r: any) => boolean) => arr.length ? arr.filter(f).length / arr.length : null;

  const recallAtK = frac(recallItems, r => r.recall_hit);
  const abstention = frac(abstainItems, r => r.abstain_correct);
  const temporal = frac(temporalItems, r => r.temporal_correct);
  const injectRateRecall = frac(recallItems, r => r.gate?.inject === true);

  const w = { recall: 0.5, abstain: 0.3, temporal: 0.2 };
  const composite = (recallAtK ?? 0) * w.recall + (abstention ?? 0) * w.abstain + (temporal ?? 0) * w.temporal;

  const metrics = {
    k,
    n: items.length,
    n_recall: recallItems.length, n_abstain: abstainItems.length, n_temporal: temporalItems.length,
    recall_at_k: recallAtK, abstention_accuracy: abstention, temporal_correctness: temporal,
    gate_inject_rate_on_recall: injectRateRecall,
    composite: Number(composite.toFixed(4)),
    weights: w,
  };

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const iso = new Date().toISOString();
  const runFile = path.join(RUNS_DIR, iso.replace(/[:.]/g, "-") + ".json");
  fs.writeFileSync(runFile, JSON.stringify({ generated: iso, question_set: path.relative(VAULT, qsetFile), metrics, results }, null, 2));

  const pct = (v: number | null) => v === null ? "  n/a" : (v * 100).toFixed(1).padStart(5) + "%";
  console.log("\n metric                       value   items");
  console.log(" ---------------------------  ------  -----");
  console.log(` recall@${String(k).padEnd(2)}                   ${pct(recallAtK)}  ${recallItems.length}`);
  console.log(` abstention accuracy          ${pct(abstention)}  ${abstainItems.length}`);
  console.log(` temporal correctness         ${pct(temporal)}  ${temporalItems.length}`);
  console.log(` gate inject rate (recall qs) ${pct(injectRateRecall)}  ${recallItems.length}`);
  console.log(`\ncomposite: ${metrics.composite} (0.5*recall + 0.3*abstention + 0.2*temporal)`);
  console.log(`run saved: ${runFile}`);
}

// ---- question-set generation (one-time, claude -p) --------------------------------
function sampleCandidates(): Array<PersonaFact & { key: string }> {
  const CLIN = clinicalLexicon();
  const clinical = (s: string) => CLIN.med.test(s) || CLIN.coping.test(s) || CLIN.crisis.test(s);
  const facts = recallPersonaFacts({}) // normal tier only; clinical file never loaded
    .filter(f => f.sensitivity !== "clinical" && f.facet !== "health" && !clinical(f.statement))
    .filter(f => (f.confidence ?? 0) >= 0.7 && f.statement.length >= 40 && f.statement.length <= 260);
  const byFacet = new Map<string, PersonaFact[]>();
  for (const f of facts) { if (!byFacet.has(f.facet)) byFacet.set(f.facet, []); byFacet.get(f.facet)!.push(f); }
  const out: Array<PersonaFact & { key: string }> = [];
  const PER_FACET: Record<string, number> = { biography: 12, research: 12, intellectual: 8, values: 8, decision: 8, psychology: 8, voice: 6, relationship: 6 };
  for (const [facet, want] of Object.entries(PER_FACET)) {
    const pool = byFacet.get(facet) || [];
    const step = Math.max(1, Math.floor(pool.length / Math.max(want, 1)));
    for (let i = 0; i < pool.length && out.filter(o => o.facet === facet).length < want; i += step) {
      const f = pool[i]!;
      out.push({ ...f, key: factKey(f.facet, f.statement) });
    }
  }
  return out;
}

function generate() {
  const cand = sampleCandidates();
  if (cand.length < 20) { console.error(`only ${cand.length} candidate facts; aborting`); process.exit(1); }
  const factList = cand.map(f => `${f.key} | ${f.facet}${f.t_event ? ` | ${f.t_event}` : " |"} | ${f.statement}`).join("\n");

  const instruction = "Read the fact list and instructions in the input and output ONLY the requested JSON array. No prose, no code fences.";
  const stdinContent = [
    "BEGIN_FACTS (each line: key | facet | date-or-blank | statement)",
    factList,
    "END_FACTS",
    "",
    "You are building an evaluation question set for a personal memory system. From the facts above, produce a JSON array of EXACTLY 36 items:",
    "- 24 items with \"expect\":\"recall\": a natural question a person might ask their own memory assistant, answerable ONLY by the referenced fact. CRITICAL: paraphrase; the question must NOT reuse the statement's distinctive wording (no copied phrases over 3 words). Reference 1-2 fact keys.",
    "- 6 items with \"expect\":\"temporal-current\": same as recall but choose facts that describe a state likely to change over time (enrollment, residence, job, ongoing project status, current tools). Prefer facts with dates. Phrase the question in the present tense (\"where do I currently...\", \"what am I ... now\").",
    "- 6 items with \"expect\":\"abstain\": questions in the same personal style whose answers are genuinely ABSENT from the fact list and plausibly absent from the person's records (e.g. passport number, childhood dentist, blood type, a sibling's middle name, favorite shoe brand, first phone's model). fact_keys must be [].",
    "Each item: {\"question\": string, \"expect\": \"recall\"|\"temporal-current\"|\"abstain\", \"facet\": string-or-null, \"fact_keys\": [keys from the list]}",
    "Questions must be first-person from the user's perspective, varied in phrasing, and must not mention this eval, the fact list, or fact keys. Output the JSON array only.",
  ].join("\n");

  console.error(`sending ${cand.length} candidate facts to claude -p (${summaryModel()})...`);
  const res = spawnSync("claude", ["-p", instruction, "--model", summaryModel(), "--output-format", "text"], {
    cwd: VAULT, input: stdinContent, shell: true,
    env: { ...process.env, LKHS_CAPTURE: "1" }, maxBuffer: 10 * 1024 * 1024, timeout: 300_000,
  });
  const raw = (res.stdout ? Buffer.from(res.stdout).toString("utf8") : "").trim();
  if (res.status !== 0 || !raw) { console.error(`claude -p failed (status ${res.status}): ${(res.stderr || "").toString().slice(0, 400)}`); process.exit(1); }

  const jsonText = raw.replace(/^```(json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = jsonText.indexOf("["), end = jsonText.lastIndexOf("]");
  if (start < 0 || end < 0) { console.error("no JSON array in model output:\n" + raw.slice(0, 500)); process.exit(1); }
  let parsed: any[];
  try { parsed = JSON.parse(jsonText.slice(start, end + 1)); } catch (e: any) { console.error("JSON parse failed: " + e.message); process.exit(1); }

  const byKey = new Map(cand.map(f => [f.key, f]));
  const items: EvalItem[] = [];
  let dropped = 0;
  for (const p of parsed) {
    if (!p?.question || !["recall", "abstain", "temporal-current"].includes(p.expect)) { dropped++; continue; }
    const keys: string[] = Array.isArray(p.fact_keys) ? p.fact_keys.filter((kk: string) => byKey.has(kk)) : [];
    if (p.expect !== "abstain" && keys.length === 0) { dropped++; continue; }
    const stmts = keys.map(kk => byKey.get(kk)!.statement);
    // leak check: the question must not contain the bulk of the statement's wording
    if (stmts.some(s => overlap(s, p.question) > 0.6)) { dropped++; continue; }
    items.push({
      id: `q-${String(items.length + 1).padStart(3, "0")}`,
      question: String(p.question).trim(),
      expect: p.expect,
      facet: p.facet || byKey.get(keys[0]!)?.facet || undefined,
      fact_keys: keys,
      expected_statements: stmts, // verbatim from persona_facts, NOT from the model
    });
  }
  if (items.length < 25) { console.error(`only ${items.length} valid items after validation (${dropped} dropped); aborting without writing`); process.exit(1); }

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  fs.writeFileSync(QSET_DEFAULT, items.map(i => JSON.stringify(i)).join("\n") + "\n");
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.expect] = (counts[i.expect] || 0) + 1;
  console.log(`wrote ${items.length} items (${dropped} dropped) -> ${QSET_DEFAULT}`);
  console.log("breakdown:", JSON.stringify(counts));
}

// ---- cli ---------------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const argOf = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--generate")) { generate(); }
  else {
    const k = Number(argOf("--k") || 8);
    const qset = argOf("--set") ? path.resolve(argOf("--set")!) : QSET_DEFAULT;
    run(qset, k).catch(e => { console.error(e); process.exit(1); });
  }
}
