#!/usr/bin/env node
/**
 * leak-scan.mjs — does this fork name anyone it should not?
 *
 *   node scripts/leak-scan.mjs
 *
 * backport.mjs verifies only the files IT touched on a given run. That is the wrong
 * scope for a shipping check: a file scrubbed badly six months ago stays wrong forever
 * because no later run ever rewrites it. This scans everything that ships, every time,
 * and it is what should gate a release.
 *
 * Found on its first run: lowercase "psychbench" and "granularity gap" in engine comments
 * that a case-sensitive scrub had walked straight past — in a fork already deployed to a
 * second person.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const VAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Names and projects belonging to the developer, not to whoever installs this.
const MARKERS = /\b(patrick|pskeough|psychbench|granularity gap|second tree|abliterated|abliberated|kath|katharine|basilisk|ross dawson|epithelium|ai_book_editor|ai coding projects|creative projects|localai)\b/gi;
// A clone URL legitimately names the repo owner; so does a package author field.
const ALLOW = [/https?:\/\/\S+/g, /github\.com\S*/g, /"author"\s*:\s*"[^"]*"/g];

// The scrub tooling and the health check must NAME the markers in order to look for
// them; excluding them is not a loophole, it is the difference between a rule and its
// enforcement. Everything else that ships is scanned.
const SELF = new Set(["scripts/backport.mjs", "scripts/leak-scan.mjs", ".claude/bin/health-check.ts"]
  .map(p => p.split("/").join(path.sep)));
const SKIP_DIRS = new Set(["node_modules", ".git", "local_cache", "logs", "memory", "backups", "persona", "journal", "cards", "themes", "library", "raw", "wiki"]);
const SCAN_EXT = /\.(ts|mjs|js|md|json|sh|ps1|bat|command)$/;

const hits = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!SCAN_EXT.test(e.name)) continue;
    let s;
    try { s = fs.readFileSync(p, "utf8"); } catch { continue; }
    const stripped = ALLOW.reduce((acc, rx) => acc.replace(rx, ""), s);
    const found = [...new Set((stripped.match(MARKERS) || []).map(m => m.toLowerCase()))];
    const rel = path.relative(VAULT, p);
    if (found.length && !SELF.has(rel)) hits.push({ file: rel, found });
  }
})(VAULT);

if (!hits.length) {
  console.log("leak scan: clean — nothing in this fork names the developer or their projects.");
  process.exit(0);
}
console.error(`leak scan: ${hits.length} file(s) still carry personal markers\n`);
for (const h of hits) console.error(`  ${h.file}\n      ${h.found.join(", ")}`);
console.error(`\nFix by adding a SCRUB rule in scripts/backport.mjs and re-running it, or by`);
console.error(`adding the file to NEVER_SHIP if it cannot be de-personalized at all.`);
process.exit(1);
