/**
 * persona-apply-repairs.ts — extract clean corrected doc bodies from the
 * verify-repair workflow result and write them to persona/. Handles the agents'
 * inconsistent output: preamble before frontmatter, ```markdown fences, and
 * trailing commentary. Docs whose body carries no frontmatter (agent wrote the
 * file in place and returned only a description) are left untouched on disk.
 *
 * Usage: tsx persona-apply-repairs.ts <task-output.json>
 */
import * as fs from "fs";
import * as path from "path";

const VAULT = path.join(__dirname, "..", "..");
const out = process.argv[2];
const data = JSON.parse(fs.readFileSync(out, "utf8"));
const repaired: Array<{ doc: string; body: string }> = (data.result || data).repaired || [];

for (const r of repaired) {
  const start = r.body.indexOf("---\ntitle:");
  if (start < 0) { console.log(`KEEP-ON-DISK ${r.doc} (body had no frontmatter; agent wrote in place)`); continue; }
  let s = r.body.slice(start);
  const closeFence = s.indexOf("\n```");        // strip closing code fence + any trailing commentary
  if (closeFence >= 0) s = s.slice(0, closeFence);
  s = s.replace(/```$/g, "").trim() + "\n";
  if (/—/.test(s)) { console.log(`WARN ${r.doc}: contains em-dash after extraction`); }
  fs.writeFileSync(path.join(VAULT, "persona", r.doc), s);
  console.log(`WROTE ${r.doc} (${s.length}b)`);
}
