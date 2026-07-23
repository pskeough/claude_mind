/**
 * eval-live-quality.ts — LIVE-GATE felt-quality eval for LKHS.
 *
 * Measures what the offline recall eval cannot: does the live /gate inject the
 * RIGHT AMOUNT at the RIGHT TIME in real sessions? Optimizes for precision and
 * restraint, not recall (eval-memory.ts is the recall regression guard).
 *
 *   npm run eval:quality              full run (deterministic metrics + claude -p judge)
 *   flags: --no-judge   skip the relevance judge (deterministic metrics only)
 *          --set <path> alternate prompt set (default .claude/memory/eval/live_quality.jsonl)
 *          --label <s>  tag the run file (e.g. "baseline", "tuned-itemfloor")
 *
 * Prompt set: live_quality.jsonl — real prompts labeled by expected behavior:
 *   SILENT     generic coding / world knowledge / tool ops -> inject NOTHING (restraint)
 *   IDENTITY   "who am I / my research" -> persona injection is correct
 *   WORK       "where did I leave off on X" -> project memory is correct
 *   AMBIGUOUS  topical-but-generic -> injection tolerable only if small and on-point
 *
 * Metrics:
 *   over-injection rate   fraction of SILENT prompts that injected (lower better)
 *   injection volume      median hits among injecting prompts (high = bloat)
 *   relevance precision   claude -p judge rates each injected item 0..3 for that
 *                         prompt; precision = items rated >=2 / items injected
 *   latency p50/p95       per-gate-call ms, median of 3 calls per prompt
 *
 * Output: per-category table + a diffable run file .claude/memory/eval/runs/quality-<iso>.json
 */
import * as fs from "fs";
import * as path from "path";
import { spawn, spawnSync } from "child_process";
import { vaultRoot, memDir, daemonPort, summaryModel } from "./config";

const VAULT = vaultRoot();
const EVAL_DIR = path.join(memDir(), "eval");
const RUNS_DIR = path.join(EVAL_DIR, "runs");
const PSET_DEFAULT = path.join(EVAL_DIR, "live_quality.jsonl");
const PORT = daemonPort();
const CATS = ["SILENT", "IDENTITY", "WORK", "AMBIGUOUS"] as const;

interface PromptItem { id: string; category: string; prompt: string }
interface GateHit { file: string; score: number; layer: string; text: string }
interface Result {
  id: string; category: string; prompt: string;
  inject: boolean; reason: string; topScore: number | null;
  hitCount: number; hits: GateHit[];
  latencyMs: number;                 // median of 3 calls
  judged?: Array<{ file: string; rating: number }>;
}

// ---- daemon (same pattern as eval-memory.ts) --------------------------------
async function health(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(4000) });
    return ((await r.json()) as any).ok === true;
  } catch { return false; }
}
async function ensureDaemon(): Promise<void> {
  if (await health()) return;
  console.error(`daemon not responding on :${PORT}; starting via npm run serve (detached)...`);
  const child = spawn("npm", ["run", "serve"], { cwd: VAULT, shell: true, detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (await health()) { console.error("daemon is up."); return; }
  }
  console.error(`FATAL: daemon did not come up on :${PORT} after 90s.`); process.exit(1);
}
async function gate(prompt: string): Promise<{ json: any; ms: number }> {
  const t0 = performance.now();
  const r = await fetch(`http://127.0.0.1:${PORT}/gate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }), signal: AbortSignal.timeout(60000),
  });
  const json = await r.json();
  return { json, ms: performance.now() - t0 };
}

// ---- stats helpers -----------------------------------------------------------
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pctile = (xs: number[], p: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

// ---- relevance judge (claude -p, one batched call) ----------------------------
// Rates every injected item 0=noise..3=on-point FOR ITS PROMPT. One call for the
// whole run to stay inside session quota; failure degrades to partial (no precision).
function judge(results: Result[]): boolean {
  const injecting = results.filter(r => r.inject && r.hits.length > 0);
  if (injecting.length === 0) return true;
  const blocks = injecting.map(r => {
    const items = r.hits.map((h, i) => `  item ${i}: [${h.layer}] ${h.text.replace(/\s+/g, " ").slice(0, 260)}`).join("\n");
    return `PROMPT ${r.id}: ${r.prompt}\n${items}`;
  }).join("\n\n");
  const instruction = "Read the input and output ONLY the requested JSON object. No prose, no code fences.";
  const stdinContent = [
    "A personal memory system auto-injects context items into an AI assistant's window when the user sends a prompt.",
    "For EACH prompt below, rate EACH injected item on how useful it is as background context for answering THAT prompt:",
    "  3 = on-point: directly needed to answer well",
    "  2 = relevant: genuinely helpful background",
    "  1 = tangential: topically adjacent but the answer does not need it",
    "  0 = noise: unrelated; injecting it wastes context and could degrade the answer",
    "Judge usefulness FOR THE PROMPT, not the item's general quality. Generic tasks (write a function, world facts) need NO personal context, so personal items there are 0-1.",
    "",
    blocks,
    "",
    `Output JSON: {"<prompt id>": [rating for item 0, rating for item 1, ...], ...} covering every prompt id above.`,
  ].join("\n");
  console.error(`judging ${injecting.reduce((n, r) => n + r.hits.length, 0)} injected items across ${injecting.length} prompts via claude -p (${summaryModel()})...`);
  const res = spawnSync("claude", ["-p", instruction, "--model", summaryModel(), "--output-format", "text"], {
    cwd: VAULT, input: stdinContent, shell: true,
    env: { ...process.env, LKHS_CAPTURE: "1" }, maxBuffer: 10 * 1024 * 1024, timeout: 300_000,
  });
  const raw = (res.stdout ? Buffer.from(res.stdout).toString("utf8") : "").trim();
  if (res.status !== 0 || !raw) {
    console.error(`judge failed (status ${res.status}): ${(res.stderr || "").toString().slice(0, 300)} -- precision will be partial`);
    return false;
  }
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e < 0) { console.error("judge output had no JSON object -- precision partial"); return false; }
  let parsed: Record<string, number[]>;
  try { parsed = JSON.parse(raw.slice(s, e + 1)); } catch { console.error("judge JSON parse failed -- precision partial"); return false; }
  for (const r of injecting) {
    const ratings = parsed[r.id];
    if (!Array.isArray(ratings)) continue;
    r.judged = r.hits.map((h, i) => ({ file: h.file, rating: Math.max(0, Math.min(3, Number(ratings[i] ?? 0))) }));
  }
  return true;
}

// ---- run ----------------------------------------------------------------------
async function run(psetFile: string, useJudge: boolean, label: string) {
  if (!fs.existsSync(psetFile)) { console.error(`prompt set not found: ${psetFile}`); process.exit(1); }
  const items: PromptItem[] = fs.readFileSync(psetFile, "utf-8").trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  await ensureDaemon();

  const results: Result[] = [];
  for (const it of items) {
    const times: number[] = [];
    let last: any = null;
    for (let i = 0; i < 3; i++) { const { json, ms } = await gate(it.prompt); times.push(ms); last = json; }
    const hits: GateHit[] = (last.hits || []).map((h: any) => ({ file: h.file, score: h.score, layer: h.layer, text: h.text }));
    const r: Result = {
      id: it.id, category: it.category, prompt: it.prompt,
      inject: !!last.inject && hits.length > 0,
      reason: String(last.reason || last.signal || ""),
      topScore: last.topScore ?? (hits[0]?.score ?? null),
      hitCount: hits.length, hits,
      latencyMs: Math.round(median(times)!),
    };
    results.push(r);
    console.log(`[${r.inject ? "INJ " : "----"}] ${it.id} ${it.category.padEnd(9)} hits=${r.hitCount} ${String(r.latencyMs).padStart(5)}ms  ${r.reason.slice(0, 34).padEnd(34)} ${it.prompt.slice(0, 56)}`);
  }

  let judgeOk = false;
  if (useJudge) judgeOk = judge(results);

  // ---- aggregate ---------------------------------------------------------------
  const byCat = (c: string) => results.filter(r => r.category === c);
  const silent = byCat("SILENT");
  const overInjection = silent.length ? silent.filter(r => r.inject).length / silent.length : null;
  const injecting = results.filter(r => r.inject);
  const volume = median(injecting.map(r => r.hitCount));
  const allLat = results.map(r => r.latencyMs);
  const judgedItems = results.flatMap(r => r.judged || []);
  const precision = judgedItems.length ? judgedItems.filter(j => j.rating >= 2).length / judgedItems.length : null;

  const catRow = (c: string) => {
    const rs = byCat(c);
    const inj = rs.filter(r => r.inject);
    const jd = rs.flatMap(r => r.judged || []);
    return {
      category: c, n: rs.length,
      inject_rate: rs.length ? inj.length / rs.length : null,
      median_hits_when_injecting: median(inj.map(r => r.hitCount)),
      precision: jd.length ? jd.filter(j => j.rating >= 2).length / jd.length : null,
      judged_items: jd.length,
      latency_p50: median(rs.map(r => r.latencyMs)),
    };
  };
  const perCategory = CATS.map(catRow);

  const metrics = {
    label, n: results.length,
    over_injection_rate: overInjection,
    injection_volume_median: volume,
    relevance_precision: precision,
    precision_partial: useJudge && !judgeOk,
    judged_items: judgedItems.length,
    injected_items_total: injecting.reduce((n, r) => n + r.hitCount, 0),
    latency_p50_ms: median(allLat), latency_p95_ms: pctile(allLat, 0.95),
    per_category: perCategory,
  };

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const iso = new Date().toISOString();
  const runFile = path.join(RUNS_DIR, `quality-${iso.replace(/[:.]/g, "-")}${label ? "-" + label : ""}.json`);
  fs.writeFileSync(runFile, JSON.stringify({ generated: iso, prompt_set: path.relative(VAULT, psetFile), metrics, results }, null, 2));

  const pc = (v: number | null) => v === null ? "  n/a" : (v * 100).toFixed(1).padStart(5) + "%";
  const nm = (v: number | null) => v === null ? " n/a" : String(Math.round(v)).padStart(4);
  console.log(`\n category   n  inject%  med-hits  precision(judged)  p50-ms`);
  console.log(` ---------  -  -------  --------  -----------------  ------`);
  for (const c of perCategory)
    console.log(` ${c.category.padEnd(9)} ${String(c.n).padStart(2)}  ${pc(c.inject_rate)}   ${nm(c.median_hits_when_injecting)}      ${pc(c.precision)} (${String(c.judged_items).padStart(2)})       ${nm(c.latency_p50)}`);
  console.log(`\n over-injection rate (SILENT): ${pc(overInjection)}`);
  console.log(` injection volume (median hits when injecting): ${volume ?? "n/a"}`);
  console.log(` relevance precision (>=2 of 0..3): ${pc(precision)}${metrics.precision_partial ? "  [PARTIAL: judge failed]" : ""} over ${judgedItems.length} items`);
  console.log(` latency p50/p95: ${nm(metrics.latency_p50_ms)} / ${nm(metrics.latency_p95_ms)} ms`);
  console.log(`run saved: ${runFile}`);
}

// ---- cli -----------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const argOf = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const pset = argOf("--set") ? path.resolve(argOf("--set")!) : PSET_DEFAULT;
  run(pset, !argv.includes("--no-judge"), argOf("--label") || "").catch(e => { console.error(e); process.exit(1); });
}
