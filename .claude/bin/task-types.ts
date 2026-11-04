/**
 * task-types.ts — the closed vocabulary of KINDS OF WORK.
 *
 *   npm run tasktypes              derive and print (no writes)
 *   npm run tasktypes -- --apply   freeze the vocabulary and retag episodes + tier-2
 *
 * WHY A CLOSED SET. The episode miner and the synthesizer were each told to invent "a
 * short slug you choose", so each invented its own: 81 distinct domains over 172
 * episodes, 24 of them used exactly once, and the two layers never shared a key. Three
 * problems that were tracked separately are all downstream of that one choice:
 *
 *   P1  matching a prompt to a principle has nothing discrete to key on, so it is a
 *       cosine race in a 0.47-0.65 band
 *   P2  learn-effect.ts cannot join episodes to the principles built from them, so both
 *       arms come back near-empty
 *   P4  22 of 33 lesson domains hold exactly one lesson, which a per-domain budget can
 *       never evict
 *
 * DERIVED, NOT DECREED. The vocabulary is not a taxonomy someone imagined; it is the
 * observed one, agglomerated. Pre-registered in d-018 with the condition to proceed only
 * if the labels genuinely collapse AND the groups read as real kinds of work. Measured in
 * d-019: 81 -> 27 groups at 0.90 cosine, top 14 covering ~140 of 172 episodes. 0.86 was
 * too coarse (6 buckets, writing and auditing and tooling merged); 0.92 left 21
 * singletons and reproduced the original problem.
 *
 * The frozen file is the contract. Once written, the miners select FROM it rather than
 * inventing, so the vocabulary drifts only when a human re-derives it. A slug that
 * matches nothing falls to `other` rather than silently minting a 28th type, because
 * silent minting is exactly how this got to 81.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir } from "./config";
import { embedPassages } from "./vector-engine";

export const TYPES_FILE = () => path.join(memDir(), "task-types.json");
const THRESHOLD = 0.90;

export interface TaskType { name: string; aliases: string[]; episodes: number }
export interface TaskTypeIndex { derived: string; threshold: number; types: TaskType[] }

let _idx: TaskTypeIndex | null | undefined;
export function taskTypes(): TaskTypeIndex | null {
  if (_idx !== undefined) return _idx;
  try { _idx = JSON.parse(fs.readFileSync(TYPES_FILE(), "utf8")); } catch { _idx = null; }
  return _idx;
}

/** Map any slug (old or new) onto the frozen vocabulary. Unknown falls to `other`. */
export function classify(slug: string): string {
  const idx = taskTypes();
  if (!idx) return slug;
  const s = String(slug || "").toLowerCase().trim();
  for (const t of idx.types) if (t.name === s || t.aliases.includes(s)) return t.name;
  return "other";
}

/** The vocabulary as a prompt fragment, so miners select instead of inventing. */
export function vocabularyForPrompt(): string {
  const idx = taskTypes();
  if (!idx) return "";
  return idx.types.map(t => t.name).join(", ");
}

/**
 * Superordinate names for groups whose largest member is narrower than the group.
 *
 * Clustering is mechanical; NAMING is a judgment and is made here rather than taken from
 * whichever member happened to have the most episodes. The group holding
 * `hardware-debugging` and `mcp-server-debugging` was being called
 * `voice-pipeline-debugging` purely on volume, and a principle carrying that tag reads
 * as narrower than the evidence behind it - which is exactly how a good principle gets
 * discounted at read time. Keys are the mechanical head, values are what the group is.
 * A head not listed here is already an adequate name for its group.
 */
const CANONICAL: Record<string, string> = {
  "paper-revision": "writing-and-revision",
  "personal-conv": "personal-conversation",
  "preference-mining": "preference-and-recommendation",
  "data-audit": "audit",
  "research-design": "research-and-strategy-design",
  "developer-tooling-distribution": "tooling-and-ui-build",
  "feed-pipeline": "pipeline-build",
  "voice-pipeline-debugging": "debugging",
  "image-generation": "image-and-asset-generation",
  "game-setup": "game-development",
  "env-catalog-build": "environment-setup",
  "persona-retrieval": "corpus-and-persona-extraction",
  "research-query": "research-exploration",
  "content-curation-pipeline": "content-curation",
};

const cos = (p: number[], q: number[]) => {
  let d = 0, a = 0, b = 0;
  for (let i = 0; i < p.length; i++) { d += p[i]! * q[i]!; a += p[i]! * p[i]!; b += q[i]! * q[i]!; }
  return d / (Math.sqrt(a) * Math.sqrt(b) || 1e-12);
};

async function derive(): Promise<TaskType[]> {
  const eps = fs.readFileSync(path.join(memDir(), "episodes.jsonl"), "utf8")
    .split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
  const counts = new Map<string, number>();
  for (const e of eps) counts.set(e.domain, (counts.get(e.domain) || 0) + 1);
  const labels = [...counts.keys()];
  // Embed the label as a phrase. A slug carries almost no signal as a bare token and
  // plenty inside a sentence about the kind of work it names.
  const vecs = await embedPassages(labels.map(l => `a work session about ${l.replace(/[-_]/g, " ")}`));

  // Seed by frequency so the biggest real kinds of work become the cluster centres,
  // rather than whichever label happens to sort first.
  const order = labels.map((l, i) => ({ l, i, n: counts.get(l)! })).sort((a, b) => b.n - a.n);
  const clusters: Array<{ members: number[]; head: string; n: number }> = [];
  for (const { l, i, n } of order) {
    let best: { c: typeof clusters[0]; s: number } | null = null;
    for (const c of clusters) {
      const s = c.members.reduce((acc, m) => acc + cos(vecs[m]!, vecs[i]!), 0) / c.members.length;
      if (s >= THRESHOLD && (!best || s > best.s)) best = { c, s };
    }
    if (best) { best.c.members.push(i); best.c.n += n; }
    else clusters.push({ members: [i], head: l, n });
  }
  clusters.sort((a, b) => b.n - a.n);
  return clusters.map(c => {
    const name = CANONICAL[c.head] || c.head;
    // The mechanical head stays an alias whenever it is not the name, so every slug the
    // miners have ever emitted still resolves and no history becomes unclassifiable.
    const aliases = [...new Set(c.members.map(m => labels[m]!).filter(x => x !== name))];
    return { name, aliases, episodes: c.n };
  });
}

async function main() {
  const APPLY = process.argv.includes("--apply");
  const types = await derive();
  console.log(`derived ${types.length} task types at cosine ${THRESHOLD}\n`);
  for (const t of types.slice(0, 16))
    console.log(`  ${String(t.episodes).padStart(3)} ep  ${t.name}${t.aliases.length ? `  <- ${t.aliases.slice(0, 6).join(", ")}${t.aliases.length > 6 ? ` +${t.aliases.length - 6}` : ""}` : ""}`);
  if (types.length > 16) console.log(`  ... ${types.length - 16} more`);

  if (!APPLY) { console.log(`\nDRY RUN — add --apply to freeze and retag`); return; }

  const idx: TaskTypeIndex = { derived: new Date().toISOString().slice(0, 10), threshold: THRESHOLD, types };
  fs.writeFileSync(TYPES_FILE(), JSON.stringify(idx, null, 2));
  _idx = idx;
  console.log(`\nfroze ${types.length} types -> ${TYPES_FILE()}`);

  // Retag episodes in place. `domain` is preserved as-is; `taskType` is the new joinable
  // key, so nothing downstream that reads `domain` changes behaviour.
  const epPath = path.join(memDir(), "episodes.jsonl");
  const eps = fs.readFileSync(epPath, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
  let tagged = 0;
  for (const e of eps) { const t = classify(e.domain); if (t !== e.taskType) { e.taskType = t; tagged++; } }
  fs.writeFileSync(epPath, eps.map(e => JSON.stringify(e)).join("\n") + "\n");
  console.log(`retagged ${tagged}/${eps.length} episodes with taskType`);

  // Tier-2 principles inherit the MODAL task type of the episodes they cite, which is
  // stronger than classifying the synthesizer's own invented slug: the evidence is what
  // the principle is actually about.
  const { currentLessons, LEDGER } = await import("./lessons");
  const bySession = new Map(eps.map((e: any) => [e.session, e]));
  const t2 = currentLessons().filter(l => (l.tier ?? 1) >= 2 && l.status !== "retired");
  let wrote = 0;
  for (const l of t2) {
    const votes = new Map<string, number>();
    for (const s of l.cites || []) {
      const t = (bySession.get(s) as any)?.taskType;
      if (t) votes.set(t, (votes.get(t) || 0) + 1);
    }
    if (!votes.size) continue;
    const modal = [...votes].sort((a, b) => b[1] - a[1])[0]![0];
    if ((l as any).taskType === modal) continue;
    fs.appendFileSync(LEDGER(), JSON.stringify({ ...l, taskType: modal, source: `${l.source} | taskType from cited episodes` }) + "\n");
    wrote++;
  }
  console.log(`tagged ${wrote}/${t2.length} tier-2 principles with the modal taskType of their evidence`);
  console.log(`\nMiners now select from this vocabulary instead of inventing a slug.`);
}

if (require.main === module) main();
