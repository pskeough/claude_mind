/**
 * persona-supersede.ts — explicit, reviewable supersession pass over the persona
 * fact layer (the Graphiti-style auto-invalidation, kept as a discrete step).
 *
 *   npm run persona:supersede               dry-run: print the proposed diff, write nothing
 *   npm run persona:supersede -- --apply    stamp supersedes + invalid_at into the jsonl
 *   flags: --facet <name>   restrict to one facet
 *          --max-group N    judge-chunk size (default 80)
 *
 * Groups facts by facet (relationship facts additionally by the linked person —
 * facts carry no separate entity field; the person is the statement prefix), sends
 * each group to a `claude -p` judge that identifies superseded pairs (same subject,
 * later state), then:
 *   newer.supersedes += older.key
 *   older.invalid_at  = newer.valid_at
 * Idempotent: pairs already stamped are skipped; already-invalid facts are never
 * re-invalidated. Only persona_facts.jsonl is judged — the clinical tier stays
 * quarantined (never sent to a model); its temporal fields are stamped manually or
 * by the same writer if ever needed.
 */
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { vaultRoot, memDir, summaryModel } from "./config";
import { loadFactsFile, Fact } from "./persona-facts";

const VAULT = vaultRoot();
const FACTS_FILE = path.join(memDir(), "persona_facts.jsonl");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const argOf = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY_FACET = argOf("--facet");
const MAX_GROUP = Number(argOf("--max-group") || 80);

interface Proposal { current: string; superseded: string; reason: string; facet: string }

// ---- grouping -------------------------------------------------------------------
// relationship statements are "<Name> — <role>: <notes>"; group them per person so
// the judge compares states of the SAME linked entity.
const relEntity = (s: string) => (s.split(/\s+[—-]\s+|:\s/)[0] || s).trim().toLowerCase();

function groups(facts: Fact[]): Array<{ label: string; facts: Fact[] }> {
  const g = new Map<string, Fact[]>();
  for (const f of facts) {
    if (ONLY_FACET && f.facet !== ONLY_FACET) continue;
    const label = f.facet === "relationship" ? `relationship/${relEntity(f.statement)}` : f.facet;
    if (!g.has(label)) g.set(label, []);
    g.get(label)!.push(f);
  }
  const out: Array<{ label: string; facts: Fact[] }> = [];
  for (const [label, arr] of g) {
    if (arr.length < 2) continue; // nothing to supersede within a singleton
    // sort by normalized statement so same-subject facts sit adjacent within chunks
    arr.sort((a, b) => a.statement.toLowerCase().localeCompare(b.statement.toLowerCase()));
    for (let i = 0; i < arr.length; i += MAX_GROUP) out.push({ label: arr.length > MAX_GROUP ? `${label}#${1 + i / MAX_GROUP}` : label, facts: arr.slice(i, i + MAX_GROUP) });
  }
  return out;
}

// ---- judge (claude -p; argv instruction + stdin content, per capture-session.ts) --
function judge(label: string, facts: Fact[]): Proposal[] {
  const lines = facts.map(f => `${f.key} | ${f.valid_at || "undated"}${f.invalid_at ? " [already-superseded]" : ""} | ${f.statement}`).join("\n");
  const instruction = "Read the fact list and instructions in the input and output ONLY the requested JSON array. No prose, no code fences.";
  const stdinContent = [
    `BEGIN_FACTS (facet group: ${label}; each line: key | valid-from-date | statement)`,
    lines,
    "END_FACTS",
    "",
    "These are facts about one person, from a personal memory system. Identify SUPERSEDED PAIRS:",
    "two facts describing the SAME subject (same job, same residence, same enrollment, same project status, same tool/preference) where one clearly describes a LATER state that replaces the earlier one.",
    "Rules:",
    "- Only pair facts about the same specific subject. Different subjects are never supersessions.",
    "- The 'current' fact must plausibly be the later state (use dates when present; otherwise semantic cues like 'now', 'currently', past tense vs present).",
    "- Complementary or additive facts (two things both still true) are NOT supersessions. When in doubt, do NOT pair.",
    "- Skip facts marked [already-superseded] as the superseded side.",
    "Output a JSON array (possibly empty): [{\"current\": \"<key of newer fact>\", \"superseded\": \"<key of older fact>\", \"reason\": \"<short>\"}] and nothing else.",
  ].join("\n");

  const res = spawnSync("claude", ["-p", instruction, "--model", summaryModel(), "--output-format", "text"], {
    cwd: VAULT, input: stdinContent, shell: true,
    env: { ...process.env, LKHS_CAPTURE: "1" }, maxBuffer: 10 * 1024 * 1024, timeout: 300_000,
  });
  const raw = (res.stdout ? Buffer.from(res.stdout).toString("utf8") : "").trim();
  if (res.status !== 0 || !raw) { console.error(`  judge failed for ${label} (status ${res.status}): ${(res.stderr || "").toString().slice(0, 200)}`); return []; }
  const start = raw.indexOf("["), end = raw.lastIndexOf("]");
  if (start < 0 || end < start) { console.error(`  no JSON array from judge for ${label}`); return []; }
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    return (Array.isArray(arr) ? arr : []).filter((p: any) => p && p.current && p.superseded)
      .map((p: any) => ({ current: String(p.current), superseded: String(p.superseded), reason: String(p.reason || ""), facet: label }));
  } catch (e: any) { console.error(`  judge JSON parse failed for ${label}: ${e.message}`); return []; }
}

// ---- main -------------------------------------------------------------------------
function main() {
  const facts = loadFactsFile(FACTS_FILE);
  if (facts.length === 0) { console.error(`no facts at ${FACTS_FILE}`); process.exit(1); }
  const byKey = new Map(facts.map(f => [f.key, f]));
  const gs = groups(facts);
  console.error(`${facts.length} facts -> ${gs.length} judge group(s) (model ${summaryModel()}, ${APPLY ? "APPLY" : "DRY-RUN"})`);

  const accepted: Proposal[] = [];
  let rejected = 0;
  for (const g of gs) {
    console.error(`judging ${g.label} (${g.facts.length} facts)...`);
    for (const p of judge(g.label, g.facts)) {
      const cur = byKey.get(p.current), old = byKey.get(p.superseded);
      if (!cur || !old || cur.key === old.key) { rejected++; continue; }          // unknown/self pair
      if (old.invalid_at) { rejected++; continue; }                                // already superseded (idempotent)
      if (cur.supersedes.includes(old.key)) { rejected++; continue; }              // already linked (idempotent)
      if (cur.invalid_at) { rejected++; continue; }                                // an invalid fact cannot be "current"
      accepted.push(p);
    }
  }

  if (accepted.length === 0) {
    console.log(`\nNo new supersessions found (${rejected} proposals rejected/already stamped). Nothing to write.`);
    return;
  }

  console.log(`\nPROPOSED SUPERSESSIONS (${accepted.length}; ${rejected} rejected):`);
  for (const p of accepted) {
    const cur = byKey.get(p.current)!, old = byKey.get(p.superseded)!;
    console.log(`\n[${p.facet}] ${p.reason}`);
    console.log(`  CURRENT    ${cur.key} (${cur.valid_at || "undated"}) ${cur.statement.slice(0, 140)}`);
    console.log(`  SUPERSEDED ${old.key} (${old.valid_at || "undated"}) ${old.statement.slice(0, 140)}`);
    console.log(`  -> ${old.key}.invalid_at = ${cur.valid_at || "(current has no valid_at; will use its created date)"}`);
  }

  if (!APPLY) { console.log(`\nDRY-RUN: nothing written. Re-run with --apply to stamp these into ${path.relative(VAULT, FACTS_FILE)}.`); return; }

  for (const p of accepted) {
    const cur = byKey.get(p.current)!, old = byKey.get(p.superseded)!;
    cur.supersedes = [...new Set([...cur.supersedes, old.key])];
    old.invalid_at = cur.valid_at || cur.created || new Date().toISOString().slice(0, 10);
  }
  // write back in original order, temporal fields (incl. backfilled keys) now on disk
  fs.writeFileSync(FACTS_FILE, facts.map(f => JSON.stringify(f)).join("\n") + "\n");
  console.log(`\nAPPLIED: ${accepted.length} supersession(s) written to ${path.relative(VAULT, FACTS_FILE)}.`);
}

if (require.main === module) main();
