/**
 * voice-recalibrate.ts — synthesis P4: threshold-gated recalibration + the
 * learning-curve point. Fully automatic and safe to run any time: it no-ops
 * until a voice has accumulated >= N new preference events (accepted +
 * edit-pair records) since its last recalibration.
 *
 * Per eligible voice:
 *   1. `mimesis recalibrate <voice>` (venv CLI; recomputes fingerprint means +
 *      stds recency-weighted; auto-backs-up fingerprint.base.json — reversible).
 *   2. fingerprint-only eval (5 held-out real pieces) via the venv python.
 *   3. Append a curve point (cumulative events, self-baseline, held-out mean)
 *      to evals/voice-learning-curve/RESULTS.md.
 * Bookkeeping: .claude/memory/voice_recal_state.json records per-voice event
 * counts at the last recalibration; "new events" = current - recorded.
 *
 *   npx tsx .claude/bin/voice-recalibrate.ts [--min-events 5] [--voice slug] [--force]
 * Wired: Sunday slot in lkhs-refresh.ps1 (before the weekly report).
 */
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { memDir, mimesisProfilesRoot, vaultRoot } from "./config";

const argv = process.argv.slice(2);
const argOf = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const MIN_EVENTS = Number(argOf("--min-events") || 5);
const ONLY_VOICE = argOf("--voice");
const FORCE = argv.includes("--force");

const STATE = path.join(memDir(), "voice_recal_state.json");
const CURVE = path.join(vaultRoot(), "evals", "voice-learning-curve", "RESULTS.md");
// Real voices only: the synthetic example profile and eval variants are not curves.
const VOICES = ["creative", "personal", "research"];

function countLines(file: string): number {
  try { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length; } catch { return 0; }
}

function main() {
  const root = mimesisProfilesRoot();
  if (!root) { console.log("no mimesisProfilesRoot configured; nothing to do."); return; }
  const venv = path.join(path.dirname(root), ".venv", "Scripts");
  const mimesisExe = path.join(venv, "mimesis.exe");
  const pythonExe = path.join(venv, "python.exe");
  if (!fs.existsSync(mimesisExe)) { console.error(`mimesis CLI not found at ${mimesisExe}`); process.exit(1); }

  const state: Record<string, { accepted: number; pairs: number; last: string }> =
    fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};

  // --voice may name ANY existing profile (e.g. `example` for tests); the
  // default sweep covers the real voices only.
  for (const voice of ONLY_VOICE ? [ONLY_VOICE] : VOICES) {
    const profDir = path.join(root, voice);
    if (!fs.existsSync(path.join(profDir, "config.json"))) { console.log(`${voice}: no profile, skipped`); continue; }
    const accepted = countLines(path.join(profDir, "accepted", "accepted.jsonl"));
    const pairs = countLines(path.join(profDir, "accepted", "edit_pairs.jsonl"));
    const prev = state[voice] || { accepted: 0, pairs: 0, last: "never" };
    const fresh = (accepted - prev.accepted) + (pairs - prev.pairs);
    if (fresh < MIN_EVENTS && !FORCE) {
      console.log(`${voice}: ${fresh} new event(s) since ${prev.last} (< ${MIN_EVENTS}), no recalibration`);
      continue;
    }

    console.log(`${voice}: ${fresh} new event(s) -> recalibrating...`);
    const rec = spawnSync(mimesisExe, ["recalibrate", voice], { encoding: "utf8", timeout: 300_000 });
    if (rec.status !== 0) { console.error(`${voice}: recalibrate FAILED (${rec.status}): ${(rec.stderr || rec.stdout || "").slice(0, 300)}`); continue; }
    console.log((rec.stdout || "").trim().split("\n").slice(-2).join("\n"));

    // Curve point: fingerprint-only eval via the venv (same ruler as the baseline).
    const py = `
import sys, json; sys.path.insert(0, r"${path.join(path.dirname(root), "src").replace(/\\/g, "\\\\")}")
from mimesis_voice import config, evalcli
prof = config.resolve_named("${voice}")
res = evalcli.run_eval(prof, held_out=5, fingerprint_only=True)
sb = getattr(res, "self_baseline", None); rz = getattr(res, "real_rmsz", [])
print(json.dumps({"self_baseline": sb, "held_out_mean": (sum(rz)/len(rz)) if rz else None}))
`;
    const ev = spawnSync(pythonExe, ["-c", py], { encoding: "utf8", timeout: 300_000 });
    let point: any = null;
    try { point = JSON.parse((ev.stdout || "").trim().split("\n").pop() || "null"); } catch { /* */ }
    const today = new Date().toISOString().slice(0, 10);
    const row = `| ${today} | ${voice} | ${accepted + pairs} | ${point?.self_baseline?.toFixed(4) ?? "?"} | ${point?.held_out_mean?.toFixed(2) ?? "?"} |`;
    try {
      let md = fs.readFileSync(CURVE, "utf8");
      if (!md.includes("## Curve points")) md += "\n## Curve points\n\n| date | voice | cumulative events | self-baseline RMS-z | held-out mean |\n|---|---|---|---|---|\n";
      fs.writeFileSync(CURVE, md + row + "\n");
      console.log(`${voice}: curve point appended -> ${row}`);
    } catch (e: any) { console.error(`${voice}: curve append failed: ${e.message}`); }

    state[voice] = { accepted, pairs, last: new Date().toISOString() };
    fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  }
}

main();
