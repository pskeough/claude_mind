/**
 * build-ledger.ts — an append-only record of DECISIONS for the learning-system build.
 *
 *   npm run ledger                          list
 *   npm run ledger -- --open                only decisions still unresolved
 *   npm run ledger -- --add '<json>'        append one
 *   npm run ledger -- --resolve <id> <outcome> <note>
 *
 * WHY A SEPARATE LEDGER. The lesson ledger records what the SYSTEM learned. This
 * records what WE decided while building it, which is different information and is
 * otherwise lost the moment a session ends. Three uses, in order of value:
 *
 *   1. Pre-registration. A measurement design written down BEFORE the number comes
 *      back cannot be quietly adjusted after. This build has already measured the
 *      wrong thing twice (coverage over-attribution, then temporal leakage), both
 *      caught only by an outside audit. Recording the design first is the cheapest
 *      available defence against a third.
 *   2. Reversibility. Every entry names what would make it wrong, so a decision can
 *      be revisited on evidence rather than on vibes.
 *   3. Salvage. Effort that does not ship still produced knowledge; a rejected
 *      approach with its reason is worth more than silence, because the next attempt
 *      does not repeat it.
 *
 * Append-only and tombstoned like everything else here: `--resolve` appends an
 * outcome, it never edits history.
 */
import * as fs from "fs";
import * as path from "path";
import { memDir } from "./config";

const LEDGER = () => path.join(memDir(), "build-decisions.jsonl");

export interface Decision {
  id: string;
  ts: string;
  kind: "decision" | "prereg" | "rejected" | "outcome";
  topic: string;
  /** what was decided, in one sentence */
  what: string;
  /** the reasoning that is NOT recoverable from the diff */
  why: string;
  /** what observation would make this the wrong call */
  falsifier?: string;
  /** for prereg: the design, fixed before the result is seen */
  design?: string;
  /** set by --resolve; append-only, so the original entry stays */
  resolves?: string;
  outcome?: string;
}

function load(): Decision[] {
  try {
    return fs.readFileSync(LEDGER(), "utf8").split("\n").filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as Decision; } catch { return null; } })
      .filter((x): x is Decision => !!x);
  } catch { return []; }
}

export function add(d: Omit<Decision, "id" | "ts"> & { id?: string; ts?: string }): Decision {
  const rows = load();
  const rec: Decision = {
    id: d.id || `d-${String(rows.length + 1).padStart(3, "0")}`,
    ts: d.ts || new Date().toISOString(),
    ...d,
  } as Decision;
  fs.mkdirSync(path.dirname(LEDGER()), { recursive: true });
  fs.appendFileSync(LEDGER(), JSON.stringify(rec) + "\n");
  return rec;
}

function list(openOnly: boolean) {
  const rows = load();
  const resolved = new Set(rows.filter(r => r.resolves).map(r => r.resolves));
  const show = rows.filter(r => !r.resolves && (!openOnly || !resolved.has(r.id)));
  const tag = { decision: "DEC ", prereg: "PRE ", rejected: "REJ ", outcome: "OUT " } as Record<string, string>;
  for (const r of show) {
    const done = resolved.has(r.id) ? " [resolved]" : "";
    console.log(`\n${tag[r.kind] || "    "}${r.id}  ${r.ts.slice(0, 10)}  ${r.topic}${done}`);
    console.log(`  what: ${r.what}`);
    console.log(`  why : ${r.why}`);
    if (r.design) console.log(`  design: ${r.design}`);
    if (r.falsifier) console.log(`  wrong if: ${r.falsifier}`);
    for (const o of rows.filter(x => x.resolves === r.id))
      console.log(`  -> ${o.ts.slice(0, 10)} ${o.outcome}: ${o.what}`);
  }
  console.log(`\n${show.length} shown, ${rows.length} total entries. ${LEDGER()}`);
}

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === "--add" && a[1]) { console.log("added " + add(JSON.parse(a[1])).id); }
  else if (a[0] === "--resolve" && a[1]) {
    const rec = add({ kind: "outcome", topic: "resolution", resolves: a[1], outcome: a[2] || "done", what: a.slice(3).join(" ") || "(no note)", why: "" });
    console.log(`resolved ${a[1]} as ${a[2]} (${rec.id})`);
  } else list(a.includes("--open"));
}
