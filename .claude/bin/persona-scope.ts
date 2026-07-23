/**
 * persona-scope.ts — audience-scope tagging pass over the persona fact layer
 * (synthesis P1; clone of the persona-supersede.ts propose/vet/dry-run/apply play).
 *
 *   npx tsx .claude/bin/persona-scope.ts                 dry-run: show the facet-default assignment
 *   npx tsx .claude/bin/persona-scope.ts --apply         write facet-default scopes (only fills NULL scope)
 *   npx tsx .claude/bin/persona-scope.ts --judge         dry-run the tighten-only judge pass
 *   npx tsx .claude/bin/persona-scope.ts --judge --apply apply vetted judge tightenings
 *   flags: --facet <name>   restrict to one facet
 *          --max-group N    judge-chunk size (default 80)
 *
 * Two stages, both fail-closed:
 *   1. MECHANICAL facet defaults (deterministic, reviewable): relationship and
 *      psychology floor at `private`; biography/values/decision/quote are
 *      `personal`; intellectual/research/voice are `professional`. Only facts with
 *      no scope are filled — a hand-set or judge-set scope is never overwritten.
 *   2. JUDGE tighten-only pass: a `claude -p` judge may propose moving a fact to a
 *      STRICTLY MORE PRIVATE scope than it currently has (content overriding the
 *      facet default: a biography fact about a breakup, a research fact naming a
 *      private conflict). Vet rejects anything that is not strictly tighter, so
 *      the judge can never widen exposure. Clinical jsonl is never read or judged.
 *
 * After applying, run `npm run facts:embed` to propagate scopes into fact.scope
 * (scalar-only refresh; scope is not part of stmt_hash, so no re-embedding).
 */
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { vaultRoot, memDir, summaryModel, SCOPE_ORDER, scopeRank, claudeBin } from "./config";
import { loadFactsFile, facetDefaultScope, Fact } from "./persona-facts";

const VAULT = vaultRoot();
const FACTS_FILE = path.join(memDir(), "persona_facts.jsonl");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const JUDGE = argv.includes("--judge");
const argOf = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY_FACET = argOf("--facet");
const MAX_GROUP = Number(argOf("--max-group") || 80);

// Facet floors (stage 1) live in persona-facts.ts (FACET_SCOPE), shared with
// facts-embed.ts so unscoped facts land at the same floor everywhere.
const facetDefault = facetDefaultScope;

interface Proposal { key: string; scope: string; reason: string; group: string }

function groups(facts: Fact[]): Array<{ label: string; facts: Fact[] }> {
  const g = new Map<string, Fact[]>();
  for (const f of facts) {
    if (ONLY_FACET && f.facet !== ONLY_FACET) continue;
    if (!g.has(f.facet)) g.set(f.facet, []);
    g.get(f.facet)!.push(f);
  }
  const out: Array<{ label: string; facts: Fact[] }> = [];
  for (const [label, arr] of g)
    for (let i = 0; i < arr.length; i += MAX_GROUP)
      out.push({ label: arr.length > MAX_GROUP ? `${label}#${1 + i / MAX_GROUP}` : label, facts: arr.slice(i, i + MAX_GROUP) });
  return out;
}

function judge(label: string, facts: Fact[]): Proposal[] {
  const lines = facts.map(f => `${f.key} | ${f.scope} | ${f.statement}`).join("\n");
  const instruction = "Read the fact list and instructions in the input and output ONLY the requested JSON array. No prose, no code fences.";
  const stdinContent = [
    `BEGIN_FACTS (facet group: ${label}; each line: key | current-scope | statement)`,
    lines,
    "END_FACTS",
    "",
    "These are facts about one person from a personal memory system. Scopes form a privacy ladder,",
    "most private first: private < personal < professional < public.",
    "A profile with a 'professional' ceiling sees ONLY professional/public facts; 'private' facts are",
    "the most protected non-clinical tier.",
    "Propose ONLY facts whose content is MORE SENSITIVE than their current scope suggests and should be",
    "TIGHTENED (moved to a more private scope). Sensitive content includes: romantic/family relationships,",
    "breakups, named private individuals in personal contexts, finances and money specifics, visa/immigration",
    "specifics, health/substances/sleep/medication, sexuality, private conflicts or grievances, self-worth",
    "and emotional struggles, family history.",
    "Rules:",
    "- You may only move a fact to a MORE private scope (e.g. professional -> personal, personal -> private).",
    "- NEVER propose widening (a more public scope). Such proposals will be discarded.",
    "- Purely professional/intellectual content at 'professional' is fine: do not propose it.",
    "- When unsure whether content is sensitive, propose the tightening (fail closed).",
    "Output a JSON array (possibly empty): [{\"key\": \"<fact key>\", \"scope\": \"<tighter scope>\", \"reason\": \"<short>\"}] and nothing else.",
  ].join("\n");

  const res = spawnSync(claudeBin(), ["-p", instruction, "--model", summaryModel(), "--output-format", "text"], {
    cwd: VAULT, input: stdinContent, shell: true,
    env: { ...process.env, LKHS_CAPTURE: "1" }, maxBuffer: 10 * 1024 * 1024, timeout: 300_000,
  });
  const raw = (res.stdout ? Buffer.from(res.stdout).toString("utf8") : "").trim();
  if (res.status !== 0 || !raw) { console.error(`  judge failed for ${label} (status ${res.status}): ${(res.stderr || "").toString().slice(0, 200)}`); return []; }
  const start = raw.indexOf("["), end = raw.lastIndexOf("]");
  if (start < 0 || end < start) { console.error(`  no JSON array from judge for ${label}`); return []; }
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    return (Array.isArray(arr) ? arr : []).filter((p: any) => p && p.key && p.scope)
      .map((p: any) => ({ key: String(p.key), scope: String(p.scope).toLowerCase(), reason: String(p.reason || ""), group: label }));
  } catch (e: any) { console.error(`  judge JSON parse failed for ${label}: ${e.message}`); return []; }
}

function main() {
  const facts = loadFactsFile(FACTS_FILE);
  if (facts.length === 0) { console.error(`no facts at ${FACTS_FILE}`); process.exit(1); }
  const byKey = new Map(facts.map(f => [f.key, f]));

  if (!JUDGE) {
    // ---- stage 1: mechanical facet defaults --------------------------------
    const dist: Record<string, Record<string, number>> = {};
    let filled = 0, kept = 0;
    for (const f of facts) {
      if (ONLY_FACET && f.facet !== ONLY_FACET) continue;
      const target = f.scope ?? facetDefault(f.facet);
      if (f.scope == null) filled++; else kept++;
      dist[f.facet] = dist[f.facet] || {};
      dist[f.facet]![target] = (dist[f.facet]![target] || 0) + 1;
      if (APPLY && f.scope == null) f.scope = target;
    }
    console.log(`facet-default assignment (${APPLY ? "APPLY" : "DRY-RUN"}): ${filled} to fill, ${kept} already scoped (never overwritten)`);
    for (const [facet, scopes] of Object.entries(dist))
      console.log(`  ${facet.padEnd(14)} -> ${Object.entries(scopes).map(([s, n]) => `${s}:${n}`).join("  ")}`);
    if (!APPLY) { console.log(`\nDRY-RUN: nothing written. Re-run with --apply.`); return; }
    fs.writeFileSync(FACTS_FILE, facts.map(f => JSON.stringify(f)).join("\n") + "\n");
    console.log(`\nAPPLIED: scopes written to ${path.relative(VAULT, FACTS_FILE)}. Run \`npm run facts:embed\` to propagate.`);
    return;
  }

  // ---- stage 2: tighten-only judge pass ------------------------------------
  const scoped = facts.filter(f => f.scope != null);
  if (scoped.length === 0) { console.error("no scoped facts yet — run the facet-default stage (no --judge) first"); process.exit(1); }
  const gs = groups(scoped);
  console.error(`${scoped.length} scoped facts -> ${gs.length} judge group(s) (model ${summaryModel()}, ${APPLY ? "APPLY" : "DRY-RUN"})`);

  const accepted: Proposal[] = [];
  let rejected = 0;
  for (const g of gs) {
    console.error(`judging ${g.label} (${g.facts.length} facts)...`);
    for (const p of judge(g.label, g.facts)) {
      const f = byKey.get(p.key);
      if (!f || f.scope == null) { rejected++; continue; }                                  // unknown key / unscoped
      if (!(SCOPE_ORDER as readonly string[]).includes(p.scope) || p.scope === "clinical") { rejected++; continue; } // invalid target (clinical is routed by the lexicon, not the judge)
      if (scopeRank(p.scope) >= scopeRank(f.scope)) { rejected++; continue; }               // TIGHTEN-ONLY: must be strictly more private
      accepted.push(p);
    }
  }

  if (accepted.length === 0) { console.log(`\nNo tightenings proposed (${rejected} rejected). Nothing to write.`); return; }

  console.log(`\nPROPOSED TIGHTENINGS (${accepted.length}; ${rejected} rejected):`);
  for (const p of accepted) {
    const f = byKey.get(p.key)!;
    console.log(`  [${f.facet}] ${f.scope} -> ${p.scope}  ${p.key}  ${f.statement.slice(0, 110)}${p.reason ? `  (${p.reason})` : ""}`);
  }
  if (!APPLY) { console.log(`\nDRY-RUN: nothing written. Re-run with --judge --apply.`); return; }

  for (const p of accepted) byKey.get(p.key)!.scope = p.scope;
  fs.writeFileSync(FACTS_FILE, facts.map(f => JSON.stringify(f)).join("\n") + "\n");
  console.log(`\nAPPLIED: ${accepted.length} tightening(s) written to ${path.relative(VAULT, FACTS_FILE)}. Run \`npm run facts:embed\` to propagate.`);
}

if (require.main === module) main();
