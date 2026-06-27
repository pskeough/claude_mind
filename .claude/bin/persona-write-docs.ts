/**
 * persona-write-docs.ts — place the synthesized persona docs from the workflow
 * result into the correct layer, stripping any agent preamble, and report stray
 * files the synthesis agents created elsewhere (e.g. wiki/) so they can be removed.
 *
 * Usage: tsx persona-write-docs.ts <task-output.json>
 */
import * as fs from "fs";
import * as path from "path";

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
  const dir = d.sensitive ? "persona_clinical" : "persona";
  const dest = path.join(VAULT, dir, d.file);
  fs.writeFileSync(dest, body);
  written.push(`${dir}/${d.file} (${body.length}b)`);
}

console.log("WROTE:");
written.forEach(w => console.log("  " + w));
console.log("\nSTRAY FILES the synthesis agents created (review/remove):");
[...strays].forEach(s => console.log("  " + s));
fs.writeFileSync(path.join(VAULT, ".claude", "memory", "persona_raw", "_strays.json"), JSON.stringify([...strays], null, 2));
