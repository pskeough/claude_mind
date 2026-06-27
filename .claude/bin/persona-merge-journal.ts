/**
 * persona-merge-journal.ts — reconstruct the merged facet object from a completed
 * persona-synthesis workflow journal. The workflow computes `merged` internally but
 * returns only docs+counts; every extractor's structured result is persisted in the
 * run journal, so we rebuild `merged` from there (no re-run, no extra tokens).
 *
 * Usage: tsx persona-merge-journal.ts <path-to/journal.jsonl> [out.json]
 */
import * as fs from "fs";

const jp = process.argv[2];
const out = process.argv[3] || ".claude/memory/persona_raw/merged.json";
if (!jp) { console.error("usage: tsx persona-merge-journal.ts <journal.jsonl> [out.json]"); process.exit(1); }

const BUCKETS = ["biography", "psychology_cognition", "values_worldview", "decision_patterns", "relationships", "health_wellbeing", "intellectual_themes", "research_identity", "voice_style", "notable_quotes"];
const merged: Record<string, any[]> = {};
for (const b of BUCKETS) merged[b] = [];

let extractors = 0;
for (const line of fs.readFileSync(jp, "utf8").trim().split(/\r?\n/)) {
  let o: any; try { o = JSON.parse(line); } catch { continue; }
  if (o.type !== "result") continue;
  const r = o.result;
  if (!r || typeof r !== "object" || !("biography" in r)) continue; // skip synthesis (string) results
  extractors++;
  for (const b of BUCKETS) if (Array.isArray(r[b])) merged[b].push(...r[b]);
}

fs.writeFileSync(out, JSON.stringify(merged, null, 0));
console.log("merged from", extractors, "extractors ->", out);
console.log(BUCKETS.map(b => `${b}=${merged[b].length}`).join("  "));
