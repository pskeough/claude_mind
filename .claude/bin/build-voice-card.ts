/**
 * build-voice-card.ts - generate the compact "how to talk to the user" card that the
 * SessionStart hook injects.
 *
 * Why a generated card rather than prose in the hook: `persona/voice-style.md` is the
 * good, detailed document, but nothing was reading it. Sessions only ever saw whatever
 * was hardcoded in the hook, so the persona layer could improve for a year without
 * changing a single reply. This turns the persona layer into the source and the
 * injected card into a derived artifact.
 *
 * Two sources, ranked, not blended:
 *
 *   1. `persona/voice-rules-curated.md` is primary. Each rule there is hand-checked
 *      against a dated primary source and carries a scope marker, so a rule about his
 *      own prose cannot be read as a rule about Claude's replies. Curated rules always
 *      render, in file order.
 *   2. Mined `voice` facts from persona_facts.jsonl fill whatever slots are left. They
 *      come from one bulk extraction over a corpus weighted toward 2023-2024 coursework
 *      and have never been graded, so they supplement the curated set rather than
 *      competing with it.
 *
 * There is no confidence-times-decay ranking any more. Confidence in this ledger takes
 * two values assigned by extraction shape rather than by evidence, and 23 of 24
 * candidate facts share a single creation date, so both terms were constant across the
 * pool and the sort was arbitrary. Mined facts now sort by whether they carry a real
 * observation date, then by length.
 *
 *   npx tsx .claude/bin/build-voice-card.ts          # write the card
 *   npx tsx .claude/bin/build-voice-card.ts --print   # stdout only, no write
 */
import * as fs from "fs";
import * as path from "path";
import { memDir, vaultRoot } from "./config";

const PRINT_ONLY = process.argv.includes("--print");
const OUT = path.join(memDir(), "voice-card.md");
const CURATED = path.join(vaultRoot(), "persona", "voice-rules-curated.md");
const MAX_LINES = 14;

interface Fact {
  id?: string; statement: string; confidence?: number; t_event?: string; valid_at?: string;
  created?: string; invalid_at?: string; facet?: string; scope?: string; sensitivity?: string;
}

interface Rule {
  group: string; scope: string; text: string;
  contradicts?: RegExp; covers?: RegExp;
}

/** Facts that constrain what Claude produces, as opposed to describing how the user
 *  writes. Keyed on the verbs the persona miner actually uses for preferences. */
const DIRECTIVE_RX = /\b(requests?|prefers?|dislikes?|resists?|asked claude|wants?|expects?|rejects?|catches when|instructs?|configured?|behavioral preference)\b/i;

/** Explicitly about the user's own prose or reading habits, not about Claude's output.
 *  Checked second so a fact that is both (e.g. "prefers X in his own prose") is dropped. */
const DESCRIPTIVE_RX = /(^writes\b|\b(he writes|writes conversationally|writes with|his (own )?(prose|writing|voice|corpus)|consumes books|critical reader|speech-to-text|his conversational voice|acknowledges his own)\b)/i;

/** The card is injected into every session on this machine, so it holds only material
 *  that is safe in front of anyone who ends up looking at a transcript. Two independent
 *  guards, because either one alone is a single token away from a leak.
 *
 *  Structural: honour the fact's own declared scope and sensitivity. A fact marked
 *  private stays off the card whatever it says.
 *
 *  Topical: subject matter that is private regardless of how a fact was scoped. Applied
 *  to the statement only, which is the sole field the card renders; a fact whose quoted
 *  source touches a clinical topic is still fine to summarise. */
const PUBLIC_SCOPES = new Set(["personal", "professional", "public", ""]);
const SENSITIVE_RX = /\b(drugs?|polydrug|substances?|stimulants?|amphetamines?|adderall|modafinil|ketamine|lsd|psilocybin|mdma|cannabis|weed|gabapentin\w*|nicotine|alcohol|drunk|opioids?|fentanyl|overdose|bupropion|wellbutrin|pramipexole|medicat\w*|prescri\w*|dosage|diagnos\w*|psychiatr\w*|therapist|symptoms?|anhedonia|depress\w*|suicid\w*|self.harm|trauma|abuse|assault|sexual|sex|intoxicat\w*|sober|withdrawal|relapse|visa|deportation)\b/i;

function isPublic(f: Fact): boolean {
  const scope = (f.scope || "").toLowerCase();
  if (!PUBLIC_SCOPES.has(scope)) return false;
  const sens = (f.sensitivity || "normal").toLowerCase();
  if (sens !== "normal" && sens !== "low") return false;
  return !SENSITIVE_RX.test(f.statement || "");
}

function loadFacts(file: string): Fact[] {
  try {
    return fs.readFileSync(path.join(memDir(), file), "utf-8")
      .trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

function safeRx(src: string): RegExp | undefined {
  try { return new RegExp(src, "i"); } catch { return undefined; }
}

/** Parse the `## Rules` section of the curated file. `### ` headings become card
 *  groups, `- (scope) text` lines become rules, and an indented `contradicts:` or
 *  `covers:` line attaches a pattern to the rule above it. Everything outside that
 *  section is prose for a human and is ignored. */
function loadCuratedRules(): Rule[] {
  let raw: string;
  try { raw = fs.readFileSync(CURATED, "utf-8"); } catch { return []; }
  const rules: Rule[] = [];
  let inRules = false;
  let group = "";
  for (const line of raw.split(/\r?\n/)) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) { inRules = /^rules$/i.test(h2[1]); continue; }
    if (!inRules) continue;
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) { group = h3[1]; continue; }
    const bullet = /^-\s+\((reply|voiced|both)\)\s+(.+?)\s*$/.exec(line);
    if (bullet) { rules.push({ group, scope: bullet[1], text: bullet[2] }); continue; }
    const ann = /^\s+(contradicts|covers):\s*(.+?)\s*$/.exec(line);
    if (ann && rules.length) {
      const rx = safeRx(ann[2]);
      if (rx) rules[rules.length - 1][ann[1] as "contradicts" | "covers"] = rx;
    }
  }
  return rules;
}

function ms(d?: string): number {
  if (!d) return NaN;
  const t = Date.parse(d.length === 4 ? `${d}-06-30` : d);
  return isNaN(t) ? NaN : t;
}

function main() {
  const now = Date.now();
  const rules = loadCuratedRules();

  const candidates = loadFacts("persona_facts.jsonl")
    .filter(f => f.facet === "voice")
    .filter(f => isNaN(ms(f.invalid_at)) || ms(f.invalid_at) > now)
    .filter(f => isPublic(f))
    .filter(f => DIRECTIVE_RX.test(f.statement) && !DESCRIPTIVE_RX.test(f.statement));

  // A mined fact that opposes a curated rule is dropped rather than ranked below it,
  // because both would otherwise ship on the same card and cancel each other. The
  // opposition patterns live beside the rule that justifies them in the curated file.
  const dropped: string[] = [];
  const supplement = candidates.filter(f => {
    const against = rules.find(r => r.contradicts && r.contradicts.test(f.statement));
    if (against) { dropped.push(`contradicts [${against.scope}] ${f.id}: ${f.statement.slice(0, 90)}`); return false; }
    const restates = rules.find(r => r.covers && r.covers.test(f.statement));
    if (restates) { dropped.push(`covered [${restates.scope}] ${f.id}: ${f.statement.slice(0, 90)}`); return false; }
    return true;
  });

  // Dated observations outrank the undated bulk import. After that the tiebreak is
  // length, because a card that runs long stops being read, and then whether the
  // statement quotes a specimen rather than paraphrasing one.
  const rankOf = (f: Fact) => {
    const seen = ms(f.t_event);
    return {
      dated: isNaN(seen) ? 0 : 1,
      seen: isNaN(seen) ? 0 : seen,
      quoted: /['"]/.test(f.statement) ? 1 : 0,
      len: f.statement.length,
    };
  };
  supplement.sort((a, b) => {
    const x = rankOf(a), y = rankOf(b);
    return (y.dated - x.dated) || (y.seen - x.seen) || (x.len - y.len) || (y.quoted - x.quoted);
  });

  const slots = Math.max(0, MAX_LINES - rules.length);
  const seen = new Set<string>();
  const picked: Fact[] = [];
  for (const f of supplement) {
    if (picked.length >= slots) break;
    // Near-duplicate guard: the miner emits the same preference from several sessions.
    const key = f.statement.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).slice(0, 6).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(f);
  }

  const blocks: string[] = [];
  let group = "";
  for (const r of rules) {
    if (r.group !== group) { group = r.group; blocks.push(`\n${group}`); }
    blocks.push(`- ${r.text}`);
  }
  if (picked.length) {
    blocks.push("\nMined, ungraded");
    for (const f of picked) {
      // Only a real observation date is shown. valid_at on these facts is the date the
      // extraction ran, and printing it as if it were an observation is what made the
      // whole pool look freshly confirmed.
      blocks.push(`- ${f.statement.replace(/\s+/g, " ").trim()}${f.t_event ? ` [${f.t_event}]` : ""}`);
    }
  }

  const card = `<!-- generated by build-voice-card.ts on ${new Date().toISOString().slice(0, 10)}; do not hand-edit -->
How to talk to the user. The headings are scopes; voiced rules do not govern replies.
${blocks.join("\n")}

Sources and detail: ${CURATED}
`;

  if (PRINT_ONLY) { process.stdout.write(card); return; }
  fs.writeFileSync(OUT, card, "utf-8");
  console.log(`voice-card: ${rules.length} curated + ${picked.length} of ${supplement.length} mined -> ${OUT}`);
  for (const d of dropped) console.log(`  dropped ${d}`);
}

main();
