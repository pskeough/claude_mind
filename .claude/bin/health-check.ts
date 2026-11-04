/** Portable-fork health check: does a shipped clone actually work, and does it stay
 *  out of the host vault's data? Run from the portable root. */
import * as fs from "fs";
import * as path from "path";

let fails = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "OK  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};

async function main() {
  const cfg = await import("./config");
  const vr = cfg.vaultRoot();

  console.log("== isolation: this vault resolves to ITSELF ==");
  // Asserted against the directory this file actually lives in, NOT a hardcoded folder
  // name. The old check required the path to end in "ClaudeMindPortable", which is the
  // development folder's name and nobody else's: it failed on the first real deployment
  // it met, where the vault is called Kath_Claude_Mind. A check that only passes on the
  // developer's machine tests the developer's machine.
  const selfVault = path.resolve(__dirname, "..", "..");
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  check("vaultRoot is the install this file lives in", norm(vr) === norm(selfVault), `${vr}\n         expected ${selfVault}`);
  check("memDir is local", cfg.memDir().startsWith(vr), cfg.memDir());
  check("dbPath is local", cfg.dbPath().startsWith(vr));
  // The real hazard: a global capture-config pointing at someone ELSE's vault silently
  // makes this install read and write another brain's memory.
  check("memDir is under this vault, not another install", norm(cfg.memDir()).startsWith(norm(selfVault)), cfg.memDir());

  console.log("\n== new config knobs present ==");
  for (const k of ["llmConcurrency", "enablePpr", "pprAlpha", "pprBeta", "pprMaxFiles", "pprMaxTerms", "pprMaxCandidates", "pprGraphBoost",
                   "methodInjectMaxTokens", "methodInjectMax"])
    check(k, typeof (cfg as any)[k] === "function");
  // A ceiling that is not a ceiling would let the tier-2 injection grow without bound on
  // a vault whose ledger fills up. Cheap to assert, and the whole point of the knob.
  check("method injection is actually bounded", cfg.methodInjectMaxTokens() > 0 && cfg.methodInjectMax() > 0,
    `${cfg.methodInjectMax()} items / ${cfg.methodInjectMaxTokens()} tokens`);

  console.log("\n== modules import cleanly ==");
  const mods = ["llm-pool", "lessons", "graph-ppr", "lesson-mine-behavioral", "lesson-mine-episodes",
                "lesson-mine-preferences", "lesson-synthesize", "lesson-embed", "learn-coverage", "phase0-recurrence",
                "capabilities", "task-types", "learn-utility", "learn-audit", "learn-trigger-eval", "build-ledger"];
  for (const m of mods) {
    try { await import(`./${m}`); check(m, true); }
    catch (e: any) { check(m, false, e.message.slice(0, 80)); }
  }

  console.log("\n== integration files carry this session's work ==");
  const has = (f: string, needle: string) => {
    try { return fs.readFileSync(path.join(vr, ".claude/bin", f), "utf8").includes(needle); } catch { return false; }
  };
  check("daemon has the PPR channel", has("lkhs-daemon.ts", "pprCandidates"));
  check("daemon has the connector route", has("lkhs-daemon.ts", "connectorGate"));
  check("daemon has the embed memo", has("lkhs-daemon.ts", "EMB_CACHE"));
  check("graph-build writes ppr-index", has("graph-build.ts", "writePprIndex"));
  check("graph-build records node files", has("graph-build.ts", "nodeFiles"));
  check("graph-build ingests facts", has("graph-build.ts", "ingestFacts"));
  check("mcp has connect tool", has("lkhs-mcp.ts", '"connect"'));
  check("mcp has neighborhood tool", has("lkhs-mcp.ts", '"neighborhood"'));
  check("store has filesKnn", has("store.ts", "export function filesKnn"));
  check("store has the lesson layer", has("store.ts", 'f.startsWith("lessons/")'));
  // 2026-08-05 backport. Each of these is a behaviour the fork would silently lack if a
  // hand-copy missed a file, which is exactly how it drifted 15 files behind last time.
  check("triggers are provenance-ranked", has("lessons.ts", "tokenSource"));
  check("triggers gate on failure lift", has("lessons.ts", "MIN_LIFT"));
  check("dedupe merges instead of retiring", has("lessons.ts", "export function mergeLesson"));
  check("budget buckets on taskType", has("lessons.ts", "taskType || l.domain"));
  check("lessons carry a signature SET", has("lessons.ts", "sigs?: string[]"));
  check("method injection is token-budgeted", has("lkhs-daemon.ts", "methodInjectMaxTokens"));
  check("capability gate rejects a testless capability", has("capabilities.ts", "input.test.trim().length < 4"));
  check("capability verification reads an exit code", has("capabilities.ts", "r.status === 0"));
  check("prospective triggers are token-subset", has("prospective.ts", "entityMatches"));
  check("pretool hook logs its fires", (() => {
    try { return fs.readFileSync(path.join(vr, ".claude/hooks/lkhs-pretool-lesson.mjs"), "utf8").includes("lesson-fires.jsonl"); }
    catch { return false; }
  })());

  console.log("\n== cross-platform: this fork installs on macOS and Linux too ==");
  // A .ps1 hook is not merely awkward off Windows, it silently never fires — and the
  // failure is invisible, because a hook that does not run looks exactly like a hook with
  // nothing to say. The dev vault is Windows-only and can use PowerShell; every hook that
  // ships HERE must be node.
  const hookFiles = fs.readdirSync(path.join(vr, ".claude/hooks"));
  const ps1 = hookFiles.filter(f => f.endsWith(".ps1"));
  check("no PowerShell hooks shipped", ps1.length === 0, ps1.join(", "));
  check("all hooks are .mjs", hookFiles.every(f => f.endsWith(".mjs")), hookFiles.join(", "));
  // The lesson trigger is the primary delivery path for tier-1 lessons. It was present on
  // disk but absent from the installer's registration list, so it had never fired in this
  // fork on any platform.
  const inst = fs.readFileSync(path.join(vr, "scripts/install-global-hooks.mjs"), "utf8");
  check("pretool hook is REGISTERED by the installer", inst.includes("lkhs-pretool-lesson.mjs") && inst.includes("PreToolUse"));
  for (const s of ["setup.ps1", "setup.bat", "setup.sh", "scripts/install-jobs.mjs"])
    check(`${s} present`, fs.existsSync(path.join(vr, s)));
  check("finalize-setup has a --dry preview", fs.readFileSync(path.join(vr, "scripts/finalize-setup.mjs"), "utf8").includes("DRY RUN"));
  // The fork ships to strangers; a leftover name or gendered pronoun in the runbook is the
  // one defect a new user notices immediately.
  // A clone URL naming the repo owner is legitimate and expected, so strip URLs before
  // scanning. Everything else — a leftover first name, a gendered pronoun from when this
  // was written for one specific person — is what a new user notices immediately.
  const docs = ["SETUP.md", "README.md", "QUICKSTART.md", "CLAUDE.md"]
    .filter(f => fs.existsSync(path.join(vr, f)))
    .filter(f => /\b(her|she|Patrick|pskeough)\b/
      .test(fs.readFileSync(path.join(vr, f), "utf8").replace(/https?:\/\/\S+/g, "")));
  check("no personal or gendered references in the shipped docs", docs.length === 0, docs.join(", "));
  check("CLAUDE.md gates on an unconfigured vault",
    fs.readFileSync(path.join(vr, "CLAUDE.md"), "utf8").includes("core_profile.json` exists"));

  console.log("\n== ships machinery, not observations ==");
  const gi = fs.readFileSync(path.join(vr, ".gitignore"), "utf8");
  for (const g of ["lessons.jsonl", "episodes.jsonl", "PLAYBOOK.md", "ppr-index.json"])
    check(`${g} gitignored`, gi.includes(g));
  const binFiles = fs.readdirSync(path.join(vr, ".claude/bin")).filter(f => f.startsWith("lesson") || f === "llm-pool.ts" || f === "graph-ppr.ts");
  const named = binFiles.filter(f => /\bPatrick\b/.test(fs.readFileSync(path.join(vr, ".claude/bin", f), "utf8")));
  check("no personal name in shipped learning files", named.length === 0, named.join(","));
  check("no host lesson data present", !fs.existsSync(path.join(vr, ".claude/memory/lessons.jsonl")));

  console.log("\n== npm scripts ==");
  const pkg = JSON.parse(fs.readFileSync(path.join(vr, "package.json"), "utf8"));
  for (const k of ["learn", "learn:mine", "learn:prefs", "learn:episodes", "learn:synth", "learn:embed", "learn:coverage", "ppr", "llm:cache"])
    check(`npm run ${k}`, !!pkg.scripts[k]);

  console.log(`\n${fails === 0 ? "PORTABLE: ALL CHECKS PASSED" : `PORTABLE: ${fails} CHECK(S) FAILED`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
