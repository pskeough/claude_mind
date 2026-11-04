#!/usr/bin/env node
/**
 * backport.mjs — pull engine changes from the development vault into this fork.
 *
 *   node scripts/backport.mjs --from "<path to dev vault>" [--apply] [--only a.ts,b.ts]
 *
 * The portable fork is a DE-PERSONALIZED copy of the same engine. Every backport before
 * this one was done by hand, which is why 15 files were missing and 26 were stale by the
 * time anyone looked. The risk in automating it is the opposite failure: a blind copy
 * drags the development vault's owner, projects and paper names into a fork meant to ship
 * to someone else.
 *
 * So the copy runs through a scrub, and the scrub is CHECKED rather than trusted: after
 * writing, every touched file is re-scanned for the same markers and the run fails loudly
 * if any survive. A silent de-personalization miss is the one defect that would actually
 * embarrass this fork.
 *
 * What it never touches: .claude/memory (the fork's own data), core_profile.json,
 * lkhs.config.json, package.json. Engine code only.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(HERE, "..");
const arg = (f, d = null) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes("--apply");
const FROM = arg("--from");
const ONLY = (arg("--only") || "").split(",").map(s => s.trim()).filter(Boolean);

if (!FROM) { console.error("need --from <dev vault path>"); process.exit(2); }
/**
 * Directories to sync. HOOKS ARE INCLUDED DELIBERATELY: the first run of this script
 * covered only .claude/bin, and the fork's PreToolUse hook turned out to be two fixes
 * behind — it resolved its index from the active project rather than from its own
 * location (so a globally-registered hook found nothing in every project but one), and
 * it never logged its fires (so the whole utility signal was dead in the fork). Engine
 * code and the hooks that call it are one unit; syncing one without the other is how
 * the fork drifts while its health check still passes.
 */
const DIRS = [
  { sub: [".claude", "bin"], exts: /\.(ts|mjs)$/ },
  { sub: [".claude", "hooks"], exts: /\.(ps1|mjs)$/ },
];
const SRC = path.join(FROM, ".claude", "bin");
const DST = path.join(VAULT, ".claude", "bin");
if (!fs.existsSync(SRC)) { console.error(`no such source: ${SRC}`); process.exit(2); }

/**
 * Comment-level scrub. Ordered longest-first so "Patrick Keough" is consumed before
 * "Patrick", and specific project names before generic ones.
 */
// CASE-INSENSITIVE, every one of them. They were written case-sensitive and the
// verification regex was too, so both agreed that a file was clean while
// "psychbench abliterated" and "granularity gap" sat in lowercase comments and shipped
// to a second user's machine. A scrub and its own checker sharing a blind spot is the
// failure mode this design was supposed to prevent.
const SCRUB = [
  [/\bPatrick Keough\b/gi, "the vault owner"],
  [/\bPatrick's\b/gi, "the user's"],
  [/\bPatrick\b/gi, "the user"],
  [/\bpskeough\b/gi, "the-user"],
  [/\bPsychBench[ _]?Abli\w*\b/gi, "a second paper"],
  [/\bPsychBench v\d+\b/gi, "a paper draft"],
  [/\bPsychBench\b/gi, "a paper project"],
  [/\bthe Granularity Gap\b/gi, "a research paper"],
  [/\bGranularity Gap\b/gi, "a research paper"],
  [/\bSecond Tree\b/gi, "a book project"],
  [/\bSycophancy[_ ]?Abli\w*\b/gi, "a research repo"],
  [/\buts masters application\b/gi, "a deadline-bearing application"],
  [/\bUTS masters\b/gi, "a university programme"],
  [/\bKatharine McLennan\b/gi, "a third party"],
  [/\bKatharine\b/gi, "a third party"],
  [/\bRoss Dawson\b/gi, "a public figure"],
  [/\bthe Basilisk\b/gi, "a novel"],
  [/\bBasilisk\b/gi, "a novel"],
  [/\bAI_Book_Editor\b/g, "a book project repo"],
  [/\bEpithelium\b/g, "a corpus graph"],
  // Dev-machine paths in comments and usage examples, either slash direction.
  [/C:[\\/]AI Coding Projects[\\/]Online_AI[\\/]ClaudeMind/gi, "<vault>"],
  [/C:[\\/]AI Coding Projects[\\/]Online_AI/gi, "C:\\Projects"],
  [/C:[\\/]AI Coding Projects/gi, "C:\\Projects"],
  [/\bPsych_App's check-in log\b/gi, "a private tracker log"],
];

/** Markers that must not survive the scrub. Checked AFTER writing, not assumed. */
const FORBIDDEN = /\b(patrick|pskeough|psychbench|granularity gap|second tree|abliterated)\b/i;

/**
 * Files that must NEVER ship, however well scrubbed.
 *
 * eval-multihop.ts is a hand-authored probe set whose 12 questions are written against
 * the development vault's actual documents ("what should I read alongside <paper> before
 * I write the discussion section"). Scrubbing the names leaves a harness that asks a
 * second user's vault about papers it has never seen — a leak AND a broken eval. Some
 * things are not de-personalizable, only omittable.
 */
// The dev console's Home page and its daily check-in nudge read the developer's own
// tracker, feeds and deadlines; on any other machine they are dead paths.
const NEVER_SHIP = new Set(["eval-multihop.ts", "eval-probes.ts", "home-data.ts", "checkin.ts", "checkin-nudge.mjs"]);

/**
 * Files whose portable version is deliberately different and must NOT be overwritten.
 * config.ts carries the fork's own vault resolution and a de-personalized IDENTITY_RE;
 * health-check.ts asserts which install it is running in, and the dev vault's copy
 * asserts the OPPOSITE of what this fork needs.
 */
const NEVER_COPY = new Set([
  // Hand-authored probe questions written against the dev vault's own documents.
  // The fork keeps a generic placeholder set; copying the dev list across ships
  // one person's project names inside a harness that cannot answer them anyway.
  // Same reason: a hardcoded registry of the dev machine's folders is a leak,
  // and on any other machine it is a list of paths that do not exist. The fork's
  // copy derives the registry from its own ingestRoots.
  "env-scan.ts",
  "calibrate-rerank.ts",
  "config.ts",        // fork's own vault resolution + de-personalized IDENTITY_RE
  "health-check.ts",  // asserts WHICH install it runs in; the dev copy asserts the opposite
  "lkhs-web.ts",      // the dev console imports the personal Home page (NEVER_SHIP above)
  // The fork's session-start and capture hooks are .mjs rewrites of the dev vault's
  // PowerShell ones, so they are separate implementations rather than stale copies.
  "lkhs-session-start.ps1", "lkhs-capture.ps1", "lkhs-project-card.ps1", "lkhs-refresh.ps1",
  // The dev vault runs PowerShell hooks; this fork installs on macOS and Linux where
  // PowerShell does not exist, so every hook here is a .mjs port. Copying a .ps1 across
  // would install a hook that silently never fires on two of three target platforms.
  "lkhs-pretool-lesson.ps1",
]);

const scrub = (s) => SCRUB.reduce((acc, [rx, to]) => acc.replace(rx, to), s);

/**
 * Fork-only code changes, applied after the scrub on every sync. Each one names an
 * anchor that must exist; a missing anchor fails the run, because a patch that
 * silently stops applying is exactly how a Pro-plan install would lose its cap.
 *
 * The budget gate: every background `claude -p` goes through config.ts llmSpawnSync /
 * llmAllow, so a Pro-plan install cannot drain its plan overnight. Synchronous call
 * sites are rewritten mechanically; the three async ones get a guard at entry.
 */
const SYNC_CLAUDE = /\bspawnSync\((\s*(?:"claude"|claudeBin\(\)|`"\$\{claudeBin\(\)\}"`))/g;
const PATCHES = {
  "llm-pool.ts": [[
    "  const model = opts.model || summaryModel();\n  return new Promise(",
    "  const model = opts.model || summaryModel();\n  // Daily budget gate (config.ts llmBudget). Refused reads as a failed call: \"\".\n  if (!llmAllow(opts.label || \"pool\")) return Promise.resolve(\"\");\n  return new Promise(",
  ]],
  "ambient-watcher.ts": [[
    "  writeLog(`compile:start #${compileCount}",
    "  if (!llmAllow(\"compile\")) { writeLog(`compile:skipped ${files.length} file(s) (daily model-call budget reached)`); return; }\n  writeLog(`compile:start #${compileCount}",
  ]],
  "pipelines.ts": [[
    "  const child = spawn(\"claude\", [",
    "  if (!llmAllow(\"pipeline\")) {\n    await log(`pipeline:skipped ${pipeline} (daily model-call budget reached)`);\n    process.exit(0);\n  }\n  const child = spawn(\"claude\", [",
  ]],
  // Read the trigger index only from the vault this hook lives in. The dev copy falls
  // back to the active project's .claude/memory, which lets any opened repo inject
  // "lessons" into every tool call.
  "lkhs-pretool-lesson.mjs": [[
    "  if (!existsSync(index)) {\n    if (!process.env.CLAUDE_PROJECT_DIR) return;\n    index = join(process.env.CLAUDE_PROJECT_DIR, \".claude\", \"memory\", \"lesson-triggers.json\");\n    if (!existsSync(index)) return;\n  }",
    "  if (!existsSync(index)) return;",
  ]],
};
const GATED = new Set(["llm-pool.ts", "ambient-watcher.ts", "pipelines.ts"]);

function addConfigImport(src, name, f) {
  const rx = /import \{([^}]*)\} from "\.\/config";/;
  const m = src.match(rx);
  if (!m) throw new Error(`${f}: needs ${name} but has no ./config import to extend`);
  if (new RegExp(`\\b${name}\\b`).test(m[1])) return src;
  return src.replace(rx, `import {${m[1].replace(/\s*$/, "")}, ${name} } from "./config";`);
}

function forkPatch(f, s) {
  s = s.replace(/\r\n/g, "\n"); // some dev files are CRLF; anchors and .gitattributes are LF
  for (const [anchor, repl] of PATCHES[f] || []) {
    if (!s.includes(anchor)) throw new Error(`${f}: patch anchor not found, update PATCHES in backport.mjs:\n${anchor}`);
    s = s.replace(anchor, repl);
  }
  if (GATED.has(f)) s = addConfigImport(s, "llmAllow", f);
  // Weekly principle synthesis runs on the install's summary model, not a pinned Opus:
  // on a Pro plan one Opus batch can cost a day of the cap.
  if (f === "lesson-synthesize.ts") {
    const rx = /model: "(?:claude-opus-[\w-]+|opus)"/;
    if (!rx.test(s)) throw new Error(`${f}: synthesis model anchor not found, update forkPatch in backport.mjs`);
    s = addConfigImport(s.replace(rx, "model: summaryModel()"), "summaryModel", f);
  }
  if (f.endsWith(".ts") && f !== "config.ts" && SYNC_CLAUDE.test(s)) {
    const label = f === "capture-session.ts" ? "capture" : f.replace(/\.ts$/, "");
    s = s.replace(SYNC_CLAUDE, `llmSpawnSync("${label}", $1`);
    s = addConfigImport(s, "llmSpawnSync", f);
  }
  SYNC_CLAUDE.lastIndex = 0;
  return s;
}

let copied = 0, unchanged = 0;
const written = [];
for (const { sub, exts } of DIRS) {
  const src = path.join(FROM, ...sub), dst = path.join(VAULT, ...sub);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(dst, { recursive: true });
  const srcFiles = fs.readdirSync(src).filter(f => exts.test(f));
  const targets = (ONLY.length ? srcFiles.filter(f => ONLY.includes(f)) : srcFiles)
    .filter(f => !NEVER_COPY.has(f) && !NEVER_SHIP.has(f));
  for (const f of targets) {
    const raw = fs.readFileSync(path.join(src, f), "utf8");
    const out = forkPatch(f, scrub(raw));
    const dstFile = path.join(dst, f);
    const prev = fs.existsSync(dstFile) ? fs.readFileSync(dstFile, "utf8") : null;
    if (prev === out) { unchanged++; continue; }
    console.log(`  ${prev === null ? "NEW " : "UPD "} ${sub[1]}/${f}${raw !== out ? "  (scrubbed)" : ""}`);
    if (APPLY) { fs.writeFileSync(dstFile, out); written.push(dstFile); }
    copied++;
  }
}

console.log(`\n${copied} to copy, ${unchanged} already identical, ${NEVER_COPY.size} never-copy (${[...NEVER_COPY].join(", ")})`);
if (!APPLY) { console.log("DRY RUN — add --apply"); process.exit(0); }

// VERIFY the scrub rather than trusting it.
const leaked = [];
for (const f of written) {
  const s = fs.readFileSync(f, "utf8");
  const m = s.match(FORBIDDEN);
  if (m) leaked.push(`${path.basename(f)}: ${m[0]}`);
}
if (leaked.length) {
  console.error(`\nSCRUB FAILED — personal markers survived in ${leaked.length} file(s):`);
  leaked.forEach(l => console.error(`  ${l}`));
  console.error(`Add a rule to SCRUB and re-run. These files are written; fix before shipping.`);
  process.exit(1);
}
console.log(`scrub verified clean across ${written.length} file(s)`);
