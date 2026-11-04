/**
 * capabilities.ts — the executable tier.
 *
 *   npm run cap                       list
 *   npm run cap -- --verify <id>      run its test, record the result
 *   npm run cap -- --verify-all       re-verify everything active
 *   npm run cap -- --render           write SKILL.md for active capabilities
 *   npm run cap -- --retire <id> why
 *
 * WHERE THIS SITS. Every other layer in this vault terminates in TEXT. A chunk becomes a
 * passage, a fact becomes a sentence, a principle becomes a bullet in a prompt. All of it
 * is advisory, and the capability surface only grows when the user writes something. This
 * is the tier where learning terminates in something that RUNS.
 *
 * The partition against tier 2 is not about importance, it is about what recurs:
 *   a cluster of episodes whose recurring content is a JUDGMENT      -> tier-2 principle
 *   a cluster whose recurring content is a SEQUENCE OF TOOL CALLS    -> a capability
 * "Check the raw output file before calling a number verified" is judgment. "Extract every
 * numeric claim from a .tex file and diff it against assets/stats" is a script.
 *
 * THE GATE, and why it is the strongest one in the system. A lesson without a falsifier is
 * rejected at write time; that is what keeps the ledger from filling with platitudes. The
 * analogue here is exact and stricter: A CAPABILITY WITHOUT A RUNNABLE TEST IS REJECTED,
 * because the test IS the falsifier for an executable. And unlike a falsifier, which a
 * reading model has to evaluate in context, a test either passes or it does not.
 *
 * VERIFICATION IS NOT SELF-REPORTED. `verify()` spawns the test and reads the exit code.
 * The model that proposed a capability never gets to say whether it works. This is the one
 * adaptation taken from "Self-Authored Verification Is Unreliable in Heuristic
 * Self-Improving Agents", whose measured failure is that a co-evolving self-test drifts to
 * accept whatever the policy currently does: it found agents that discovered a good
 * behaviour and then edited it away while their own tests moved to bless the degraded
 * version. Full sealing is impossible here (Claude Code can read every file on disk), but
 * the cheap and load-bearing half transfers: the ACCEPTANCE DECISION is computed by the
 * harness from an exit code, never asserted in model output.
 *
 * PROMOTION LADDER, strictest at the top, same shape as lessons:
 *   proposed  written, test present, never passed        -> never delivered
 *   active    test has passed at least once              -> rendered to SKILL.md, indexed
 *   retired   test broke, or superseded, or unused       -> tombstoned, never deleted
 * A capability that has never passed cannot be active, so nothing reaches a session on the
 * strength of a plausible-looking script.
 *
 * Storage mirrors lessons.jsonl and persona_facts.jsonl: atomic, append-only, tombstoned,
 * scoped. SKILL.md is a RENDERED VIEW, never the source of truth — the same relationship
 * PLAYBOOK.md has to the lesson ledger, and for the same reason (a file that gets rewritten
 * in place is a file that loses its history).
 */
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { memDir, vaultRoot, scopeRank } from "./config";

export const CAP_LEDGER = () => path.join(memDir(), "capabilities.jsonl");
const SKILL_DIR = () => path.join(vaultRoot(), ".claude", "skills");

export type CapStatus = "proposed" | "active" | "retired";

export interface Capability {
  id: string;
  /** kebab-case; becomes the skill directory name */
  name: string;
  /** what it does and WHEN to reach for it — this is the text the router matches on */
  description: string;
  /** the situation that should bring it to mind, in prose */
  trigger: string;
  /** shell command that performs the work, with <placeholders> for arguments */
  command: string;
  /** THE GATE: a command that exits 0 when this capability still works */
  test: string;
  /** what the test proves, in one sentence — a test whose purpose cannot be stated
   *  is usually asserting that the file exists */
  test_asserts: string;
  /** provenance: episode session ids or lesson ids this was derived from */
  derived_from: string[];
  status: CapStatus;
  scope: string;
  created: string;
  last_verified: string | null;
  runs: number;
  passes: number;
  invalid_at: string | null;
  source: string;
}

export function loadCapabilities(): Capability[] {
  try {
    return fs.readFileSync(CAP_LEDGER(), "utf8").split("\n").filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as Capability; } catch { return null; } })
      .filter((x): x is Capability => !!x);
  } catch { return []; }
}

/** Latest record wins per id (append-only log). */
export function currentCapabilities(): Capability[] {
  const byId = new Map<string, Capability>();
  for (const c of loadCapabilities()) byId.set(c.id, c);
  return [...byId.values()].filter(c => !c.invalid_at);
}

export function activeCapabilities(): Capability[] {
  return currentCapabilities().filter(c => c.status === "active");
}

function append(c: Capability): void {
  fs.mkdirSync(path.dirname(CAP_LEDGER()), { recursive: true });
  fs.appendFileSync(CAP_LEDGER(), JSON.stringify(c) + "\n");
}

export interface UpsertCapability {
  name: string; description: string; trigger: string;
  command: string; test: string; test_asserts: string;
  derived_from: string[]; scope?: string; source: string;
}

/**
 * Write or update a capability. Always lands `proposed`: only a PASSING TEST promotes,
 * and only verify() can observe that.
 */
export function upsertCapability(input: UpsertCapability): "inserted" | "updated" | "rejected" {
  // Gate 1: a capability without a runnable test is a suggestion, not a capability.
  if (!input.test || input.test.trim().length < 4) return "rejected";
  if (!input.test_asserts || input.test_asserts.trim().length < 12) return "rejected";
  if (!input.command || !input.name || !input.description) return "rejected";
  // Gate 2: it must name the evidence it came from, exactly as a tier-2 principle must.
  // A capability nobody can trace to a real recurring situation is speculative tooling.
  if (!input.derived_from?.length) return "rejected";
  // Gate 3: a test that cannot fail proves nothing. These are the shapes that show up
  // when a model is asked for a test and has nothing real to assert.
  if (/^(true|echo\b|exit 0)/.test(input.test.trim())) return "rejected";

  const id = "cap-" + input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const existing = currentCapabilities().find(c => c.id === id);
  const now = new Date().toISOString().slice(0, 10);
  append({
    id,
    name: input.name,
    description: input.description,
    trigger: input.trigger,
    command: input.command,
    test: input.test,
    test_asserts: input.test_asserts,
    derived_from: [...new Set([...(existing?.derived_from || []), ...input.derived_from])],
    // A changed command invalidates a previous pass, so an edit always drops back to
    // proposed and must re-earn promotion. Otherwise a working capability could be
    // rewritten into a broken one while keeping its active status.
    status: existing && existing.command === input.command && existing.status === "active" ? "active" : "proposed",
    scope: input.scope || existing?.scope || "professional",
    created: existing?.created || now,
    last_verified: existing && existing.command === input.command ? existing.last_verified : null,
    runs: existing?.runs || 0,
    passes: existing && existing.command === input.command ? existing.passes : 0,
    invalid_at: null,
    source: input.source,
  });
  return existing ? "updated" : "inserted";
}

export function retireCapability(id: string, why: string): boolean {
  const c = currentCapabilities().find(x => x.id === id);
  if (!c) return false;
  append({ ...c, status: "retired", invalid_at: new Date().toISOString().slice(0, 10), source: `${c.source} | retired: ${why}` });
  return true;
}

/**
 * Run the test and record what happened. This is the only path to `active`.
 *
 * The result is an EXIT CODE, not a judgment. Nothing a model says about whether its own
 * capability works is consulted here, which is the whole point.
 */
export function verify(id: string, timeoutMs = 120_000): { ok: boolean; detail: string } {
  const c = currentCapabilities().find(x => x.id === id);
  if (!c) return { ok: false, detail: "no such capability" };
  const r = spawnSync(c.test, {
    shell: true, cwd: vaultRoot(), timeout: timeoutMs, encoding: "utf8",
    windowsHide: true,
  });
  const ok = r.status === 0;
  const detail = ok
    ? `exit 0`
    : `exit ${r.status ?? "timeout/signal"}: ${String(r.stderr || r.stdout || "").trim().split("\n").slice(0, 2).join(" ").slice(0, 200)}`;
  append({
    ...c,
    runs: c.runs + 1,
    passes: c.passes + (ok ? 1 : 0),
    last_verified: new Date().toISOString().slice(0, 10),
    // Promotion and demotion are both mechanical. A capability that stops passing stops
    // being delivered on the same run that observes it, without waiting for a human.
    status: ok ? "active" : c.status === "active" ? "retired" : "proposed",
    invalid_at: null,
    source: ok ? c.source : `${c.source} | test failed ${new Date().toISOString().slice(0, 10)}`,
  });
  return { ok, detail };
}

/**
 * Render active capabilities as SKILL.md files.
 *
 * Rendered, never authoritative: skill-index.ts already scans this directory, embeds
 * `name. description` into the `skill` layer, and the daemon scores that layer separately
 * so a capability can never displace a memory hit. So the entire delivery path — routing,
 * scope handling, pruning of files that vanish — already exists and is reused rather than
 * rebuilt. `ceiling` applies the same scope ladder the retrieval path uses, since these
 * files sit on disk where a hook with no profile awareness may read them.
 */
export function renderSkills(ceiling = scopeRank("professional")): string[] {
  const written: string[] = [];
  for (const c of activeCapabilities()) {
    if (scopeRank(c.scope) < ceiling) continue;
    const dir = path.join(SKILL_DIR(), c.name);
    fs.mkdirSync(dir, { recursive: true });
    const md = [
      "---",
      `name: ${c.name}`,
      `description: ${c.description.replace(/\n/g, " ")} Use when: ${c.trigger.replace(/\n/g, " ")}`,
      "---",
      "",
      `# ${c.name}`,
      "",
      "> Generated from the capability ledger. Do not edit here; edit the ledger entry and",
      `> re-render. Verified ${c.last_verified} (${c.passes}/${c.runs} passes).`,
      "",
      "## When this applies",
      "",
      c.trigger,
      "",
      "## Run",
      "",
      "```bash",
      c.command,
      "```",
      "",
      "## How you know it still works",
      "",
      c.test_asserts,
      "",
      "```bash",
      c.test,
      "```",
      "",
      "## Provenance",
      "",
      `Derived from ${c.derived_from.length} prior session(s)/lesson(s): ${c.derived_from.slice(0, 6).join(", ")}`,
    ].join("\n");
    const f = path.join(dir, "SKILL.md");
    fs.writeFileSync(f, md);
    written.push(f);
  }
  return written;
}

// ---- CLI -------------------------------------------------------------------
if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === "--verify" && a[1]) {
    const r = verify(a[1]);
    console.log(`${a[1]}: ${r.ok ? "PASS" : "FAIL"} — ${r.detail}`);
    if (r.ok) console.log(`  now active; run --render to publish it as a skill`);
    process.exit(r.ok ? 0 : 1);
  } else if (a[0] === "--verify-all") {
    const caps = currentCapabilities().filter(c => c.status !== "retired");
    if (!caps.length) { console.log("no capabilities to verify"); process.exit(0); }
    let fails = 0;
    for (const c of caps) {
      const r = verify(c.id);
      if (!r.ok) fails++;
      console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${c.id}  ${r.detail}`);
    }
    console.log(`\n${caps.length - fails}/${caps.length} passing`);
    const w = renderSkills();
    console.log(`rendered ${w.length} SKILL.md file(s)`);
  } else if (a[0] === "--render") {
    const w = renderSkills();
    console.log(w.length ? `wrote:\n  ${w.join("\n  ")}` : "no active capabilities to render");
  } else if (a[0] === "--retire" && a[1]) {
    console.log(retireCapability(a[1], a.slice(2).join(" ") || "manual") ? "retired" : "not found");
  } else {
    const cur = currentCapabilities();
    const act = cur.filter(c => c.status === "active");
    console.log(`capabilities: ${cur.length} current, ${act.length} active\n`);
    for (const c of cur) {
      console.log(`  [${c.status}] ${c.id}  ${c.passes}/${c.runs} passes${c.last_verified ? `, last ${c.last_verified}` : ", never run"}`);
      console.log(`      ${c.description.slice(0, 96)}`);
      console.log(`      test: ${c.test.slice(0, 96)}`);
    }
    if (!cur.length) console.log("  (none yet)");
    console.log(`\nledger: ${CAP_LEDGER()}`);
  }
}
