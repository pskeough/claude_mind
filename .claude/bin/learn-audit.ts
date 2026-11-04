/**
 * learn-audit.ts — structural audit of the lesson ledger and its delivery paths.
 *
 *   npm run learn:audit
 *
 * health-check.ts asserts the invariants I already knew to assert; it passes by
 * construction. This looks for defects nobody wrote a check for yet, by measuring
 * properties of the ledger rather than confirming its schema:
 *
 *   REDUNDANCY   near-duplicate lessons competing for the same budget slot. The
 *                preference channel got semantic grouping at 0.80 cosine; the
 *                hygiene channel never did, so the same remedy can be mined three
 *                times under three phrasings and evict three genuinely distinct rules.
 *   TRUNCATION   the falsifier is the anti-slop mechanism. If the delivery path cuts
 *                it mid-word the model cannot check it, and an unfalsifiable rule is
 *                exactly what the gate exists to prevent.
 *   DEAD WEIGHT  active lessons that no trigger rule can ever fire and no injection
 *                has ever surfaced: budget consumed for nothing.
 *   TAXONOMY     domains holding a single lesson forever, which the per-domain budget
 *                can never evict, because two miners invent private vocabularies.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir } from "./config";
import { activeLessons, currentLessons, type Lesson } from "./lessons";
import { embedPassages } from "./vector-engine";

const cos = (a: Float32Array | number[], b: Float32Array | number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1e-12);
};

async function main() {
  const act = activeLessons();
  const all = currentLessons();
  console.log(`lesson ledger audit — ${act.length} active of ${all.length} current\n`);

  // ---- REDUNDANCY -------------------------------------------------------------
  // Compare on ACTION, not statement. Two lessons that describe the same failure in
  // different words are fine; two that prescribe the same remedy are one lesson
  // wearing two hats, and only one of them can ever be the thing you actually do.
  console.log("== redundancy (same remedy, different phrasing) ==");
  const embedded = await embedPassages(act.map(l => l.action));
  const vecs = new Map<string, number[]>();
  act.forEach((l, i) => vecs.set(l.id, embedded[i]!));
  const dupes: Array<{ a: Lesson; b: Lesson; sim: number }> = [];
  for (let i = 0; i < act.length; i++) {
    for (let j = i + 1; j < act.length; j++) {
      const a = act[i]!, b = act[j]!;
      if (a.domain !== b.domain) continue;
      const sim = cos(vecs.get(a.id)!, vecs.get(b.id)!);
      if (sim >= 0.80) dupes.push({ a, b, sim });
    }
  }
  dupes.sort((x, y) => y.sim - x.sim);
  const byDomain = new Map<string, number>();
  for (const d of dupes) byDomain.set(d.a.domain, (byDomain.get(d.a.domain) || 0) + 1);
  console.log(`  ${dupes.length} near-duplicate pairs at >=0.80 cosine on the ACTION`);
  for (const d of dupes.slice(0, 12))
    console.log(`  ${d.sim.toFixed(3)} [${d.a.domain}] ${d.a.id} / ${d.b.id}\n         A: ${d.a.action.slice(0, 96)}\n         B: ${d.b.action.slice(0, 96)}`);
  if (byDomain.size) console.log(`  by domain: ${[...byDomain].map(([k, v]) => `${k}=${v}`).join(", ")}`);

  // ---- TRUNCATION -------------------------------------------------------------
  console.log("\n== falsifier delivery ==");
  const pb = fs.readFileSync(path.join(memDir(), "PLAYBOOK.md"), "utf8");
  const staleLines = pb.split("\n").filter(l => l.includes("stale if:"));
  const cut = staleLines.filter(l => {
    const body = l.split("stale if:")[1]?.trim() || "";
    return body.length > 0 && !/[.!?]$/.test(body);
  });
  console.log(`  ${staleLines.length} 'stale if' lines rendered, ${cut.length} end mid-sentence`);
  for (const c of cut.slice(0, 4)) console.log(`  CUT: ...${c.trim().slice(-70)}`);

  // ---- DEAD WEIGHT ------------------------------------------------------------
  console.log("\n== reachability ==");
  const trig = JSON.parse(fs.readFileSync(path.join(memDir(), "lesson-triggers.json"), "utf8"));
  const reachable = new Set<string>(trig.rules.map((r: any) => r.id));
  const tier1 = act.filter(l => (l.tier ?? 1) < 2 && l.kind !== "preference");
  const unreachable = tier1.filter(l => !reachable.has(l.id));
  console.log(`  ${trig.rules.length} trigger rules cover ${reachable.size} distinct lessons`);
  console.log(`  ${unreachable.length} of ${tier1.length} active hygiene lessons have NO trigger rule`);
  console.log(`  (those reach the model only via PLAYBOOK.md, which is capped — see the ranking slots)`);

  // ---- UTILITY ----------------------------------------------------------------
  console.log("\n== utility signal ==");
  const everInjected = act.filter(l => (l.injected ?? 0) > 0).length;
  const everHelped = act.filter(l => (l.helped ?? 0) > 0).length;
  console.log(`  injected>0: ${everInjected}/${act.length}   helped>0: ${everHelped}/${act.length}`);
  if (everInjected === 0)
    console.log(`  NO UTILITY SIGNAL. The per-domain budget therefore evicts by recency and\n  observation count, never by whether a lesson has ever been useful.`);

  // ---- TAXONOMY ---------------------------------------------------------------
  console.log("\n== domain taxonomy ==");
  // Report the bucket the BUDGET actually uses, not the raw domain. Reporting `domain`
  // here while enforceBudget() buckets on taskType would show 23 un-evictable singletons
  // that the budget does not in fact see.
  const dom = new Map<string, Lesson[]>();
  for (const l of act) {
    const k = (l as any).taskType || l.domain;
    (dom.get(k) ?? dom.set(k, []).get(k)!).push(l);
  }
  const singles = [...dom].filter(([, v]) => v.length === 1);
  console.log(`  ${dom.size} domains, ${singles.length} hold exactly one lesson`);
  const over = [...dom].filter(([, v]) => v.length >= 20);
  for (const [k, v] of over) console.log(`  AT/NEAR BUDGET: ${k} = ${v.length}/25`);
  console.log(`  singletons: ${singles.map(([k]) => k).slice(0, 20).join(", ")}`);
}
// Guarded: importing this module must not run the pass. A health check that imports
// every module to prove it parses would otherwise execute a full corpus scan, and on a
// fresh vault that fails with ENOENT on files the pass expects to already exist.
if (require.main === module) main();
