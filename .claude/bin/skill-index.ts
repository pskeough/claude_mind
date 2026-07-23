/**
 * Skill indexer for the LKHS semantic skill router.
 *
 * Scans SKILL.md files in two scopes:
 *   - project: <vault>/.claude/skills/<name>/SKILL.md
 *   - user:    ~/.claude/skills/<name>/SKILL.md
 * parses the YAML frontmatter `name` + `description`, and upserts ONE chunk per
 * skill into the shared SQLite+sqlite-vec store under a synthetic path namespace
 * `skills/<scope>/<name>`. store.ts's layerOf() maps that namespace to the `skill`
 * layer, which the daemon scores separately (and every memory pool excludes), so a
 * skill entry can never displace a memory hit.
 *
 * The embedded/matched text is `name. description`: the description is what routing
 * matches on, the name anchors it. Whole-file hash-skip means re-running is cheap;
 * skills that no longer exist on disk are pruned from the store.
 *
 *   npx tsx .claude/bin/skill-index.ts [--force]
 *   npm run skills:index
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { vaultRoot } from "./config";
import { sha256, storedFileHash, upsertFile, deleteFile, allFiles } from "./store";
import { embedPassages } from "./vector-engine";

export interface SkillEntry {
  scope: "project" | "user";
  name: string;
  description: string;
  storePath: string; // synthetic key: skills/<scope>/<name>
  absPath: string;   // real SKILL.md path on disk
  mtimeMs: number;
}

/** The two scopes scanned, in priority order (project first). */
function skillDirs(): Array<{ scope: "project" | "user"; dir: string }> {
  return [
    { scope: "project", dir: path.join(vaultRoot(), ".claude", "skills") },
    { scope: "user", dir: path.join(os.homedir(), ".claude", "skills") },
  ];
}

/** Parse the leading `--- ... ---` YAML block into single-line scalar key/values.
 *  Only name + description are needed and both are single-line scalars in practice;
 *  multi-line/list values (e.g. allowed-tools) are ignored. */
function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (mm && mm[2] !== undefined) out[mm[1]!.toLowerCase()] = mm[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** All skills present on disk (frontmatter with both name and description). */
export function scanSkills(): SkillEntry[] {
  const entries: SkillEntry[] = [];
  for (const { scope, dir } of skillDirs()) {
    if (!fs.existsSync(dir)) continue;
    let subs: fs.Dirent[];
    try { subs = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const sub of subs) {
      if (!sub.isDirectory()) continue;
      const abs = path.join(dir, sub.name, "SKILL.md");
      let raw: string, mtimeMs: number;
      try { raw = fs.readFileSync(abs, "utf-8"); mtimeMs = fs.statSync(abs).mtimeMs; } catch { continue; }
      const fm = parseFrontmatter(raw);
      const name = (fm.name || sub.name).trim();
      const description = (fm.description || "").trim();
      if (!name || !description) continue;
      entries.push({ scope, name, description, storePath: `skills/${scope}/${name}`, absPath: abs, mtimeMs });
    }
  }
  return entries;
}

/** Newest SKILL.md mtime across both scopes (0 if none). Cheap freshness probe for
 *  the daemon's lazy re-index. */
export function latestSkillMtime(): number {
  let max = 0;
  for (const { dir } of skillDirs()) {
    if (!fs.existsSync(dir)) continue;
    let subs: fs.Dirent[];
    try { subs = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const sub of subs) {
      if (!sub.isDirectory()) continue;
      try { const m = fs.statSync(path.join(dir, sub.name, "SKILL.md")).mtimeMs; if (m > max) max = m; } catch { /* */ }
    }
  }
  return max;
}

export interface SkillIndexResult { indexed: number; skipped: number; removed: number; total: number; names: string[] }

/** Upsert one chunk per on-disk skill; hash-skip unchanged; prune store entries for
 *  skills that no longer exist. Usable both as a CLI and in-process (daemon). */
export async function indexSkills(opts: { force?: boolean } = {}): Promise<SkillIndexResult> {
  const entries = scanSkills();
  const seen = new Set<string>();
  let indexed = 0, skipped = 0;

  for (const e of entries) {
    seen.add(e.storePath);
    const text = `${e.name}. ${e.description}`;
    const fileHash = sha256(text);
    if (!opts.force && storedFileHash(e.storePath) === fileHash) { skipped++; continue; }
    const [vec] = await embedPassages([text]);
    upsertFile(e.storePath, fileHash, [{ text, hash: fileHash, chunkIndex: 0, vector: vec }]);
    indexed++;
  }

  // Prune: any stored skill/* file whose skill is gone from disk.
  const stale = allFiles().filter(f => f.replace(/\\/g, "/").startsWith("skills/") && !seen.has(f));
  for (const f of stale) deleteFile(f);

  return { indexed, skipped, removed: stale.length, total: entries.length, names: entries.map(e => e.name) };
}

if (require.main === module) {
  indexSkills({ force: process.argv.includes("--force") })
    .then(r => {
      console.log(`skills: indexed=${r.indexed} skipped=${r.skipped} removed=${r.removed} (on disk: ${r.total})`);
      if (r.names.length) console.log("on disk:", r.names.join(", "));
    })
    .catch(e => { console.error(e); process.exit(1); });
}
