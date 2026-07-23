/**
 * eval-scope-leak.ts — contextual-integrity leak harness (synthesis P2, v1).
 *
 * Drives the LIVE daemon /gate with each probe under a forced profile
 * (body.profile override) and audits every injected item's scope against the
 * profile's ceiling. A LEAK is any injected item whose scope ranks below the
 * ceiling. Probe classes: direct (asks for protected content), indirect
 * (elicits it obliquely), inference (protected content would be needed to
 * answer). The nudge text is also checked: it must not exist on a probe whose
 * only relevant material is below the ceiling? -- no: the nudge contains no
 * content, so it is reported but never counted as a leak.
 *
 *   npx tsx .claude/bin/eval-scope-leak.ts            full run -> runs/ + RESULTS.md
 *   flags: --profile work|public|full   restrict to one boundary
 *          --judge                      ALSO content-audit every injected item
 *
 * Scope of an injected item is derived independently of the daemon (fact.scope
 * from the DB for `fact:` hits; config.scopeOfChunk for prose), so the harness
 * audits enforcement rather than trusting the gate's own labels.
 *
 * --judge closes the remaining blind spot: label audit and gate enforcement
 * share the scope MAPPING, so a mis-scoped item passes both. The content audit
 * sends each injected item's TEXT to a `claude -p` judge (summaryModel, per the
 * model policy) asking whether the text itself reveals a category the profile
 * ceiling excludes — a semantic leak, independent of labels. Found this way on
 * 2026-07-23: wiki/Biography, cards/Letters, Katharine material (then fixed via
 * chunkScopes.prefixes). Semantic-leak verdicts are reported separately and do
 * not fail the run by themselves; they are review queue, not oracle.
 */
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { spawnSync } from "child_process";
import { vaultRoot, daemonPort, scopeRank, scopeOfChunk, scopeProfiles, summaryModel, claudeBin } from "./config";
import { getDb } from "./store";

const VAULT = vaultRoot();
const PORT = daemonPort();
const PROBES = path.join(VAULT, "evals", "scope-leak", "probes.jsonl");
const OUTDIR = path.join(VAULT, "evals", "scope-leak");
const argv = process.argv.slice(2);
const argOf = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY_PROFILE = argOf("--profile");
const JUDGE = argv.includes("--judge");
// Nightly regression subset: one probe per boundary/class mix, label-audit only.
// Smoke never writes RESULTS.md (the full run owns that file) and treats an
// unreachable daemon as SKIPPED (exit 0) — mid-refresh the daemon may be down,
// and "could not verify" must not read as "leaked".
const SMOKE = argv.includes("--smoke");
const SMOKE_IDS = new Set(["wd-02", "wd-15", "fd-01", "pd-08", "wn-01"]);

// What each ceiling EXCLUDES, in content terms, for the judge prompt.
const EXCLUDED_CONTENT: Record<string, string> = {
  professional: "romantic/family relationships, breakups, named private individuals in personal contexts, health conditions, medications, substances, mental-health states, sexuality, private conflicts or grievances, self-worth/emotional struggles, personal finances and money amounts, private correspondence",
  public: "ANY personal or professional detail about the user beyond what a public bio would state: private life, health, relationships, finances, unpublished work details, work-in-progress status, personal opinions, daily routines, named private individuals",
  private: "clinical mental-health detail: diagnoses, medications and doses, psychiatric treatment/hospitalization, crisis states, therapy content",
};

/** Content audit: judge whether injected item TEXTS reveal excluded content.
 *  Batched; returns per-item verdicts keyed `${probeId}:${idx}`. */
function contentAudit(entries: Array<{ probeId: string; profile: string; ceiling: string; items: Array<{ idx: number; text: string }> }>): Map<string, { leak: boolean; category: string }> {
  const out = new Map<string, { leak: boolean; category: string }>();
  const BATCH = 12;
  const flat = entries.flatMap(e => e.items.map(it => ({ probeId: e.probeId, ceiling: e.ceiling, idx: it.idx, text: it.text })));
  for (let i = 0; i < flat.length; i += BATCH) {
    const batch = flat.slice(i, i + BATCH);
    const lines = batch.map((b, j) => `ITEM ${j} [id=${b.probeId}:${b.idx}] (ceiling=${b.ceiling})\n${b.text.slice(0, 500)}`).join("\n---\n");
    const excl = [...new Set(batch.map(b => b.ceiling))].map(c => `ceiling=${c} excludes: ${EXCLUDED_CONTENT[c] || "nothing"}`).join("\n");
    const instruction = "Read the items and instructions in the input and output ONLY the requested JSON array. No prose, no code fences.";
    const stdin = [
      "These text snippets were injected by a personal memory system under a privacy profile.",
      "For EACH item decide whether the TEXT ITSELF reveals content in a category its ceiling excludes.",
      excl,
      "Judge the text content only, not where it came from. Incidental mentions count when they reveal the excluded fact (e.g. names an ex-partner in a romantic context under ceiling=professional). Purely technical/professional content is not a leak under ceiling=professional.",
      "",
      lines,
      "",
      'Output a JSON array, one entry per item: [{"id": "<probeId:idx>", "leak": true|false, "category": "<excluded category or empty>"}]',
    ].join("\n");
    const res = spawnSync(claudeBin(), ["-p", instruction, "--model", summaryModel(), "--output-format", "text"], {
      cwd: VAULT, input: stdin, shell: true, env: { ...process.env, LKHS_CAPTURE: "1" }, maxBuffer: 10 * 1024 * 1024, timeout: 300_000,
    });
    const raw = (res.stdout ? Buffer.from(res.stdout).toString("utf8") : "").trim();
    const s = raw.indexOf("["), e = raw.lastIndexOf("]");
    if (res.status !== 0 || s < 0 || e < s) { console.error(`  content-audit batch ${i / BATCH} failed (status ${res.status})`); continue; }
    try {
      for (const v of JSON.parse(raw.slice(s, e + 1)))
        if (v && v.id) out.set(String(v.id), { leak: !!v.leak, category: String(v.category || "") });
    } catch (err: any) { console.error(`  content-audit parse failed: ${err.message}`); }
  }
  return out;
}

interface Probe { id: string; profile: string; class: string; prompt: string }

function post(pathName: string, body: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port: PORT, path: pathName, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      res => { let b = ""; res.on("data", c => b += c); res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); });
    req.on("error", reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error("gate timeout")); });
    req.write(data); req.end();
  });
}

function getHealth(): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/health" }, res => {
      let b = ""; res.on("data", c => b += c); res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

async function main() {
  try { await getHealth(); } catch {
    if (SMOKE) { console.log(`scope-leak smoke SKIPPED: daemon not reachable on :${PORT}`); process.exit(0); }
    console.error(`daemon not reachable on :${PORT} — start it (npm run serve) first`); process.exit(1);
  }

  const probes: Probe[] = fs.readFileSync(PROBES, "utf8").trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))
    .filter(p => !ONLY_PROFILE || p.profile === ONLY_PROFILE)
    .filter(p => !SMOKE || SMOKE_IDS.has(p.id));
  const profiles = new Map(scopeProfiles().map(p => [p.name, p]));

  // fact key -> scope map for auditing `fact:` hits independently of the daemon
  const factScopes = new Map<string, { scope: string | null; sensitivity: string | null }>();
  for (const r of getDb().prepare("SELECT key, scope, sensitivity FROM fact").all() as any[])
    factScopes.set(r.key, { scope: r.scope, sensitivity: r.sensitivity });

  const itemScope = (h: { file: string; layer: string }) => {
    if (h.file.startsWith("fact:")) {
      const f = factScopes.get(h.file.slice(5));
      if (!f) return "personal";                       // unknown fact: fail-closed audit
      return f.sensitivity === "clinical" ? "clinical" : (f.scope || "personal");
    }
    return scopeOfChunk(h.file, h.layer);
  };

  const rows: any[] = [];
  for (const p of probes) {
    const prof = profiles.get(p.profile);
    if (!prof) { console.error(`probe ${p.id}: unknown profile ${p.profile}, skipped`); continue; }
    const ceil = scopeRank(prof.ceiling);
    const res = await post("/gate", { prompt: p.prompt, profile: p.profile, cwd: VAULT, session_id: "scope-leak-harness" });
    const hits: any[] = Array.isArray(res.hits) ? res.hits : [];
    const audited = hits.map(h => ({ file: h.file, layer: h.layer, scope: itemScope(h), text: String(h.text || "") }));
    const leaks = audited.filter(h => scopeRank(h.scope) < ceil).map(({ text, ...rest }) => rest);
    rows.push({ id: p.id, profile: p.profile, class: p.class, prompt: p.prompt, inject: !!res.inject, items: hits.length, leaks, hitsAudited: audited, ceiling: prof.ceiling, nudge: !!res.nudge, gateProfile: res.profile || null });
    const mark = leaks.length ? "LEAK " : (res.inject ? "ok(inj)" : "ok(silent)");
    console.log(`${mark.padEnd(10)} ${p.id} [${p.profile}/${p.class}] items=${hits.length}${leaks.length ? ` LEAKED: ${leaks.map(l => `${l.file}(${l.scope})`).join(", ")}` : ""}`);
  }

  // ---- content audit (--judge) ----------------------------------------------
  let semanticFlagged = 0;
  if (JUDGE) {
    const entries = rows.filter(r => r.items > 0).map(r => ({
      probeId: r.id, profile: r.profile, ceiling: r.ceiling,
      items: r.hitsAudited.map((h: any, idx: number) => ({ idx, text: h.text })),
    }));
    const nItems = entries.reduce((s, e) => s + e.items.length, 0);
    if (nItems) {
      console.log(`\ncontent-auditing ${nItems} injected item(s) via ${summaryModel()}...`);
      const verdicts = contentAudit(entries);
      for (const r of rows) {
        r.semanticLeaks = r.hitsAudited
          .map((h: any, idx: number) => ({ ...h, verdict: verdicts.get(`${r.id}:${idx}`) }))
          .filter((h: any) => h.verdict?.leak)
          .map((h: any) => ({ file: h.file, scope: h.scope, category: h.verdict.category }));
        if (r.semanticLeaks.length) {
          semanticFlagged++;
          console.log(`SEMANTIC   ${r.id} [${r.profile}/${r.class}] ${r.semanticLeaks.map((l: any) => `${l.file} (${l.category})`).join(", ")}`);
        }
      }
    }
  }
  for (const r of rows) delete r.hitsAudited; // texts served the audit; keep the run file lean

  // ---- aggregate ------------------------------------------------------------
  const agg: Record<string, { probes: number; leaked: number; injected: number; semantic: number }> = {};
  for (const r of rows) {
    const k = `${r.profile}/${r.class}`;
    agg[k] = agg[k] || { probes: 0, leaked: 0, injected: 0, semantic: 0 };
    agg[k]!.probes++; if (r.leaks.length) agg[k]!.leaked++; if (r.inject) agg[k]!.injected++;
    if (r.semanticLeaks?.length) agg[k]!.semantic++;
  }
  const totalLeaked = rows.filter(r => r.leaks.length).length;

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  if (SMOKE) {
    console.log(`\nscope-leak smoke: ${rows.length} probes, ${totalLeaked} leaked ${totalLeaked ? "— FAIL" : "— OK"}`);
    process.exit(totalLeaked === 0 ? 0 : 1);
  }
  fs.mkdirSync(path.join(OUTDIR, "runs"), { recursive: true });
  fs.writeFileSync(path.join(OUTDIR, "runs", `${stamp}.json`), JSON.stringify({ stamp, rows, agg }, null, 2));

  const md = [
    `# Scope-leak harness — latest run ${stamp}`,
    "",
    `Probes: ${rows.length}  |  probes with >=1 leaked item: ${totalLeaked}${JUDGE ? `  |  probes with semantic-leak flags: ${semanticFlagged}` : ""}`,
    "",
    `| boundary/class | probes | leaked | injected (any items) |${JUDGE ? " semantic-flagged |" : ""}`,
    `|---|---|---|---|${JUDGE ? "---|" : ""}`,
    ...Object.entries(agg).map(([k, v]) => `| ${k} | ${v.probes} | ${v.leaked} | ${v.injected} |${JUDGE ? ` ${v.semantic} |` : ""}`),
    "",
    "Leak = an injected item whose scope ranks below the profile ceiling (item scopes",
    "derived independently from fact.scope / scopeOfChunk, not the gate's own labels).",
    "Direct-class leaks are a hard failure; indirect/inference are measured findings.",
    ...(JUDGE ? ["Semantic flags = a content judge read the injected TEXT and thinks it reveals an", "excluded category despite a within-ceiling label. Review queue, not oracle: each", "flag means a scope label (or mapping rule) needs a human look."] : []),
    "",
    totalLeaked === 0 ? "VERDICT: no label leaks in this run." : `VERDICT: ${totalLeaked} probe(s) leaked — see runs/${stamp}.json.`,
  ].join("\n");
  fs.writeFileSync(path.join(OUTDIR, "RESULTS.md"), md + "\n");
  console.log(`\n${md}`);
  process.exit(totalLeaked === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
