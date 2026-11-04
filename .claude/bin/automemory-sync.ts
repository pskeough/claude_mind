/**
 * Auto-memory mirror: Claude Code's per-project memory folders into the vault.
 *
 * Claude Code keeps a small hand-written memory folder beside each project's
 * transcripts (~/.claude/projects/<slug>/memory/*.md). Those files are curated by
 * hand and are the authoritative version of the facts they carry, but the vault's
 * ingest paths all read the .jsonl transcripts and never the folder next to them,
 * so the curated file itself is invisible to retrieval. The conversation in which
 * a fact was written gets captured; the corrected, edited statement of that same
 * fact does not, and an older automatic capture keeps winning on recall.
 *
 * This mirrors every source file to automemory/<project-slug>/<name>.md, which the
 * existing vault-relative walker (vector-engine INDEX_DIRS) then indexes like any
 * other layer. Mirroring rather than reading in place keeps one rule for what is
 * indexable: it lives under the vault root.
 *
 * Copies only when the produced bytes differ, and removes mirrors whose source is
 * gone (dropping their store rows with them), so the nightly costs one directory
 * scan in the steady state.
 *
 *   npm run automem              # mirror, incremental
 *   npm run automem -- --dry     # report what would change, touch nothing
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { vaultRoot } from "./config";

const VAULT = vaultRoot();
const MIRROR_ROOT = path.join(VAULT, "automemory");
const MIRROR_DIR = "automemory";
const SOURCE_ROOT = process.env.LKHS_AUTOMEMORY_ROOT || path.join(os.homedir(), ".claude", "projects");

const DRY = process.argv.includes("--dry");

// Scratch output from one voice-generation batch: a file per truncated experiment,
// each recording that nothing was saved. It is machine residue rather than curated
// memory, and it is close to half the files in the one project it sits in.
const RESIDUE = /^_sandbox-/;

/** True when a MEMORY.md holds nothing but its one-line pointers. The pointers
 *  restate files that are mirrored on their own, at a fraction of their detail, so
 *  indexing the index would rank a summary line ahead of the fact it points at. */
function isPointerIndex(content: string): boolean {
  const body = content
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("#"));
  if (body.length === 0) return true;
  return body.every(l => /^[-*+]\s/.test(l));
}

/** Chunks carry their text and their vault-relative path, not their origin, so the
 *  absolute source path has to live inside the mirrored bytes to survive into a hit. */
function withProvenance(content: string, sourceAbs: string): string {
  const line = `source: ${sourceAbs.replace(/\\/g, "/")}`;
  const open = /^---\r?\n/.exec(content);
  if (open) return content.slice(0, open[0].length) + line + "\n" + content.slice(open[0].length);
  return `---\n${line}\n---\n\n${content}`;
}

function mdFiles(root: string, rel = "", acc: string[] = []): string[] {
  const abs = rel ? path.join(root, rel) : root;
  if (!fs.existsSync(abs)) return acc;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const next = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) mdFiles(root, next, acc);
    else if (entry.name.toLowerCase().endsWith(".md")) acc.push(next);
  }
  return acc;
}

const vaultKey = (...parts: string[]) => parts.flatMap(p => p.split(path.sep)).join("/");

/** Depth-first, so a directory emptied by its children is removed in the same pass. */
function pruneEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(dir, entry.name));
  }
  if (dir !== MIRROR_ROOT && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

export type AutoMemorySummary = {
  projects: Array<{ slug: string; files: number; written: number }>;
  mirrored: number;
  written: number;
  unchanged: number;
  removed: number;
  skippedResidue: number;
  skippedIndex: number;
};

export async function syncAutoMemory(dry = false): Promise<AutoMemorySummary> {
  if (!fs.existsSync(SOURCE_ROOT)) throw new Error(`no auto-memory root at ${SOURCE_ROOT}`);

  const want = new Map<string, { content: string; slug: string }>();
  const perProject = new Map<string, number>();
  let skippedResidue = 0, skippedIndex = 0;

  for (const entry of fs.readdirSync(SOURCE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const memDir = path.join(SOURCE_ROOT, entry.name, "memory");
    if (!fs.existsSync(memDir)) continue;

    for (const rel of mdFiles(memDir)) {
      const base = path.basename(rel);
      if (RESIDUE.test(base)) { skippedResidue++; continue; }
      const abs = path.join(memDir, rel);
      const raw = fs.readFileSync(abs, "utf-8");
      const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;   // a byte-order mark would hide the frontmatter fence
      if (base.toLowerCase() === "memory.md" && isPointerIndex(content)) { skippedIndex++; continue; }
      want.set(vaultKey(MIRROR_DIR, entry.name, rel), { content: withProvenance(content, abs), slug: entry.name });
      perProject.set(entry.name, (perProject.get(entry.name) || 0) + 1);
    }
  }

  // Byte-identical mirrors are left untouched: the vector engine skips on a whole-file
  // hash, and rewriting an unchanged file would still cost a re-read on every run.
  const writtenPerProject = new Map<string, number>();
  let written = 0, unchanged = 0;
  for (const [key, { content, slug }] of want) {
    const dest = path.join(VAULT, key.split("/").join(path.sep));
    const prev = fs.existsSync(dest) ? fs.readFileSync(dest, "utf-8") : null;
    if (prev === content) { unchanged++; continue; }
    written++;
    writtenPerProject.set(slug, (writtenPerProject.get(slug) || 0) + 1);
    if (!dry) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, "utf-8");
    }
  }

  // A deleted source has to take its chunks with it, or a fact the user retracted by
  // deleting the file stays retrievable. Reindex only visits files that exist, so the
  // rows are dropped here the way the other synced layers drop theirs.
  const stale = mdFiles(MIRROR_ROOT).map(rel => vaultKey(MIRROR_DIR, rel)).filter(key => !want.has(key));
  if (stale.length && !dry) {
    for (const key of stale) {
      try { fs.unlinkSync(path.join(VAULT, key.split("/").join(path.sep))); } catch { /* already gone */ }
    }
    pruneEmptyDirs(MIRROR_ROOT);
    const { deleteFile } = await import("./store");
    for (const key of stale) deleteFile(key);
  }

  const projects = [...perProject.entries()]
    .map(([slug, files]) => ({ slug, files, written: writtenPerProject.get(slug) || 0 }))
    .sort((a, b) => b.files - a.files || a.slug.localeCompare(b.slug));

  return { projects, mirrored: want.size, written, unchanged, removed: stale.length, skippedResidue, skippedIndex };
}

if (require.main === module) {
  (async () => {
    const s = await syncAutoMemory(DRY);
    for (const p of s.projects) {
      console.log(`${String(p.files).padStart(4)}  ${p.slug}${p.written ? `  (+${p.written} changed)` : ""}`);
    }
    console.log(`\n${DRY ? "--dry: would mirror" : "mirrored"} ${s.mirrored} file(s) from ${s.projects.length} project(s) into ${MIRROR_DIR}/`);
    console.log(`written=${s.written} unchanged=${s.unchanged} removed=${s.removed} skipped(residue)=${s.skippedResidue} skipped(index)=${s.skippedIndex}`);
  })().catch(err => { console.error(err); process.exit(1); });
}
