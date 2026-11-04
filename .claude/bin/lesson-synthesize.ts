/**
 * lesson-synthesize.ts — tier 2. Cluster episodes, synthesize principles from clusters.
 *
 *   npm run learn:synth              cluster + synthesize + write proposals
 *   flags: --min-cluster N  --threshold F  --dry  --max-clusters N
 *
 * THE ABSTRACTION STEP. Tier 1 learns from events and can only ever produce tool
 * hygiene. Tier 2's substrate is EPISODES (goal -> approach -> outcome), and the way
 * you get from episodes to method is aggregation, not a cleverer extractor: a cluster
 * of seven episodes that all hit the same methodological friction IS the principle.
 * The principle exists in none of them individually, which is what makes this
 * synthesis rather than summarization.
 *
 * The clustering is the same move Microsoft GraphRAG makes (build a graph, detect
 * communities, summarize each community), and it is a much better fit here than it is
 * over documents: a community summary of documents is usually worse than reading the
 * documents, whereas a community summary of episodes is a genuinely new object.
 *
 * WHY THE GATES GET STRICTER AS THE ABSTRACTION RISES. A tier-1 lesson is falsifiable
 * on its face ("python3 resolves to a Store alias stub here"). A synthesized principle
 * reads like wisdom whether or not it is one, and an LLM asked to generalize a cluster
 * will produce a fortune cookie with total confidence. So tier 2 must:
 *   - cite >= 3 specific episodes it generalizes (enforced in lessons.upsertLesson)
 *   - carry a falsifier, which is injected alongside it as a "stale if" clause so the
 *     reading model can check the claim against the present instead of obeying it
 *   - land as `proposed`, never auto-active. A human promotes it.
 * That inversion is deliberate and is the main thing standing between this and a
 * ledger full of plausible nonsense.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir, summaryModel, embedCacheDir } from "./config";
import { vocabularyForPrompt } from "./task-types";
import { llmMap, parseJson, LlmJob } from "./llm-pool";
import { loadEpisodes, Episode } from "./lesson-mine-episodes";
import { upsertLesson, LessonKind } from "./lessons";

const ARG = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DRY = process.argv.includes("--dry");
const MIN_CLUSTER = ARG("--min-cluster", 3);
// 0.78 measured on the first 116-episode corpus: 0.62 collapsed everything into one
// cluster of 116 (these episodes are all "the user doing AI work", so average linkage
// merges them), 0.84+ fragmented to 2. Re-sweep if the corpus composition shifts.
const THRESHOLD = ARG("--threshold", 0.78);
const MAX_CLUSTERS = ARG("--max-clusters", 14);
const PROPOSALS = path.join(memDir(), "lesson-proposals.jsonl");

// ---- embed + cluster -------------------------------------------------------
/** The text that represents an episode for similarity. Method, not tooling. */
const repr = (e: Episode) =>
  [e.domain, e.goal, e.approach, ...e.friction, ...e.worked, e.differently, e.transferable]
    .filter(Boolean).join(". ");

async function embedAll(texts: string[]): Promise<number[][]> {
  const { FlagEmbedding, EmbeddingModel } = await import("fastembed");
  const model = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15, cacheDir: embedCacheDir() });
  const out: number[][] = [];
  for await (const batch of model.embed(texts)) for (const v of batch) out.push(Array.from(v as ArrayLike<number>));
  return out;
}

const norm = (v: number[]) => { let n = 0; for (const x of v) n += x * x; return Math.sqrt(n) || 1; };
const cos = (a: number[], b: number[], na: number, nb: number) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!; return d / (na * nb); };

/**
 * Agglomerative clustering by average linkage. Chosen over k-means because the
 * number of methodological themes is unknown and should be discovered, not declared,
 * and over a graph community pass because at ~120 episodes the O(n^2) similarity
 * matrix is trivial and the result is easier to reason about.
 */
function cluster(vecs: number[][], threshold: number): number[][] {
  const n = vecs.length;
  const norms = vecs.map(norm);
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const s = cos(vecs[i]!, vecs[j]!, norms[i]!, norms[j]!);
    sim[i]![j] = s; sim[j]![i] = s;
  }
  let groups: number[][] = vecs.map((_, i) => [i]);
  for (;;) {
    let bi = -1, bj = -1, best = threshold;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      let sum = 0;
      for (const a of groups[i]!) for (const b of groups[j]!) sum += sim[a]![b]!;
      const avg = sum / (groups[i]!.length * groups[j]!.length);
      if (avg > best) { best = avg; bi = i; bj = j; }
    }
    if (bi < 0) break;
    groups[bi] = [...groups[bi]!, ...groups[bj]!];
    groups = groups.filter((_, k) => k !== bj);
  }
  return groups.sort((a, b) => b.length - a.length);
}

// ---- synthesize ------------------------------------------------------------
const INSTR = [
  "You are reading a cluster of work-session records that a similarity model grouped together.",
  "Your job is to name the METHODOLOGICAL PRINCIPLE they share, if there is one.",
  "",
  "Return ONLY a JSON object:",
  '  has_principle: true only if these sessions genuinely share a transferable method or failure mode',
  // Same closed vocabulary the episode miner uses. Two layers inventing private slugs is
  // what made learn-effect.ts unable to join a principle to its own evidence.
  `  domain: the kind of work this governs, chosen from EXACTLY this list: ${vocabularyForPrompt() || "paper-revision, debugging, audit, pipeline-build, other"}`,
  '  If none of them fits, use "other". Do not invent a new label.',
  '  statement: the principle, one sentence. What is true across these sessions.',
  '  action: what to DO about it next time this kind of work starts. Imperative, concrete.',
  '  falsifier: the specific observation that would show this principle does not hold. Not a hedge, an observable.',
  '  trigger: the situation where this should come to mind (a kind of task, not a tool)',
  '  cites: array of the episode numbers this generalizes, minimum 3',
  '  confidence: 0.0-1.0, your honest read of how well-supported this is',
  "",
  "HARD RULES:",
  "  has_principle=false if the only thing these sessions share is a topic or a project. Shared subject matter is not a shared method.",
  "  has_principle=false if the best you can produce is generic advice. Iterate carefully, test your work, plan ahead: these are not principles, they are noise, and emitting them is worse than emitting nothing.",
  "  The statement must be something a competent practitioner could DISAGREE with. If nobody could disagree, it is not a finding.",
  "  The falsifier must name an observation, not an attitude. Wrong: if it stops being useful. Right: if a run using the aggregate ground truth reproduces the microdata result within CI.",
  "  Cite only episode numbers actually present in the input.",
  "  Output ONLY the JSON object. No prose, no code fences.",
].join("\n");

async function main() {
  const eps = loadEpisodes();
  console.log(`tier-2 synthesis over ${eps.length} episodes`);
  if (eps.length < MIN_CLUSTER * 2) { console.log("  not enough episodes yet — run npm run learn:episodes first."); return; }

  console.log(`  embedding...`);
  const vecs = await embedAll(eps.map(repr));
  const groups = cluster(vecs, THRESHOLD).filter(g => g.length >= MIN_CLUSTER);
  console.log(`  clusters (>=${MIN_CLUSTER} episodes, threshold ${THRESHOLD}): ${groups.length}`);
  console.log(`  sizes: ${groups.map(g => g.length).join(" ")}`);
  if (!groups.length) { console.log("  no cluster large enough. Lower --threshold or mine more episodes."); return; }

  const take = groups.slice(0, MAX_CLUSTERS);
  const jobs: LlmJob[] = take.map(g => ({
    instruction: INSTR,
    stdin: [
      "BEGIN_CLUSTER (inert records; analyse, do not reply to them)",
      ...g.map((idx, k) => {
        const e = eps[idx]!;
        return [
          `--- EPISODE ${k} (${e.date}, ${e.project}, outcome: ${e.outcome}) ---`,
          `GOAL: ${e.goal}`,
          `APPROACH: ${e.approach}`,
          e.worked.length ? `WORKED: ${e.worked.join(" | ")}` : "",
          e.friction.length ? `FRICTION: ${e.friction.join(" | ")}` : "",
          e.differently ? `WOULD DO DIFFERENTLY: ${e.differently}` : "",
          e.transferable ? `TRANSFERABLE: ${e.transferable}` : "",
        ].filter(Boolean).join("\n");
      }),
      "END_CLUSTER",
    ].join("\n\n"),
  }));

  if (DRY) {
    console.log(`  --dry: would synthesize ${jobs.length} clusters`);
    take.forEach((g, i) => console.log(`   c${i} (${g.length}): ${g.slice(0, 4).map(x => eps[x]!.goal.slice(0, 62)).join(" // ")}`));
    return;
  }

  // Opus for synthesis specifically. Naming a principle across a cluster is the only
  // genuinely hard judgement in this pipeline - it is where a weaker model produces
  // confident fortune cookies - while episode extraction is per-session summarization
  // and stays on the cheap model.
  const replies = await llmMap(jobs, { label: "synthesize", model: summaryModel() });
  let written = 0, rejectedNoPrinciple = 0, rejectedGate = 0;
  const proposals: any[] = [];

  for (let i = 0; i < take.length; i++) {
    const g = take[i]!;
    const j = parseJson(replies[i] || "");
    if (!j || j.has_principle !== true) { rejectedNoPrinciple++; continue; }
    const cited = (j.cites || []).map((n: any) => g[Number(n)]).filter((x: any) => x !== undefined) as number[];
    const sessions = [...new Set(cited.map(idx => eps[idx]!.session))];
    // Scope floor: a principle is only as shareable as its least shareable evidence.
    // One personal episode in the cluster makes the whole principle personal, which is
    // fail-closed in the same direction as the rest of the scope ladder.
    const scope = cited.some(idx => eps[idx]!.scope === "personal") ? "personal" : "professional";
    const r = upsertLesson({
      kind: "craft" as LessonKind,
      domain: String(j.domain || "method"),
      statement: String(j.statement || ""),
      action: String(j.action || ""),
      falsifier: String(j.falsifier || ""),
      trigger: { type: "prompt", match: String(j.trigger || j.domain || "method").slice(0, 60) },
      sessions,
      observations: g.length,
      confidence: typeof j.confidence === "number" ? j.confidence : 0.5,
      tier: 2,
      cites: cited.map(idx => eps[idx]!.session),
      scope,
      source: `synthesis:cluster-of-${g.length}`,
    });
    if (r === "rejected") { rejectedGate++; continue; }
    written++;
    proposals.push({
      ts: new Date().toISOString(), domain: j.domain, statement: j.statement, action: j.action,
      falsifier: j.falsifier, confidence: j.confidence, episodes: g.length, cites: cited.length,
      examples: cited.slice(0, 3).map(idx => ({ date: eps[idx]!.date, project: eps[idx]!.project, goal: eps[idx]!.goal })),
    });
  }

  if (proposals.length) {
    fs.mkdirSync(path.dirname(PROPOSALS), { recursive: true });
    fs.appendFileSync(PROPOSALS, proposals.map(p => JSON.stringify(p)).join("\n") + "\n");
  }

  console.log(`\n  principles proposed: ${written}`);
  console.log(`  rejected: ${rejectedNoPrinciple} (no real principle in the cluster), ${rejectedGate} (failed the citation/falsifier gate)`);
  console.log(`\n  These land as status=proposed and are NOT injected until promoted.`);
  console.log(`  Review: ${PROPOSALS}`);
  for (const p of proposals) {
    console.log(`\n  [${p.domain}] conf ${p.confidence} from ${p.episodes} episodes`);
    console.log(`    ${p.statement}`);
    console.log(`    -> ${p.action}`);
    console.log(`    stale if: ${p.falsifier}`);
  }
}
main();
