/**
 * eval-method-routing.ts — can anything rank tier-2 principles correctly?
 *
 *   npx tsx .claude/bin/eval-method-routing.ts
 *
 * WHY THIS EXISTS. Every attempt to rank method principles has been judged by reading
 * three prompts and squinting: a cross-encoder was tried and reverted (d-013), a floor
 * was tuned 0.42 -> 0.52 on one example, and the fits still cluster in 0.47-0.65 with no
 * separation. None of that was measured, because there was no ground truth to measure
 * against.
 *
 * THE GROUND TRUTH WAS ALREADY IN THE LEDGER. A tier-2 principle cites the episodes it
 * was synthesized from, and every episode carries the GOAL of the session it came from.
 * So for each cited episode, its goal is a task-onset prompt whose correct principle is
 * known by construction. That gives a labelled probe set with no hand-authoring and no
 * judge.
 *
 * THE TWO KEYINGS COMPARED, per ReasoningBank (arXiv 2509.25140), whose load-bearing
 * detail is not the one its abstract advertises: it embeds the TASK QUERY and searches
 * over PAST TASK QUERIES, never over the memory content. LKHS currently does the
 * opposite - it scores the prompt against the principle's own situation text.
 *
 *   situation  cos(prompt, "trigger. domain. statement")     <- what the daemon does now
 *   goal       max over cited episodes of cos(prompt, goal)  <- ReasoningBank keying
 *   blend      max(situation, goal)
 *
 * HONEST LIMIT, stated before the numbers. A goal is the query the principle was BUILT
 * from, so goal-keying is being tested partly on its own training text. The leave-one-out
 * arm exists for that reason: it scores each probe with the matching episode's own goal
 * EXCLUDED from that principle's key, which is the only arm that says anything about a
 * genuinely new prompt. Read that column, not the headline.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir } from "./config";
import { currentLessons } from "./lessons";
import { embedPassages } from "./vector-engine";

const cos = (p: number[], q: number[]) => {
  let d = 0, a = 0, b = 0;
  for (let i = 0; i < p.length; i++) { d += p[i]! * q[i]!; a += p[i]! * p[i]!; b += q[i]! * q[i]!; }
  return d / (Math.sqrt(a) * Math.sqrt(b) || 1e-12);
};

interface Ep { session: string; goal: string; domain: string }

async function main() {
  const eps: Ep[] = fs.readFileSync(path.join(memDir(), "episodes.jsonl"), "utf8")
    .split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
  const epBySession = new Map(eps.map(e => [e.session, e]));

  const principles = currentLessons()
    .filter(l => !l.invalid_at && l.status === "active" && (l.tier ?? 1) >= 2 && (l.cites?.length ?? 0) > 0);
  if (principles.length < 2) { console.log("need >=2 active tier-2 principles"); return; }

  // Probes: one per (principle, cited episode) pair where the episode still exists.
  const probes: Array<{ q: string; correct: string; session: string }> = [];
  for (const p of principles)
    for (const s of p.cites!) {
      const e = epBySession.get(s);
      if (e?.goal && e.goal.length > 20) probes.push({ q: e.goal, correct: p.id, session: s });
    }
  console.log(`${principles.length} principles, ${probes.length} labelled probes (one per cited episode)\n`);

  // Embed everything in two batched calls.
  const sitTexts = principles.map(p => `${p.trigger?.match || p.domain}. ${p.domain}. ${p.statement}`);
  const goalOf = new Map<string, string[]>();
  for (const p of principles)
    goalOf.set(p.id, (p.cites || []).map(s => epBySession.get(s)?.goal).filter((g): g is string => !!g));
  const allGoals = [...new Set([...goalOf.values()].flat())];

  const [sitV, goalV, probeV] = await Promise.all([
    embedPassages(sitTexts),
    embedPassages(allGoals),
    embedPassages(probes.map(p => p.q)),
  ]);
  const goalVec = new Map(allGoals.map((g, i) => [g, goalV[i]!]));
  const sitVec = new Map(principles.map((p, i) => [p.id, sitV[i]!]));

  const score = (mode: "situation" | "goal" | "blend", pv: number[], pid: string, excludeGoal?: string) => {
    const sit = cos(pv, sitVec.get(pid)!);
    if (mode === "situation") return sit;
    const gs = (goalOf.get(pid) || []).filter(g => g !== excludeGoal).map(g => cos(pv, goalVec.get(g)!));
    const goal = gs.length ? Math.max(...gs) : -1;
    return mode === "goal" ? goal : Math.max(sit, goal);
  };

  const arms: Array<{ name: string; mode: "situation" | "goal" | "blend"; loo: boolean }> = [
    { name: "situation (current)", mode: "situation", loo: false },
    { name: "goal", mode: "goal", loo: false },
    { name: "goal (leave-one-out)", mode: "goal", loo: true },
    { name: "blend", mode: "blend", loo: false },
    { name: "blend (leave-one-out)", mode: "blend", loo: true },
  ];

  console.log(`  ${"arm".padEnd(22)} ${"top1".padStart(6)} ${"top3".padStart(6)} ${"MRR".padStart(6)}   separation (correct minus best wrong)`);
  for (const arm of arms) {
    let top1 = 0, top3 = 0, mrr = 0, sep = 0, n = 0;
    for (let i = 0; i < probes.length; i++) {
      const pr = probes[i]!;
      const ex = arm.loo ? pr.q : undefined;
      const ranked = principles
        .map(p => ({ id: p.id, s: score(arm.mode, probeV[i]!, p.id, ex) }))
        .sort((a, b) => b.s - a.s);
      const rank = ranked.findIndex(r => r.id === pr.correct) + 1;
      if (!rank) continue;
      n++;
      if (rank === 1) top1++;
      if (rank <= 3) top3++;
      mrr += 1 / rank;
      const mine = ranked.find(r => r.id === pr.correct)!.s;
      const bestWrong = ranked.find(r => r.id !== pr.correct)!.s;
      sep += mine - bestWrong;
    }
    const pct = (x: number) => `${((100 * x) / n).toFixed(1)}%`;
    console.log(`  ${arm.name.padEnd(22)} ${pct(top1).padStart(6)} ${pct(top3).padStart(6)} ${(mrr / n).toFixed(3).padStart(6)}   ${(sep / n >= 0 ? "+" : "") + (sep / n).toFixed(3)}`);
  }

  console.log(`\n  Random baseline for ${principles.length} principles: top1 ${(100 / principles.length).toFixed(1)}%, MRR ~${(
    Array.from({ length: principles.length }, (_, k) => 1 / (k + 1)).reduce((a, b) => a + b, 0) / principles.length
  ).toFixed(3)}`);
  console.log(`\n  The leave-one-out rows are the ones that generalize. A non-LOO goal arm is`);
  console.log(`  partly scoring against its own source text and will flatter itself.`);
}
// Guarded: importing this module must not run the pass. A health check that imports
// every module to prove it parses would otherwise execute a full corpus scan, and on a
// fresh vault that fails with ENOENT on files the pass expects to already exist.
if (require.main === module) main();
