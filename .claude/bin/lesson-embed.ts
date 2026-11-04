/**
 * lesson-embed.ts — put lessons where the retriever can find them.
 *
 *   npm run learn:embed          embed active lessons into the store
 *   flags: --all (include proposed)  --dry
 *
 * WHY. Until now lessons reached a session exactly one way: rendered into
 * PLAYBOOK.md and injected wholesale at SessionStart. That has two defects.
 *
 *   1. Budget, not relevance. Only ~22 entries fit, ranked by recurrence, so a
 *      lesson is present because it is FREQUENT rather than because it is RELEVANT
 *      to what you are doing right now. A LaTeX lesson rides along in a TypeScript
 *      session and a browser lesson rides along while writing prose.
 *   2. A second, profile-blind injection path. A static file rendered under one
 *      profile and read by a hook that knows nothing about profiles is a scope leak
 *      waiting to happen. The 58-probe leak harness covers the gate; it does not
 *      cover a file.
 *
 * Embedding fixes both at once. Lessons become ordinary chunks in the `lesson`
 * layer, so the daemon gate retrieves them by meaning, the cross-encoder judges them
 * against the prompt like anything else, and the scope ceiling is enforced at the
 * STORE — the one place already covered by the leak harness. The static playbook
 * drops to professional-scope only and personal preferences travel this path instead.
 *
 * The path encodes the scope (`lessons/<scope>/<id>.md`) because chunk scope is
 * DERIVED from the path (config.scopeOfChunk + the chunkScopes prefixes in
 * lkhs.config.json), never stored per row. That keeps one scope mechanism for the
 * whole store rather than a special case for this layer.
 */
import * as fs from "fs";
import { embedCacheDir } from "./config";
import { getDb, upsertFile, deleteFile, sha256, allFiles } from "./store";
import { currentLessons, writeTriggerIndex, Lesson } from "./lessons";

const ALL = process.argv.includes("--all");
const DRY = process.argv.includes("--dry");

/**
 * The retrievable text. Deliberately front-loads the ACTION and the trigger: a query
 * like "how should I run python here" should match the fix, not the post-mortem.
 * The falsifier rides along so a retrieved lesson arrives with the thing that would
 * disprove it, same contract as the injected view.
 */
function docOf(l: Lesson): string {
  return [
    `${l.action}`,
    `Applies when: ${l.trigger.type === "tool" ? `using ${l.trigger.match}` : l.trigger.match}${l.trigger.when ? ` (${l.trigger.when})` : ""}.`,
    `Why: ${l.statement}`,
    `Stale if: ${l.falsifier}`,
    `[${l.kind}/${l.domain}, tier ${l.tier ?? 1}, seen in ${l.sessions.length} session(s)]`,
  ].join("\n");
}

const pathOf = (l: Lesson) => `lessons/${l.scope === "personal" ? "personal" : "professional"}/${l.id}.md`;

async function main() {
  getDb();
  const lessons = currentLessons().filter(l => ALL || l.status === "active");
  console.log(`embedding ${lessons.length} lesson(s)${ALL ? " (including proposed)" : " (active only)"}`);
  if (!lessons.length) { console.log("  nothing to embed."); return; }

  // Retire vector rows for lessons that are no longer active, so a retracted lesson
  // stops being retrievable the moment it is retired rather than lingering until a
  // full reindex.
  const want = new Set(lessons.map(pathOf));
  const stale = allFiles().filter(f => f.replace(/\\/g, "/").startsWith("lessons/") && !want.has(f.replace(/\\/g, "/")));
  if (DRY) {
    console.log(`  --dry: would write ${want.size}, remove ${stale.length} stale`);
    return;
  }
  for (const f of stale) deleteFile(f);

  const { FlagEmbedding, EmbeddingModel } = await import("fastembed");
  const model = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15, cacheDir: embedCacheDir() });
  const docs = lessons.map(docOf);
  const vecs: number[][] = [];
  for await (const batch of model.embed(docs)) for (const v of batch) vecs.push(Array.from(v as ArrayLike<number>));

  let inserted = 0, kept = 0;
  for (let i = 0; i < lessons.length; i++) {
    const l = lessons[i]!, text = docs[i]!;
    const r = upsertFile(pathOf(l), sha256(text), [{ text, hash: sha256(text), chunkIndex: 0, vector: vecs[i] }]);
    inserted += r.inserted; kept += r.kept;
  }
  const byScope: Record<string, number> = {};
  for (const l of lessons) byScope[l.scope] = (byScope[l.scope] || 0) + 1;
  console.log(`  inserted ${inserted}, unchanged ${kept}, removed ${stale.length} stale`);
  console.log(`  by scope: ${JSON.stringify(byScope)} (ceiling enforced at the store, per path)`);
  console.log(`  trigger index: ${writeTriggerIndex()}`);
}
main();
