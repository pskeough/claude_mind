/**
 * learn-taxonomy.ts — how much of the domain explosion is real?
 *
 *   npx tsx .claude/bin/learn-taxonomy.ts
 *
 * The episode miner invents a domain slug per session and the synthesizer invents
 * another per cluster, so neither can join to the other and neither can join to the
 * lesson budget. Measured: 81 distinct episode domains over 172 episodes, 24 of them
 * holding exactly one episode; on the lesson side, 22 of 33 domains hold exactly one
 * lesson and can therefore never be evicted by a per-domain budget.
 *
 * This does not fix it. It measures what a CLOSED vocabulary would collapse to, so the
 * decision to build one is made against a number instead of an intuition. Labels are
 * embedded and agglomerated; the question is whether the 81 slugs are 81 genuinely
 * different kinds of work or a handful wearing many names.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir } from "./config";
import { embedPassages } from "./vector-engine";

const cos = (p: number[], q: number[]) => {
  let d = 0, a = 0, b = 0;
  for (let i = 0; i < p.length; i++) { d += p[i]! * q[i]!; a += p[i]! * p[i]!; b += q[i]! * q[i]!; }
  return d / (Math.sqrt(a) * Math.sqrt(b) || 1e-12);
};

async function main() {
  const eps = fs.readFileSync(path.join(memDir(), "episodes.jsonl"), "utf8")
    .split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
  const counts = new Map<string, number>();
  for (const e of eps) counts.set(e.domain, (counts.get(e.domain) || 0) + 1);
  const labels = [...counts.keys()];
  console.log(`${labels.length} distinct episode domains over ${eps.length} episodes\n`);

  // Embed the label as a phrase, not a slug: "paper-revision" carries almost no signal
  // as a token but plenty as "paper revision" in a sentence about the kind of work.
  const vecs = await embedPassages(labels.map(l => `a work session about ${l.replace(/[-_]/g, " ")}`));

  for (const TH of [0.86, 0.88, 0.90, 0.92]) {
    // Average-linkage agglomeration, seeded by frequency so the biggest genuine kinds of
    // work become the cluster centres rather than whatever sorts first.
    const order = labels.map((l, i) => ({ l, i, n: counts.get(l)! })).sort((a, b) => b.n - a.n);
    const clusters: Array<{ members: number[]; head: string; n: number }> = [];
    for (const { l, i, n } of order) {
      let best: { c: typeof clusters[0]; s: number } | null = null;
      for (const c of clusters) {
        const s = c.members.reduce((acc, m) => acc + cos(vecs[m]!, vecs[i]!), 0) / c.members.length;
        if (s >= TH && (!best || s > best.s)) best = { c, s };
      }
      if (best) { best.c.members.push(i); best.c.n += n; }
      else clusters.push({ members: [i], head: l, n });
    }
    clusters.sort((a, b) => b.n - a.n);
    const singles = clusters.filter(c => c.members.length === 1).length;
    console.log(`threshold ${TH}: ${labels.length} labels -> ${clusters.length} groups  (${singles} still singletons)`);
    if (TH === 0.90) {
      console.log(`\n  groups at 0.90, by episode volume:`);
      for (const c of clusters.slice(0, 14))
        console.log(`    ${String(c.n).padStart(3)} ep  ${c.head}${c.members.length > 1 ? `  <- ${c.members.slice(1).map(m => labels[m]).join(", ")}` : ""}`);
      console.log(`    ... ${clusters.length - 14} more groups`);
    }
  }
  console.log(`\nA closed vocabulary is worth building only if the collapse is large AND the`);
  console.log(`groups are recognisable kinds of work. Read the 0.90 listing above and judge that,`);
  console.log(`rather than taking the ratio on its own.`);
}
// Guarded: importing this module must not run the pass. A health check that imports
// every module to prove it parses would otherwise execute a full corpus scan, and on a
// fresh vault that fails with ENOENT on files the pass expects to already exist.
if (require.main === module) main();
