/**
 * persona-supersede.ts — explicit, reviewable supersession pass over the persona
 * fact layer (the Graphiti-style auto-invalidation, kept as a discrete step).
 *
 *   npm run persona:supersede               dry-run: print the proposed diff, write nothing
 *   npm run persona:supersede -- --apply    stamp supersedes + invalid_at into the jsonl
 *   flags: --facet <name>   restrict to one facet
 *          --max-group N    judge-chunk size (default 80)
 *          --no-subject     facet-only grouping (skips the cross-facet subject pass)
 *          --subject-days N only build subject groups whose newest fact is within N days (default 120)
 *          --subject-max N  cap the added cross-facet judge calls (default 40)
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
import { vaultRoot, memDir, summaryModel, headlessFlags, llmSpawnSync } from "./config";
import { loadFactsFile, Fact } from "./persona-facts";

const VAULT = vaultRoot();
const FACTS_FILE = path.join(memDir(), "persona_facts.jsonl");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const argOf = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY_FACET = argOf("--facet");
const MAX_GROUP = Number(argOf("--max-group") || 80);
const NO_SUBJECT = argv.includes("--no-subject");   // facet-only, the pre-2026-09-02 behaviour
const SUBJECT_DAYS = Number(argOf("--subject-days") || 120);  // a subject with no recent fact has not changed
const SUBJECT_MAX = Number(argOf("--subject-max") || 40);     // hard ceiling on added judge calls

interface Proposal { current: string; superseded: string; reason: string; facet: string }

// ---- grouping -------------------------------------------------------------------
// relationship statements are "<Name> — <role>: <notes>"; group them per person so
// the judge compares states of the SAME linked entity.
const relEntity = (s: string) => (s.split(/\s+[—-]\s+|:\s/)[0] || s).trim().toLowerCase();

/* Facet grouping has a blind spot that is not a tuning problem.
 *
 * A correction is routinely filed under a different facet from the claim it corrects,
 * because correcting is itself a decision or a research finding while the original was
 * a biography detail. The 462-visa pair is the worked example:
 *
 *   biography  2026-06-09  "on a working holiday visa valid for up to three years"
 *   decision   2026-08-20  "the 462 visa is a 12-month grant, not 3 years as
 *                           previously assumed"
 *
 * They never enter the same group, so the older claim was never invalidated and still
 * outranks its own correction in retrieval. That is the mechanism behind memory
 * returning the wrong vintage, and no amount of judge quality fixes it, because the
 * judge is never shown the pair.
 *
 * Subject grouping keys on DISTINCTIVE shared terms instead of facet. Rarity is what
 * makes a term a subject: "visa" and "462" name a topic, "research" and "academic"
 * are connective tissue that would group everything with everything. A deterministic
 * version of this that tried to pick the superseded fact itself was built and
 * discarded first, because term overlap identifies a shared SUBJECT and cannot tell a
 * contradicted claim from a merely related one. That judgment stays with the judge;
 * grouping only has to put the candidates in front of it.
 */
const SUBJ_STOP = new Set(("the and for with from that this his her its their the user claude session work research paper project data model file code time day week month year new use using used one two also more most first next last other same about into over under after before during since until per via").split(/\s+/));

function subjectTerms(s: string): string[] {
  return [...new Set((s.toLowerCase().match(/[a-z0-9][a-z0-9_.\-]{3,}/g) || []).filter(w => !SUBJ_STOP.has(w)))];
}

/* A fact that declares itself a correction is the strongest cheap prior available for
 * where a supersession is hiding, and it costs a regex rather than a model call.
 * Ranking on it matters more than it sounds: without it, the subject groups sort by
 * recency, almost every group ties at the same recent date, and the cap fills with
 * generic vocabulary ("system", "state", "task") while the visa pair sits outside it.
 * With it, 30 of 2,568 groups carry a correction and the visa pair ranks 16th. */
const CORRECTION_RE = new RegExp([
  "not\\s+\\w[\\w\\s-]{0,40}\\s+as\\s+(previously|originally|earlier)",
  "\\b(this|which)\\s+(corrects|supersedes|invalidates|replaces)\\b",
  "\\b(previously|originally|earlier)\\s+(assumed|believed|thought|recorded|stated|reported)",
  "\\bwas\\s+(wrong|incorrect|mistaken|inaccurate)\\b",
  "\\bturns\\s+out\\b.{0,60}\\b(not|instead|actually)\\b",
  "\\bno\\s+longer\\s+(true|accurate|the case|holds|waiting)\\b",
].join("|"), "i");

const factMs = (f: Fact): number => {
  const s = String(f.valid_at || f.t_event || f.created || "");
  if (!s) return 0;
  const d = Date.parse(s.length === 4 ? `${s}-01-01` : s);
  return isNaN(d) ? 0 : d;
};

function subjectGroups(facts: Fact[], nowMs: number): Array<{ label: string; facts: Fact[] }> {
  const byTerm = new Map<string, Fact[]>();
  for (const f of facts) for (const t of subjectTerms(f.statement)) {
    if (!byTerm.has(t)) byTerm.set(t, []);
    byTerm.get(t)!.push(f);
  }
  const total = facts.length;
  // 1% of the corpus, not 2%. At 2% the ceiling was 31 facts, which admits "system"
  // (29), "three" (27) and "state" (22) as if they were subjects; at 1% it is 15 and
  // they drop out while "visa" (7) survives. A subject names few facts by definition.
  const ceiling = Math.max(3, Math.floor(total * 0.01));
  const freshMs = nowMs - SUBJECT_DAYS * 86400000;
  const cand: Array<{ label: string; facts: Fact[]; newest: number; corr: number }> = [];
  const seen = new Set<string>();
  for (const [term, arr] of byTerm) {
    if (arr.length < 2 || arr.length > ceiling) continue;
    // Only worth a judge call if it actually crosses a facet boundary; same-facet
    // pairs are already covered by the pass above and would be paid for twice.
    if (new Set(arr.map(f => f.facet)).size < 2) continue;
    // Supersession is something a NEW fact does to an old one. A subject whose newest
    // fact is months old has not changed, and judging it again spends a model call to
    // re-derive an answer already recorded. Unbounded, this pass proposed 2,986 groups
    // over the live ledger, which is the whole corpus re-judged nightly.
    const newest = Math.max(...arr.map(factMs));
    if (newest < freshMs) continue;
    // One group per distinct fact SET, so near-synonym terms over the same facts
    // ("visa", "462", "subclass") cost one call rather than three.
    const sig = arr.map(f => f.key).sort().join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    const corr = arr.some(f => CORRECTION_RE.test(f.statement || "")) ? 1 : 0;
    cand.push({ label: `subject/${term}`, facts: arr.slice(0, MAX_GROUP), newest, corr });
  }
  // Correction-bearing groups first, then recency, so a hard cap spends the budget
  // where a supersession is most likely to actually be.
  cand.sort((a, b) => (b.corr - a.corr) || (b.newest - a.newest));
  if (cand.length > SUBJECT_MAX) {
    console.error(`subject pass: ${cand.length} candidate group(s), judging the ${SUBJECT_MAX} most recent (raise --subject-max to widen)`);
  }
  return cand.slice(0, SUBJECT_MAX).map(({ label, facts }) => ({ label, facts }));
}

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
  if (!ONLY_FACET && !NO_SUBJECT) out.push(...subjectGroups(facts, Date.now()));
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

  const res = llmSpawnSync("persona-supersede", "claude", ["-p", instruction, "--model", summaryModel(), "--output-format", "text", ...headlessFlags()], {
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
