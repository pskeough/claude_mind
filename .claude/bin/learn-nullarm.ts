/**
 * learn-nullarm.ts — do the method principles change what gets planned?
 *
 *   npm run learn:nullarm                    run (cached; reruns are nearly free)
 *   npm run learn:nullarm -- --probes 24     probe count
 *   npm run learn:nullarm -- --report        re-render from cache, no model calls
 *
 * THE BLOCKER THIS REMOVES. `learn-effect.ts` (d-007) asks whether sessions AFTER a
 * principle's evidence window went better than sessions before it. That design cannot
 * work here and d-008 recorded why: every principle was synthesized in one pass, so
 * their evidence windows all span the corpus and there is no "before". Arms came out
 * 3 pre / 6 post. Waiting for the corpus to age fixes it in about a year.
 *
 * THE FIX IS TO PAIR WITHIN A PROBE INSTEAD OF ACROSS TIME. Adapted from the
 * NullMemory paired counterfactual in "Remembering More, Risking More" (2026): hold the
 * input fixed, vary ONLY whether memory is present, and generate both arms under the
 * same model and decoding parameters. NullMemory is a real arm that runs, not a number
 * computed from the other arm. Because the pairing is within-probe, no temporal
 * ordering is required and the synthesis-all-at-once problem stops mattering entirely.
 *
 * DESIGN, fixed before any output is read:
 *   PROBES      episode goals used as task-onset prompts, sampled across domains. These
 *               are real openings from real sessions, not hand-authored.
 *   ARM MEM     prompt + the tier-2 injection the live gate would actually produce.
 *   ARM NULL    the identical prompt, no injection, same model, same parameters.
 *   OUTCOME     an independent judge reads both plans blind to which is which and
 *               answers, for the specific practice each principle prescribes, whether
 *               the plan commits to it.
 *   ATTRIBUTION the judge MUST quote a verbatim span from the plan to score a practice
 *               present. A claim with no quotable span is scored absent. This is the
 *               single most important control: without it a judge asked "did memory
 *               help" will say yes, because agreeable judges are the failure mode this
 *               vault already measured once (Phase 0b, REAL 16.3% vs CONTROL 3.8%).
 *   BLINDING    arm labels are stripped and presentation order is swapped on odd probes,
 *               so a positional preference cannot masquerade as an effect.
 *   STATISTIC   McNemar on discordant pairs. Pairs where both arms commit, or neither
 *               does, carry no information about the injection and are excluded from
 *               the test while still being reported.
 *
 * WHAT A NULL RESULT WOULD MEAN. That the principles are already implicit in how the
 * model works, and their value is documentation rather than behaviour change. That is a
 * real and publishable answer, not a failure, and it is why the stop rule in d-007 is
 * worth keeping.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir, summaryModel } from "./config";
import { currentLessons, type Lesson } from "./lessons";
import { llmMap, type LlmJob } from "./llm-pool";

const OUT = () => path.join(memDir(), "nullarm");
const ARG = (f: string, d: number) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};

interface Ep { session: string; goal: string; domain: string; scope?: string }

/** Deterministic shuffle: no Math.random, so a rerun hits the same cache entries. */
function pick<T>(arr: T[], n: number): T[] {
  const scored = arr.map((x, i) => ({ x, k: (i * 2654435761) % 1000003 }));
  scored.sort((a, b) => a.k - b.k);
  return scored.slice(0, n).map(s => s.x);
}

function renderInjection(ps: Lesson[]): string {
  return [
    "Method principles synthesized from how this kind of work has actually gone before.",
    "These are patterns across many past sessions, not rules. Weigh them against what",
    "you are actually doing; the 'stale if' line is the observation that would mean a",
    "principle no longer holds, so check for it rather than assuming either way.",
    ...ps.map(l => [
      `- ${l.action}`,
      `    why: ${l.statement}`,
      `    stale if: ${l.falsifier}`,
      `    [${l.domain}]`,
    ].join("\n")),
  ].join("\n");
}

const PLAN_INSTRUCTION =
  "You are about to start the task described in the user message. Write the concrete plan you would follow: " +
  "the specific steps, checks and order of operations. 200-350 words. Numbered steps. " +
  "No preamble, no restating the task, no closing summary. Write only the plan.";

async function main() {
  const REPORT_ONLY = process.argv.includes("--report");
  const N = ARG("--probes", 20);
  fs.mkdirSync(OUT(), { recursive: true });

  const principles = currentLessons()
    .filter(l => !l.invalid_at && l.status === "active" && (l.tier ?? 1) >= 2);
  if (principles.length < 3) { console.log("need >=3 active tier-2 principles"); return; }

  const eps: Ep[] = fs.readFileSync(path.join(memDir(), "episodes.jsonl"), "utf8")
    .split("\n").filter(l => l.trim()).map(l => JSON.parse(l));

  // Probes must not be the episodes the principles were BUILT from, or the test is
  // asking whether a principle reproduces its own source. Same leakage that made the
  // ReasoningBank keying look 20 points better than it was (d-021).
  const cited = new Set(principles.flatMap(p => p.cites || []));
  const pool = eps.filter(e => !cited.has(e.session) && e.goal && e.goal.length > 40 && e.scope !== "clinical");
  const probes = pick(pool, N);
  console.log(`${principles.length} principles | ${pool.length} uncited episodes available | ${probes.length} probes\n`);
  if (probes.length < 8) { console.log("too few uncited episodes to test; mine more first"); return; }

  const injection = renderInjection(principles);

  // ---- ARMS ------------------------------------------------------------------
  // Both arms are real generations under the same model and instruction. The ONLY
  // difference is the presence of the injected block.
  const jobs: LlmJob[] = [];
  for (const p of probes) {
    jobs.push({ instruction: PLAN_INSTRUCTION, stdin: `${injection}\n\n---\n\nTASK: ${p.goal}` });
    jobs.push({ instruction: PLAN_INSTRUCTION, stdin: `TASK: ${p.goal}` });
  }
  console.log(`generating ${jobs.length} plans (${probes.length} paired)...`);
  const plans = REPORT_ONLY ? [] : await llmMap(jobs, { label: "plan", model: summaryModel() });
  if (REPORT_ONLY) { console.log("--report needs a prior run's cache; rerun without it first"); return; }

  // ---- JUDGE -----------------------------------------------------------------
  // Blind, per-pair, with mandatory verbatim quoting. The judge never learns which
  // plan saw the principles, and on odd-indexed probes the two plans are swapped.
  const judgeJobs: LlmJob[] = [];
  const swapped: boolean[] = [];
  probes.forEach((p, i) => {
    const mem = plans[2 * i] || "", nul = plans[2 * i + 1] || "";
    const swap = i % 2 === 1;
    swapped.push(swap);
    const A = swap ? nul : mem, B = swap ? mem : nul;
    judgeJobs.push({
      instruction:
        "You are comparing two plans written for the same task by the same model. For EACH numbered practice below, " +
        "decide independently whether PLAN A commits to it and whether PLAN B commits to it.\n\n" +
        "RULES:\n" +
        "- To score a practice PRESENT in a plan you MUST quote a verbatim span from that plan that commits to it. " +
        "If you cannot quote such a span, it is ABSENT. A plan that is merely compatible with a practice does not commit to it.\n" +
        "- Judge each practice separately. Do not reward a plan for being longer or better written.\n" +
        "- Do not speculate about which plan had extra information.\n\n" +
        "Output STRICT JSON only, no prose:\n" +
        '{"practices":[{"n":1,"a":true,"a_quote":"...","b":false,"b_quote":""}]}\n' +
        'Use "" for the quote whenever the value is false.',
      stdin: [
        "PRACTICES:",
        ...principles.map((l, k) => `${k + 1}. ${l.action}`),
        "", "PLAN A:", A, "", "PLAN B:", B,
      ].join("\n"),
    });
  });
  console.log(`judging ${judgeJobs.length} pairs (blind, quote-required)...`);
  const verdicts = await llmMap(judgeJobs, { label: "judge", model: summaryModel() });

  // ---- TALLY -----------------------------------------------------------------
  // Per practice: how often did the MEM arm commit and the NULL arm not, and vice versa.
  const per = principles.map(l => ({ l, memOnly: 0, nullOnly: 0, both: 0, neither: 0 }));
  let parsed = 0, unquoted = 0;
  verdicts.forEach((v, i) => {
    if (!v) return;
    let obj: any;
    try { obj = JSON.parse(v.slice(v.indexOf("{"), v.lastIndexOf("}") + 1)); } catch { return; }
    if (!Array.isArray(obj?.practices)) return;
    parsed++;
    for (const pr of obj.practices) {
      const k = Number(pr.n) - 1;
      if (!(k >= 0 && k < per.length)) continue;
      // Enforce the quote requirement HERE rather than trusting the judge to have
      // applied it: a true with no verbatim span is downgraded to false.
      const planA = String(pr.a_quote || "").trim(), planB = String(pr.b_quote || "").trim();
      let a = pr.a === true && planA.length >= 12;
      let b = pr.b === true && planB.length >= 12;
      if ((pr.a === true && !a) || (pr.b === true && !b)) unquoted++;
      // Undo the presentation swap: recover which arm each slot actually was.
      const mem = swapped[i] ? b : a;
      const nul = swapped[i] ? a : b;
      const rec = per[k]!;
      if (mem && !nul) rec.memOnly++;
      else if (nul && !mem) rec.nullOnly++;
      else if (mem && nul) rec.both++;
      else rec.neither++;
    }
  });

  const memOnly = per.reduce((a, x) => a + x.memOnly, 0);
  const nullOnly = per.reduce((a, x) => a + x.nullOnly, 0);
  const both = per.reduce((a, x) => a + x.both, 0);
  const neither = per.reduce((a, x) => a + x.neither, 0);
  const disc = memOnly + nullOnly;

  console.log(`\n${"=".repeat(74)}`);
  console.log(`PAIRED NULL-ARM RESULT   ${parsed}/${probes.length} pairs judged, ${principles.length} practices each`);
  console.log(`  ${unquoted} claim(s) asserted without a quotable span and were downgraded to absent.\n`);
  console.log(`  both arms commit      ${String(both).padStart(4)}   (uninformative: the practice is default behaviour)`);
  console.log(`  neither commits       ${String(neither).padStart(4)}   (uninformative: the practice did not apply here)`);
  console.log(`  MEM only              ${String(memOnly).padStart(4)}   <- the injection added it`);
  console.log(`  NULL only             ${String(nullOnly).padStart(4)}   <- present without the injection`);

  if (disc < 10) {
    console.log(`\n  ONLY ${disc} DISCORDANT PAIRS. Too few to test. Raise --probes.`);
  } else {
    // McNemar, normal approximation. Two-sided.
    const chi = Math.pow(Math.abs(memOnly - nullOnly) - 1, 2) / disc;
    const z = Math.sqrt(chi);
    const p = 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)));
    console.log(`\n  McNemar over ${disc} discordant pairs: chi2 = ${chi.toFixed(2)}, p = ${p < 0.0001 ? "<0.0001" : p.toFixed(4)}`);
    console.log(`  ${memOnly > nullOnly ? "MEM" : "NULL"} arm commits more often.`);
    if (p < 0.05 && memOnly > nullOnly)
      console.log(`  => The injection changes what gets planned. This is the first evidence that\n     these principles correspond to a behaviour difference at all.`);
    else if (p >= 0.05)
      console.log(`  => No detectable difference. The principles may already be implicit in the\n     model's defaults, which makes them documentation rather than behaviour change.`);
  }

  console.log(`\n  per practice (mem-only / null-only / both / neither):`);
  for (const x of [...per].sort((a, b) => (b.memOnly - b.nullOnly) - (a.memOnly - a.nullOnly)))
    console.log(`    ${String(x.memOnly).padStart(3)} / ${String(x.nullOnly).padStart(3)} / ${String(x.both).padStart(3)} / ${String(x.neither).padStart(3)}   ${x.l.domain}`);

  const out = path.join(OUT(), `nullarm-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify({ probes: probes.length, parsed, principles: principles.length, memOnly, nullOnly, both, neither, unquoted, per: per.map(x => ({ id: x.l.id, domain: x.l.domain, memOnly: x.memOnly, nullOnly: x.nullOnly, both: x.both, neither: x.neither })) }, null, 2));
  console.log(`\n  wrote ${out}`);
}

/** Abramowitz-Stegun 7.1.26; enough precision for a p-value only compared to 0.05. */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  return s * (1 - poly * Math.exp(-ax * ax));
}
// Guarded: importing this module must not run the pass. A health check that imports
// every module to prove it parses would otherwise execute a full corpus scan, and on a
// fresh vault that fails with ENOENT on files the pass expects to already exist.
if (require.main === module) main();
