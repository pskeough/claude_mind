/**
 * test-scope.ts — unit test for the synthesis-P1 scope layer against a scratch DB.
 *
 * Covers: scopeOfChunk derivation (layer defaults + etiquette prefixes),
 * resolveProfile resolution order, knn/lexicalKnn chunk ceilings, factKnn/
 * lexicalFactKnn fact ceilings (incl. clinical belt-and-braces and the
 * supersession-forwarding path), and the no-ceiling = unchanged contract.
 *
 *   npx tsx .claude/bin/test-scope.ts
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRATCH = path.join(os.tmpdir(), `lkhs-scope-test-${process.pid}.db`);
process.env.LKHS_DB_PATH = SCRATCH;

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.error(`  FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
}

async function main() {
  const store = await import("./store");
  const cfg = await import("./config");
  const { upsertFile, upsertFact, knn, lexicalKnn, factKnn, lexicalFactKnn, DIM } = store;
  const { scopeRank, scopeOfChunk, resolveProfile } = cfg;

  // ---- scope derivation + profile resolution --------------------------------
  console.log("scopeOfChunk / resolveProfile:");
  check("persona -> private", scopeOfChunk("persona/PROFILE.md", "persona") === "private");
  check("clinical layer -> clinical", scopeOfChunk("persona_clinical/x.md", "persona-clinical") === "clinical");
  check("wiki -> professional", scopeOfChunk("wiki/PsychBench.md", "wiki") === "professional");
  check("session default -> personal", scopeOfChunk("journal/SomeRepo.md", "session") === "personal");
  // Portable ships with NO etiquette projects by default; the prefix->private
  // routing is asserted against whatever the local config declares (skipped on
  // a fresh install, active the moment the user configures one).
  const etiq = (cfg as any).etiquettePersonalProjects?.() ?? [];
  if (etiq.length) {
    check("personal-project journal -> private (etiquette prefix)", scopeOfChunk(`journal/${etiq[0]}.md`, "session") === "private");
    check("personal-project card -> private (etiquette prefix)", scopeOfChunk(`cards/${etiq[0]}.md`, "card") === "private");
  } else {
    console.log("  skip  etiquette-prefix checks (no etiquettePersonalProjects configured)");
  }
  check("unknown layer fail-closed -> personal", scopeOfChunk("weird/x.md", "no-such-layer") === "personal");
  check("scopeRank order", scopeRank("clinical") < scopeRank("private") && scopeRank("private") < scopeRank("personal")
    && scopeRank("personal") < scopeRank("professional") && scopeRank("professional") < scopeRank("public"));
  check("scopeRank unknown -> personal", scopeRank("bogus") === scopeRank("personal") && scopeRank(null) === scopeRank("personal"));

  check("resolveProfile default -> full", resolveProfile("C:\\some\\RandomRepo").name === "full");
  process.env.LKHS_PROFILE = "work";
  check("resolveProfile env override -> work", resolveProfile("C:\\some\\RandomRepo").name === "work");
  process.env.LKHS_PROFILE = "no-such-profile";
  check("resolveProfile unknown env falls through -> full", resolveProfile("C:\\x").name === "full");
  delete process.env.LKHS_PROFILE;

  // ---- scratch store --------------------------------------------------------
  const vec = (seed: number) => Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : seed * 1e-4)); // near-identical: all rows retrievable
  const chunkFiles: Array<[string, string]> = [
    ["persona/PROFILE.md", "identity passage about the user"],           // private
    ["journal/Claude_Personal_Conv.md", "late night personal talk"],     // private (etiquette)
    ["journal/WorkRepo.md", "session notes on the eval pipeline"],       // personal
    ["wiki/PsychBench.md", "research notes on demographic bias"],        // professional
    ["skills/audio-overview", "audio overview skill description"],       // public
  ];
  chunkFiles.forEach(([file, text], i) =>
    upsertFile(file, `hash-${i}`, [{ text, hash: `c-${i}`, chunkIndex: 0, vector: vec(i + 1) }]));

  const factRow = (key: string, statement: string, extra: Partial<import("./store").FactRow>) => ({
    key, facet: "biography", statement, stmt_hash: `sh-${key}`, ...extra,
  }) as import("./store").FactRow;
  upsertFact(factRow("f-priv", "relationship detail fact", { scope: "private" }), vec(10));
  upsertFact(factRow("f-prof", "research identity fact", { scope: "professional" }), vec(11));
  upsertFact(factRow("f-null", "untagged fact defaults to personal", {}), vec(12));
  upsertFact(factRow("f-clin", "clinical fact with public scope label", { scope: "public", sensitivity: "clinical" }), vec(13));
  // supersession forwarding: stale professional fact superseded by a PRIVATE current fact
  upsertFact(factRow("f-stale", "old job fact", { scope: "professional", invalid_at: "2025-01-01" }), vec(14));
  upsertFact(factRow("f-cur", "current private successor fact", { scope: "private", supersedes: JSON.stringify(["f-stale"]) }), vec(15));

  const q = vec(1);
  const CEIL_PROF = scopeRank("professional");
  const CEIL_PRIV = scopeRank("private");

  // ---- chunk paths ----------------------------------------------------------
  console.log("knn / lexicalKnn ceilings:");
  const all = knn(q, 10);
  check("no ceiling -> all 5 chunk files", all.length === 5, `got ${all.length}`);
  const prof = knn(q, 10, { ceiling: CEIL_PROF });
  const profFiles = new Set(prof.map(h => h.file));
  check("professional ceiling keeps wiki+skill only",
    profFiles.has("wiki/PsychBench.md") && profFiles.has("skills/audio-overview") && prof.length === 2,
    [...profFiles].join(","));
  const priv = knn(q, 10, { ceiling: CEIL_PRIV });
  check("private ceiling (full profile) -> all 5", priv.length === 5, `got ${priv.length}`);

  const lexAll = lexicalKnn("research eval pipeline demographic bias personal talk identity", 10, {}, q);
  const lexProf = lexicalKnn("research eval pipeline demographic bias personal talk identity", 10, { ceiling: CEIL_PROF }, q);
  check("lexicalKnn honors ceiling (subset, no private/personal files)",
    lexProf.every(h => ["wiki/PsychBench.md", "skills/audio-overview"].includes(h.file)) && lexProf.length <= lexAll.length,
    lexProf.map(h => h.file).join(","));

  // ---- fact paths -----------------------------------------------------------
  console.log("factKnn / lexicalFactKnn ceilings:");
  const fAll = factKnn(q, 10);
  const fAllKeys = new Set(fAll.map(f => f.key));
  check("no ceiling -> clinical still quarantined", !fAllKeys.has("f-clin"));
  check("no ceiling -> valid facts present", fAllKeys.has("f-priv") && fAllKeys.has("f-prof") && fAllKeys.has("f-null") && fAllKeys.has("f-cur"));

  const fProf = factKnn(q, 10, { ceiling: CEIL_PROF });
  const fProfKeys = new Set(fProf.map(f => f.key));
  check("professional ceiling -> only f-prof", fProfKeys.has("f-prof") && fProfKeys.size === 1, [...fProfKeys].join(","));
  check("clinical scope label cannot leak (belt and braces)", !fProfKeys.has("f-clin"));
  check("private successor NOT forwarded under professional ceiling", !fProfKeys.has("f-cur"));

  const fPriv = factKnn(q, 10, { ceiling: CEIL_PRIV });
  const fPrivKeys = new Set(fPriv.map(f => f.key));
  check("private ceiling -> all non-clinical valid facts", fPrivKeys.has("f-priv") && fPrivKeys.has("f-prof") && fPrivKeys.has("f-null") && fPrivKeys.has("f-cur"));

  const lfProf = lexicalFactKnn("relationship research identity untagged successor fact", 10, { ceiling: CEIL_PROF }, q);
  check("lexicalFactKnn honors ceiling", lfProf.every(f => f.key === "f-prof"), lfProf.map(f => f.key).join(","));

  const clinInc = factKnn(q, 10, { includeClinical: true, ceiling: CEIL_PROF });
  check("even includeClinical + ceiling blocks clinical (rank 0 < ceiling)", !clinInc.some(f => f.key === "f-clin"));

  store.close();
  try { fs.unlinkSync(SCRATCH); } catch { /* */ }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
