/**
 * LKHS claims ledger: verified research claims as first-class memory.
 *
 * Scope is RESEARCH ONLY (papers, analyses, benchmarks) - not general facts; those
 * live in the persona/fact layers. The recurring failure this kills is number drift:
 * a stat gets corrected in the data (SES quote-form bug, GT artifacts) but stale
 * values keep circulating in drafts. A claim here is (paper, statement, value,
 * source, verified date, status); the audit workflow writes verdicts in, writing
 * sessions check against it.
 *
 * Statuses mirror the paper-claim-audit verdict table: verified | corrected |
 * unverifiable | stale. Corrections chain via supersedes (append-only, like facts).
 * Store: .claude/memory/claims.jsonl. Consumed via the record_claim / check_claims
 * MCP tools; kept dependency-light so anything can import it.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { memDir } from "./config";

export interface Claim {
  id: string;
  paper: string;               // e.g. "MyPaper"
  claim: string;               // the assertion, self-contained
  value: string;               // the load-bearing number/stat as it should appear
  source: string;              // file path / analysis artifact / citation that verifies it
  status: "verified" | "corrected" | "unverifiable" | "stale";
  verified: string;            // ISO date of last verification
  note?: string;
  supersedes?: string;         // id of the claim this corrects
}

const FILE = path.join(memDir(), "claims.jsonl");

export function loadClaims(): Claim[] {
  try {
    return fs.readFileSync(FILE, "utf-8").split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((c): c is Claim => !!c && !!c.id && !!c.claim);
  } catch { return []; }
}

export function addClaim(c: Omit<Claim, "id" | "verified"> & { verified?: string }): Claim | null {
  if (!c.paper?.trim() || !c.claim?.trim() || !c.value?.trim() || !c.source?.trim()) return null;
  const all = loadClaims();
  const row: Claim = {
    id: crypto.createHash("sha1").update(c.paper + "|" + c.claim + "|" + Date.now()).digest("hex").slice(0, 12),
    paper: c.paper.trim(), claim: c.claim.replace(/\s+/g, " ").trim().slice(0, 400),
    value: c.value.trim(), source: c.source.trim(),
    status: c.status, verified: c.verified || new Date().toISOString().slice(0, 10),
    ...(c.note ? { note: c.note.slice(0, 300) } : {}),
    ...(c.supersedes ? { supersedes: c.supersedes } : {})
  };
  // A correction marks its target stale (append-only: the old row's line is rewritten
  // in place with status flipped; history stays in git).
  if (row.supersedes) {
    for (const old of all) if (old.id === row.supersedes && old.status !== "stale") { old.status = "stale"; old.note = `superseded by ${row.id}${old.note ? "; " + old.note : ""}`; }
  }
  all.push(row);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, all.map(x => JSON.stringify(x)).join("\n") + "\n", "utf-8");
  fs.renameSync(tmp, FILE);
  return row;
}

/** Find ledger rows relevant to a query/passage: paper filter + word-overlap match,
 *  plus number-collision detection (same claim context, different value = the drift
 *  this ledger exists to catch). */
export function checkClaims(query: string, paper?: string): { matches: Claim[]; collisions: Array<{ claim: Claim; foundInQuery: string }> } {
  let rows = loadClaims();
  if (paper) { const p = paper.toLowerCase(); rows = rows.filter(r => r.paper.toLowerCase().includes(p) || p.includes(r.paper.toLowerCase())); }
  const qWords = new Set(query.toLowerCase().replace(/[^a-z0-9.%=\s]/g, " ").split(/\s+/).filter(w => w.length > 3));
  const qNumbers = query.match(/\d[\d,]*\.?\d*%?/g) || [];
  const norm = (s: string) => s.replace(/,/g, "").toLowerCase();
  const qNumSet = new Set(qNumbers.map(norm));

  const matches: Claim[] = [];
  const collisions: Array<{ claim: Claim; foundInQuery: string }> = [];
  for (const r of rows) {
    const cw = r.claim.toLowerCase().replace(/[^a-z0-9.%=\s]/g, " ").split(/\s+/).filter(w => w.length > 3);
    let hits = 0; for (const w of cw) if (qWords.has(w)) hits++;
    const overlap = cw.length ? hits / cw.length : 0;
    if (overlap >= 0.3) {
      matches.push(r);
      // Same claim territory but the ledger's value is absent from the passage while
      // OTHER numbers are present -> likely stale number in the draft.
      if (r.status === "verified" && qNumbers.length && !qNumSet.has(norm(r.value))) {
        collisions.push({ claim: r, foundInQuery: qNumbers.slice(0, 6).join(", ") });
      }
    }
  }
  matches.sort((a, b) => (b.verified || "").localeCompare(a.verified || ""));
  return { matches: matches.slice(0, 12), collisions: collisions.slice(0, 6) };
}
