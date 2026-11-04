#!/usr/bin/env node
/**
 * The falsifier for the run-python capability, as an executable.
 *
 * Asserts the thing that actually breaks: a Python snippet printing an accented
 * character, an em dash and a CJK character must round-trip through stdout intact. On a
 * host where stdout is not reconfigured to UTF-8 this raises UnicodeEncodeError or
 * emits mojibake, which is the failure recorded in 44 separate sessions.
 *
 * Exits 0 only if all three survive. Deliberately not `true` and not an existence check:
 * a test that cannot fail certifies nothing, and the ledger rejects those at write time.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "run-python.mjs");

// Built from code points so this file's own encoding cannot mask an encoding bug.
const ACCENT = String.fromCharCode(233);      // é
const EMDASH = String.fromCharCode(8212);     // —
const CJK = String.fromCharCode(26085);       // 日

const r = spawnSync(process.execPath, [runner, "-c", `print(chr(233) + chr(8212) + chr(26085))`], {
  encoding: "utf8", shell: false,
});

if (r.status !== 0) {
  console.error(`run-python exited ${r.status}: ${(r.stderr || "").trim().slice(0, 200)}`);
  process.exit(1);
}
const out = String(r.stdout || "");
const missing = [["accented", ACCENT], ["em dash", EMDASH], ["CJK", CJK]].filter(([, ch]) => !out.includes(ch));
if (missing.length) {
  console.error(`lost ${missing.map(m => m[0]).join(", ")} in stdout; got ${JSON.stringify(out.slice(0, 80))}`);
  process.exit(1);
}

// Exit codes must propagate, or a failing script would look like a passing one.
const codeCheck = spawnSync(process.execPath, [runner, "-c", "import sys; sys.exit(7)"], { encoding: "utf8", shell: false });
if (codeCheck.status !== 7) {
  console.error(`exit code not propagated: expected 7, got ${codeCheck.status}`);
  process.exit(1);
}

console.log("run-python: unicode round-trip and exit-code propagation both OK");
