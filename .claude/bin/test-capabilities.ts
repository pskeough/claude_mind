/**
 * test-capabilities.ts — the write gates must actually reject.
 *
 *   npm run test:cap
 *
 * The gates are the entire value of this tier. If a capability with no test, or with a
 * test that cannot fail, can reach `active`, then the ledger is a folder of scripts with
 * extra ceremony. So each gate is exercised against a case built to slip past it, and the
 * promotion path is checked in both directions: a passing test promotes, a failing test
 * on an active capability demotes it on the same run.
 *
 * Writes to a temp ledger via LKHS_MEM_DIR so the real one is never touched.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cap-test-"));
process.env.LKHS_MEM_DIR = TMP;

let fails = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "OK  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};

async function main() {
  const { upsertCapability, verify, currentCapabilities, activeCapabilities, renderSkills } = await import("./capabilities");
  const base = {
    name: "probe-cap", description: "A probe capability used by the test suite.",
    trigger: "never, this is a test fixture", derived_from: ["sess-1"], source: "test",
  };

  console.log("== write gates ==");
  check("no test is rejected",
    upsertCapability({ ...base, command: "echo hi", test: "", test_asserts: "asserts something real" }) === "rejected");
  check("no test_asserts is rejected",
    upsertCapability({ ...base, command: "echo hi", test: "node -e \"process.exit(0)\"", test_asserts: "" }) === "rejected");
  check("no provenance is rejected",
    upsertCapability({ ...base, derived_from: [], command: "echo hi", test: "node -e \"process.exit(0)\"", test_asserts: "asserts something real" }) === "rejected");
  // The tautological-test gate. This is the one a model actually trips: asked for a test
  // with nothing real to assert, it emits `true` or an echo, which passes forever and
  // certifies nothing.
  for (const t of ["true", "echo ok", "exit 0"])
    check(`tautological test rejected: ${t}`,
      upsertCapability({ ...base, command: "echo hi", test: t, test_asserts: "asserts something real" }) === "rejected");

  console.log("\n== promotion requires a PASSING test ==");
  const ins = upsertCapability({
    ...base, command: "node -e \"console.log(1)\"",
    test: "node -e \"process.exit(0)\"", test_asserts: "The runtime is present and the script parses.",
  });
  check("valid capability inserted", ins === "inserted");
  check("lands proposed, not active", currentCapabilities()[0]?.status === "proposed");
  check("nothing active before verification", activeCapabilities().length === 0);
  check("nothing renders before verification", renderSkills().length === 0);

  const v1 = verify("cap-probe-cap");
  check("passing test promotes to active", v1.ok && activeCapabilities().length === 1, v1.detail);

  console.log("\n== a failing test demotes on the same run ==");
  const upd = upsertCapability({
    ...base, command: "node -e \"console.log(2)\"",     // command CHANGED
    test: "node -e \"process.exit(3)\"", test_asserts: "This one is designed to fail.",
  });
  check("edit is accepted as an update", upd === "updated");
  check("changed command drops back to proposed", currentCapabilities()[0]?.status === "proposed",
    "an edited capability must re-earn promotion");
  const v2 = verify("cap-probe-cap");
  check("failing test does not promote", !v2.ok);
  check("still not active", activeCapabilities().length === 0);

  console.log("\n== an ACTIVE capability that breaks is retired ==");
  upsertCapability({ ...base, command: "node -e \"console.log(3)\"", test: "node -e \"process.exit(0)\"", test_asserts: "Passes so we can then break it." });
  verify("cap-probe-cap");
  check("active again", activeCapabilities().length === 1);
  // test_asserts must clear the 12-char floor. An earlier draft of this fixture used
  // "Now broken." (11 chars), which the gate correctly REJECTED — leaving the previous
  // passing test in place and making the break look unobserved. The gate was right and
  // the fixture was wrong, which is the failure mode this floor exists to catch.
  const brokeUpsert = upsertCapability({ ...base, command: "node -e \"console.log(3)\"", test: "node -e \"process.exit(9)\"", test_asserts: "This capability is now deliberately broken." });
  check("break upsert accepted", brokeUpsert === "updated");
  // Same command, so it stays active until the test is actually run.
  const v3 = verify("cap-probe-cap");
  check("break is observed", !v3.ok);
  check("retired, not silently left active", currentCapabilities().find(c => c.id === "cap-probe-cap")?.status === "retired");

  console.log("\n== ledger discipline ==");
  const raw = fs.readFileSync(path.join(TMP, "capabilities.jsonl"), "utf8").split("\n").filter(Boolean);
  check("append-only (history retained)", raw.length >= 6, `${raw.length} records for 1 capability`);
  check("every record parses", raw.every(l => { try { JSON.parse(l); return true; } catch { return false; } }));

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${fails === 0 ? "ALL CAPABILITY GATE TESTS PASSED" : `${fails} FAILED`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
