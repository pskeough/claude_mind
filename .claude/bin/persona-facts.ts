/**
 * persona-facts.ts — turn merged persona facets (from the synthesis workflow) into
 * the structured layer that sits UNDER the prose docs:
 *
 *   .claude/memory/persona_facts.jsonl   atomic, provenance-tagged, temporal facts
 *   .claude/memory/persona_clinical.jsonl quarantined health facts (separate file)
 *   persona/entities.json                 people/orgs/places for graph-build ingestPersona()
 *
 * A fact is the queryable unit: one statement, when it held, how confident, where it
 * came from. This is the temporal-knowledge-graph spine; the markdown docs are the
 * human/LLM-readable rendering of the same truth.
 *
 * Bi-temporal layer: every fact carries a stable `key` (sha1 of facet + normalized
 * statement — survives the id churn of a rebuild), `valid_at` (when it became true),
 * `invalid_at` (when it stopped being true; null = still valid) and `supersedes`
 * (keys this fact invalidates). The writer is MERGE-PRESERVING: temporal state
 * stamped on the existing jsonl (e.g. by persona-supersede.ts) is carried forward
 * across rebuilds by key. Facts written before this layer existed load cleanly:
 * a missing key is computed on read; missing invalid_at means "valid".
 *
 * Usage: tsx persona-facts.ts <merged-facets.json>
 *        tsx persona-facts.ts --selftest    (merge-preservation round-trip check)
 *   merged-facets.json = { biography:[...], psychology_cognition:[...], ... } as
 *   returned by the persona-synthesis workflow (merged across all batches).
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { personaHub, clinicalLexicon, today as buildDate } from "./config";

const MEM = path.join(__dirname, "..", "memory");
const VAULT = path.join(__dirname, "..", "..");

// facet bucket -> { facet label, sensitivity, render(item) -> {statement, t_event, sources, entities} }
const norm = (s: string) => (s || "").replace(/\s*—\s*/g, " - ").replace(/\s+/g, " ").trim(); // em-dashes never allowed in this vault
// Plausible-life range so stray tokens ("Cyberpunk 2077") don't become dates.
const dateOf = (s?: string) => { const m = norm(s).match(/\b(19|20)\d{2}(-\d{2}(-\d{2})?)?\b/); if (!m) return ""; const y = +m[0].slice(0, 4); return (y >= 1990 && y <= 2026) ? m[0] : ""; };
// Scrub PII (phone numbers, emails) from any stored statement/evidence.
const scrub = (s: string) => norm(s)
  .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]")
  .replace(/(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]");
// Content-based clinical classifier (data-driven via config.clinicalLexicon; defaults
// reproduce the original behavior). Catches clinical-PERSONAL material that landed in
// non-health buckets (biography/psychology). Cognitive identity (aphantasia, SDAM,
// ADHD, anhedonia) is NOT clinical-quarantined; academic topics are guarded out.
// Crisis is judged on the STATEMENT only (evidence mentioning "research"/"study" must
// not rescue a clinically-loaded statement); advocacy/academic guards exclude
// drug-policy work and coursework from being quarantined.
const CLIN = clinicalLexicon();
const isClinical = (statement: string, evidence: string) =>
  CLIN.med.test(statement) || CLIN.coping.test(statement) ||
  (CLIN.crisis.test(statement) && !CLIN.advocacyGuard.test(statement) && !CLIN.academicGuard.test(statement));

export interface Fact {
  id: string; facet: string; statement: string; t_event: string; confidence: number;
  sensitivity: "normal" | "clinical"; sources: string[]; created: string;
  // bi-temporal layer (all optional on disk for backward compat; defaulted on read)
  key: string;              // sha1(facet + "|" + normalizeStatement(statement)).slice(0,16) — rebuild-stable
  valid_at: string;         // ISO date the fact became true; default t_event || created
  invalid_at: string | null; // ISO date it stopped being true; null = open/valid
  supersedes: string[];     // keys this fact invalidates
  scope: string | null;     // audience scope (config.SCOPE_ORDER); null = personal (fail-closed default)
}

// ---- facet scope floors (synthesis P1; shared by persona-scope.ts + facts-embed.ts)
// Fail-closed defaults per facet for facts that carry no judged scope yet — so a
// fact added by a rebuild/reconcile between scope passes still lands at its
// facet's floor (a new relationship fact must never default to `personal`).
// The judge pass may only TIGHTEN from here, never widen.
export const FACET_SCOPE: Record<string, string> = {
  relationship: "private",
  psychology: "private",
  biography: "personal",
  values: "personal",
  decision: "personal",
  quote: "personal",
  intellectual: "professional",
  research: "professional",
  voice: "professional",
};
export const facetDefaultScope = (facet: string): string => FACET_SCOPE[facet] || "personal";

// ---- stable key (EXACT formula shared with eval-memory.ts) --------------------
export function normalizeStatement(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");
}
export function factKey(facet: string, statement: string): string {
  return crypto.createHash("sha1").update(facet + "|" + normalizeStatement(statement)).digest("hex").slice(0, 16);
}

/** Default the bi-temporal fields on a fact that may predate them. Non-destructive. */
export function withTemporalDefaults(f: any): Fact {
  return {
    ...f,
    key: f.key || factKey(f.facet, f.statement),
    valid_at: f.valid_at || f.t_event || f.created || "",
    invalid_at: f.invalid_at ?? null,
    supersedes: Array.isArray(f.supersedes) ? f.supersedes : [],
    scope: f.scope ?? null,
  };
}

/** Temporal-aware dedup: same key merges — keep the highest confidence, preserve
 *  temporal state (earliest valid_at, any non-null invalid_at, union of supersedes). */
export function dedupTemporal(arr: Fact[]): Fact[] {
  const seen = new Map<string, Fact>();
  for (const raw of arr) {
    const f = withTemporalDefaults(raw);
    const prev = seen.get(f.key);
    if (!prev) { seen.set(f.key, f); continue; }
    const winner = f.confidence > prev.confidence ? { ...f } : { ...prev };
    // preserve temporal fields across the merge regardless of which copy wins
    winner.valid_at = [prev.valid_at, f.valid_at].filter(Boolean).sort()[0] || winner.valid_at;
    winner.invalid_at = prev.invalid_at ?? f.invalid_at ?? null;
    winner.supersedes = [...new Set([...prev.supersedes, ...f.supersedes])];
    seen.set(f.key, winner);
  }
  return [...seen.values()];
}

/** Load a facts jsonl (tolerates missing file and temporal-field-free lines). */
export function loadFactsFile(file: string): Fact[] {
  try {
    return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean)
      .map(l => withTemporalDefaults(JSON.parse(l)));
  } catch { return []; }
}

/** MERGE-PRESERVING writer: before overwriting, read the existing jsonl into a map
 *  by key; for each new fact with a matching key, carry forward the prior
 *  valid_at/invalid_at/supersedes so temporal state (stamped by the supersession
 *  pass) survives the id-churning whole-file rebuild. New facts keep defaults. */
export function writeFactsFile(file: string, facts: Fact[]): Fact[] {
  const prior = new Map(loadFactsFile(file).map(f => [f.key, f]));
  const merged = facts.map(raw => {
    const f = withTemporalDefaults(raw);
    const old = prior.get(f.key);
    if (!old) return f;
    return { ...f, valid_at: old.valid_at || f.valid_at, invalid_at: old.invalid_at ?? f.invalid_at, supersedes: old.supersedes.length ? old.supersedes : f.supersedes, scope: old.scope ?? f.scope };
  });
  fs.writeFileSync(file, merged.map(f => JSON.stringify(f)).join("\n") + "\n");
  return merged;
}

// ---- build pipeline (merged-facets.json -> jsonl stores) -----------------------
function build(src: string) {
  const merged = JSON.parse(fs.readFileSync(src, "utf8"));
  const facts: Fact[] = [];
  const clinical: Fact[] = [];
  const people = new Map<string, { name: string; role: string; notes: string[] }>();
  let n = 0;
  const today = buildDate();

  function push(facet: string, statement: string, evidence: string, sensitivity: "normal" | "clinical" = "normal") {
    statement = scrub(statement); if (!statement) return;
    const ev = scrub(evidence);
    const t_event = dateOf(ev) || dateOf(statement);
    const confidence = ev ? (t_event ? 0.85 : 0.7) : 0.5;
    // Route by content, not just bucket: clinical-personal material is quarantined wherever it appears.
    if (sensitivity !== "clinical" && isClinical(statement, ev)) sensitivity = "clinical";
    const f: Fact = withTemporalDefaults({ id: `pf-${String(++n).padStart(4, "0")}`, facet, statement, t_event, confidence, sensitivity, sources: ev ? [ev] : [], created: today });
    (sensitivity === "clinical" ? clinical : facts).push(f);
  }

  for (const it of merged.biography || []) push("biography", it.event, it.evidence || it.date || "");
  for (const it of merged.psychology_cognition || []) push("psychology", it.observation, it.evidence || "");
  for (const it of merged.values_worldview || []) push("values", it.value, it.evidence || "");
  for (const it of merged.decision_patterns || []) push("decision", it.pattern, it.evidence || "");
  for (const it of merged.intellectual_themes || []) push("intellectual", `${norm(it.theme)}${it.period ? ` (${norm(it.period)})` : ""}${it.note ? `: ${norm(it.note)}` : ""}`, it.period || "");
  for (const it of merged.research_identity || []) push("research", it.item, it.evidence || "");
  for (const it of merged.voice_style || []) push("voice", it.observation, it.example || "");
  for (const it of merged.notable_quotes || []) push("quote", it.text, it.date || "");
  for (const it of merged.health_wellbeing || []) push("health", it.note, it.date || "", "clinical");
  for (const it of merged.relationships || []) {
    const name = norm(it.person); if (!name) continue;
    const key = name.toLowerCase();
    const p = people.get(key) || { name, role: norm(it.role), notes: [] };
    if (it.role && !p.role) p.role = norm(it.role);
    if (it.notes) p.notes.push(norm(it.notes));
    people.set(key, p);
    push("relationship", `${name}${it.role ? ` — ${norm(it.role)}` : ""}${it.notes ? `: ${norm(it.notes)}` : ""}`, it.notes || "");
  }

  const factsD = dedupTemporal(facts), clinicalD = dedupTemporal(clinical);

  writeFactsFile(path.join(MEM, "persona_facts.jsonl"), factsD);
  writeFactsFile(path.join(MEM, "persona_clinical.jsonl"), clinicalD);

  // entities for graph-build ingestPersona(): people are first-class; the user is the hub.
  const entities = {
    generated: today,
    hub: personaHub(),
    people: [...people.values()].map(p => ({
      id: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      label: p.name, type: "person", role: p.role, notes: [...new Set(p.notes)].slice(0, 5),
    })),
  };
  fs.writeFileSync(path.join(VAULT, "persona", "entities.json"), JSON.stringify(entities, null, 2));

  const byFacet: Record<string, number> = {};
  for (const f of [...factsD, ...clinicalD]) byFacet[f.facet] = (byFacet[f.facet] || 0) + 1;
  console.log("persona_facts.jsonl:", factsD.length, "| persona_clinical.jsonl:", clinicalD.length, "| people:", entities.people.length);
  console.log("by facet:", JSON.stringify(byFacet));
}

// ---- selftest: merge-preservation round-trip -----------------------------------
// Simulates a rebuild: write facts -> stamp temporal state (as persona-supersede
// does) -> re-run the writer with the SAME logical input (fresh ids, no temporal
// state) -> assert keys stable and temporal fields carried forward.
function selftest(): boolean {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "lkhs-facts-selftest-"));
  const file = path.join(dir, "facts.jsonl");
  const mk = (id: string, facet: string, statement: string, t_event = ""): Fact =>
    withTemporalDefaults({ id, facet, statement, t_event, confidence: 0.7, sensitivity: "normal", sources: [], created: "2026-06-09" });

  let pass = true;
  const check = (name: string, ok: boolean) => { console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}`); if (!ok) pass = false; };

  // 1) initial write
  const gen1 = [
    mk("pf-0001", "biography", "Enrolled at University of Washington, BA Psychology", "2024"),
    mk("pf-0002", "biography", "Lives in Springfield, studying at State University", "2026"),
    mk("pf-0003", "research", "Runs LLM evaluation studies across 40,000+ responses."),
  ];
  const w1 = writeFactsFile(file, gen1);
  check("initial write assigns keys + defaults", w1.every(f => f.key.length === 16 && f.invalid_at === null && Array.isArray(f.supersedes)) && w1[0]!.valid_at === "2024");

  // 2) stamp temporal state (what persona-supersede --apply does)
  const stamped = loadFactsFile(file);
  const uw = stamped.find(f => f.statement.startsWith("Enrolled"))!;
  const syd = stamped.find(f => f.statement.startsWith("Lives in Sydney"))!;
  uw.invalid_at = "2026-01-01";
  syd.supersedes = [uw.key];
  fs.writeFileSync(file, stamped.map(f => JSON.stringify(f)).join("\n") + "\n");

  // 3) simulated rebuild: SAME logical input, churned ids, temporal-field-free facts
  const gen2 = [
    mk("pf-0007", "biography", "Enrolled at University of Washington,  BA Psychology", "2024"), // extra whitespace: key must normalize
    mk("pf-0009", "biography", "Lives in Springfield, studying at State University", "2026"),
    mk("pf-0004", "research", "Runs LLM evaluation studies across 40,000+ responses"), // trailing period stripped by normalize
  ];
  const w2 = writeFactsFile(file, gen2);
  const uw2 = w2.find(f => f.statement.startsWith("Enrolled"))!;
  const syd2 = w2.find(f => f.statement.startsWith("Lives in Sydney"))!;
  const res2 = w2.find(f => f.facet === "research")!;
  check("keys stable across reword-free rebuild", uw2.key === uw.key && syd2.key === syd.key);
  check("normalizeStatement collapses whitespace/punctuation into same key", res2.key === gen1[2]!.key);
  check("invalid_at carried forward through rebuild", uw2.invalid_at === "2026-01-01");
  check("supersedes carried forward through rebuild", syd2.supersedes.length === 1 && syd2.supersedes[0] === uw.key);
  check("untouched fact keeps open validity", res2.invalid_at === null);

  // 4) backward compat: temporal-field-free line loads with clean defaults
  fs.writeFileSync(file, JSON.stringify({ id: "pf-0001", facet: "values", statement: "Prefers prose over bullets", t_event: "", confidence: 0.7, sensitivity: "normal", sources: [], created: "2026-06-09" }) + "\n");
  const legacy = loadFactsFile(file)[0]!;
  check("legacy fact defaults: key computed, valid_at=created, invalid_at=null", legacy.key === factKey("values", "Prefers prose over bullets") && legacy.valid_at === "2026-06-09" && legacy.invalid_at === null && legacy.supersedes.length === 0);

  // 5) temporal-aware dedup merges same-key duplicates and preserves temporal state
  const d = dedupTemporal([
    { ...mk("pf-0001", "biography", "Same statement"), confidence: 0.5, invalid_at: "2025-01-01" } as Fact,
    { ...mk("pf-0002", "biography", "Same statement"), confidence: 0.85 } as Fact,
  ]);
  check("dedup keeps highest confidence, preserves invalid_at", d.length === 1 && d[0]!.confidence === 0.85 && d[0]!.invalid_at === "2025-01-01");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(pass ? "SELFTEST PASS" : "SELFTEST FAIL");
  return pass;
}

// ---- cli -----------------------------------------------------------------------
if (require.main === module) {
  const src = process.argv[2];
  if (src === "--selftest") { process.exit(selftest() ? 0 : 1); }
  if (!src) { console.error("usage: tsx persona-facts.ts <merged-facets.json> | --selftest"); process.exit(1); }
  build(src);
}
