/**
 * ledger-automation-report.ts — PROPOSE-ONLY: which session-ledger entries are
 * LKHS automation (same isAutomation signature as capture-sweep.ts), what
 * journal digests they produced, and what a cleanup would touch. Writes the
 * proposal to command-center/LEDGER-CLEANUP-PROPOSAL.md; changes NOTHING.
 *
 *   npx tsx .claude/bin/ledger-automation-report.ts
 */
import * as fs from "fs";
import * as path from "path";
import { vaultRoot } from "./config";

const VAULT = vaultRoot();
const LEDGER = path.join(VAULT, "journal", "_sessions.jsonl");
const OUT = path.join(VAULT, "command-center", "LEDGER-CLEANUP-PROPOSAL.md");

const AUTOMATION_RE = /output ONLY the requested JSON|BEGIN_FACTS|BEGIN_CONVERSATION|BEGIN_SESSION_LOG|BEGIN_PROJECT_DIGEST|LKHS ambient compile|archivist instructions|injected by a personal memory system under a privacy profile/;

function head(file: string): string {
  try {
    const fd = fs.openSync(file, "r");
    try { const buf = Buffer.alloc(65536); const n = fs.readSync(fd, buf, 0, buf.length, 0); return buf.toString("utf-8", 0, n); }
    finally { fs.closeSync(fd); }
  } catch { return ""; }
}
function isAutomation(h: string): boolean {
  for (const l of h.split("\n")) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l);
      if (o.type !== "user") continue;
      const c = o.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => b?.text || "").join("\n") : "";
      return AUTOMATION_RE.test(text);
    } catch { /* */ }
  }
  return false;
}

function main() {
  const rows = fs.readFileSync(LEDGER, "utf8").split(/\r?\n/).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[];
  // one verdict per sessionId (ledger has repeated capture events)
  const byId = new Map<string, any>();
  for (const r of rows) byId.set(r.sessionId, r);

  const auto: any[] = [], gone: any[] = [];
  for (const r of byId.values()) {
    if (!r.transcript || !fs.existsSync(r.transcript)) { gone.push(r); continue; }
    if (isAutomation(head(r.transcript))) auto.push(r);
  }
  const byProject = new Map<string, number>();
  for (const r of auto) byProject.set(r.project, (byProject.get(r.project) || 0) + 1);
  const ledgerRowsAffected = rows.filter(r => auto.some(a => a.sessionId === r.sessionId)).length;

  const md = [
    `# Ledger cleanup proposal — automation entries (generated ${new Date().toISOString().slice(0, 10)})`,
    "",
    "PROPOSE-ONLY: nothing has been changed. Approve and a cleanup pass can",
    "(1) drop these rows from journal/_sessions.jsonl and (2) locate + tombstone",
    "any journal digest text they generated. Forward pollution already stopped",
    "(capture-sweep isAutomation filter, 2026-07-23).",
    "",
    `Distinct sessions in ledger: ${byId.size}`,
    `Automation sessions identified: ${auto.length} (${ledgerRowsAffected} ledger rows incl. repeat captures)`,
    `Sessions whose transcript is gone (unverifiable, left untouched): ${gone.length}`,
    "",
    "| project | automation sessions |",
    "|---|---|",
    ...[...byProject.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `| ${p} | ${n} |`),
    "",
    "Verification method: first user turn of each transcript matched against the",
    "same instruction-phrase signature capture-sweep now filters on. Sample of 10:",
    ...auto.slice(0, 10).map(r => `- ${r.project} ${String(r.sessionId).slice(0, 8)} "${String(r.title || "").replace(/\s+/g, " ").slice(0, 70)}"`),
  ].join("\n");
  fs.writeFileSync(OUT, md + "\n");
  console.log(md);
  console.log(`\nproposal written: ${path.relative(VAULT, OUT)}`);
}

main();
