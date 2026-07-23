/**
 * persona-write-docs.ts — place the synthesized persona docs from the workflow
 * result into the correct layer, stripping any agent preamble, and report stray
 * files the synthesis agents created elsewhere (e.g. wiki/) so they can be removed.
 *
 * Temporal propagation: docs are the EMBEDDED rendering of the fact layer, so a
 * doc must only carry currently-VALID facts. The synthesis agents write prose (not
 * facts), so validity is enforced two ways here:
 *   1. every written doc's frontmatter is stamped `as_of: <today>` (generated date);
 *   2. each doc body is cross-checked against facts whose invalid_at has passed —
 *      any doc still containing a superseded fact's wording is flagged loudly so
 *      the stale prose is fixed before the next embed.
 *
 * Usage: tsx persona-write-docs.ts <task-output.json>
 */
import * as fs from "fs";
import * as path from "path";
import { today } from "./config";
import { loadFactsFile, normalizeStatement } from "./persona-facts";

const VAULT = path.join(__dirname, "..", "..");
const out = process.argv[2];
if (!out) { console.error("usage: tsx persona-write-docs.ts <task-output.json>"); process.exit(1); }
const data = JSON.parse(fs.readFileSync(out, "utf8"));
const result = data.result || data;
const docs: Array<{ file: string; body: string; sensitive: boolean }> = result.docs || [];

fs.mkdirSync(path.join(VAULT, "persona"), { recursive: true });
fs.mkdirSync(path.join(VAULT, "persona_clinical"), { recursive: true });

const strays = new Set<string>();
const written: string[] = [];

for (const d of docs) {
  // capture any "Wrote `<path>`" the agent emitted (stray file it created)
  for (const m of d.body.matchAll(/Wrote\s+`([^`]+)`/g)) strays.add(m[1].replace(/\\/g, "/"));
  // clean body: take from the first frontmatter block onward; else from first heading
  let body = d.body;
  const fm = body.indexOf("---\ntitle:");
  if (fm >= 0) body = body.slice(fm);
  else { const h = body.indexOf("\n# "); if (h >= 0) body = body.slice(h + 1); }
  body = body.trim() + "\n";
  // stamp the generated/as_of date in the header (frontmatter when present)
  if (body.startsWith("---\n")) {
    body = /^as_of:/m.test(body)
      ? body.replace(/^as_of:.*$/m, `as_of: ${today()}`)
      : body.replace(/^---\n/, `---\nas_of: ${today()}\n`);
  } else {
    body = `---\nas_of: ${today()}\n---\n` + body;
  }
  const dir = d.sensitive ? "persona_clinical" : "persona";
  const dest = path.join(VAULT, dir, d.file);
  fs.writeFileSync(dest, body);
  written.push(`${dir}/${d.file} (${body.length}b)`);
}

// ---- validity cross-check: no written doc may still carry a superseded fact -----
const nowIso = today();
const invalid = [
  ...loadFactsFile(path.join(VAULT, ".claude", "memory", "persona_facts.jsonl")),
  ...loadFactsFile(path.join(VAULT, ".claude", "memory", "persona_clinical.jsonl")),
].filter(f => f.invalid_at && f.invalid_at <= nowIso);
const stale: string[] = [];
for (const d of docs) {
  const dest = path.join(VAULT, d.sensitive ? "persona_clinical" : "persona", d.file);
  let bodyNorm = ""; try { bodyNorm = normalizeStatement(fs.readFileSync(dest, "utf8")); } catch { continue; }
  for (const f of invalid) {
    // match on the fact's leading clause (statements are long; prose paraphrases)
    const probe = normalizeStatement(f.statement).slice(0, 80);
    if (probe.length >= 20 && bodyNorm.includes(probe)) stale.push(`${d.file}: contains SUPERSEDED fact ${f.key} (invalid since ${f.invalid_at}): ${f.statement.slice(0, 100)}`);
  }
}

console.log("WROTE:");
written.forEach(w => console.log("  " + w));
if (stale.length) {
  console.log("\nWARNING - docs still contain SUPERSEDED facts (fix before embedding):");
  stale.forEach(s => console.log("  " + s));
}
console.log("\nSTRAY FILES the synthesis agents created (review/remove):");
[...strays].forEach(s => console.log("  " + s));
fs.writeFileSync(path.join(VAULT, ".claude", "memory", "persona_raw", "_strays.json"), JSON.stringify([...strays], null, 2));
