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
 * Usage: tsx persona-facts.ts <merged-facets.json>
 *   merged-facets.json = { biography:[...], psychology_cognition:[...], ... } as
 *   returned by the persona-synthesis workflow (merged across all batches).
 */
import * as fs from "fs";
import * as path from "path";
import { personaHub, clinicalLexicon, today as buildDate } from "./config";

const MEM = path.join(__dirname, "..", "memory");
const VAULT = path.join(__dirname, "..", "..");
const src = process.argv[2];
if (!src) { console.error("usage: tsx persona-facts.ts <merged-facets.json>"); process.exit(1); }
const merged = JSON.parse(fs.readFileSync(src, "utf8"));

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

interface Fact { id: string; facet: string; statement: string; t_event: string; confidence: number; sensitivity: "normal" | "clinical"; sources: string[]; created: string; }

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
  const f: Fact = { id: `pf-${String(++n).padStart(4, "0")}`, facet, statement, t_event, confidence, sensitivity, sources: ev ? [ev] : [], created: today };
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

// exact-normalized dedup within each store, keep highest confidence
function dedup(arr: Fact[]): Fact[] {
  const seen = new Map<string, Fact>();
  for (const f of arr) {
    const k = f.facet + "|" + f.statement.toLowerCase().slice(0, 160);
    const prev = seen.get(k);
    if (!prev || f.confidence > prev.confidence) seen.set(k, f);
  }
  return [...seen.values()];
}
const factsD = dedup(facts), clinicalD = dedup(clinical);

fs.writeFileSync(path.join(MEM, "persona_facts.jsonl"), factsD.map(f => JSON.stringify(f)).join("\n") + "\n");
fs.writeFileSync(path.join(MEM, "persona_clinical.jsonl"), clinicalD.map(f => JSON.stringify(f)).join("\n") + "\n");

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
