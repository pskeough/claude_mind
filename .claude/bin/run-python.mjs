#!/usr/bin/env node
/**
 * run-python.mjs — run a Python snippet on THIS host without hitting the four failures
 * that have cost 100+ sessions between them.
 *
 *   node .claude/bin/run-python.mjs script.py [args...]
 *   node .claude/bin/run-python.mjs -c "print('café')"
 *   echo "print(1)" | node .claude/bin/run-python.mjs -
 *
 * This is a CAPABILITY: the executable form of four advisory lessons that the ledger has
 * observed over and over, and that keep being re-learned because advice delivered before
 * a tool call still has to be remembered while writing the call.
 *
 *   ls-2ed7127b3426 (44 sessions)  stdout must be reconfigured to UTF-8 or non-ASCII dies
 *   ls-febfc4145389 (44 sessions)  -X utf8 on any invocation that reads or prints text
 *   ls-ecead00698f6 (19 sessions)  write to a temp file; never pipe multiline code to -c
 *   ls-ad3c748fe2ff (12 sessions)  `python3` on this host is a Store alias stub, use `python`
 *
 * Each was true and each had to be applied by hand every time. Executing them once here
 * is the difference between a system that tells you what it learned and one that has
 * learned it.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The preamble is prepended to whatever is run. Reconfigure is guarded because it is
// absent on Python < 3.7 and a hard failure there would be worse than the encoding bug.
const PREAMBLE = [
  "import sys",
  "try:",
  "    sys.stdout.reconfigure(encoding='utf-8')",
  "    sys.stderr.reconfigure(encoding='utf-8')",
  "except Exception:",
  "    pass",
  "",
].join("\n");

const argv = process.argv.slice(2);
if (!argv.length) {
  console.error("usage: run-python.mjs <script.py|-c CODE|-> [args...]");
  process.exit(2);
}

let body, passthrough;
if (argv[0] === "-c") {
  body = argv[1] ?? "";
  passthrough = argv.slice(2);
} else if (argv[0] === "-") {
  body = readFileSync(0, "utf8");
  passthrough = argv.slice(1);
} else {
  body = readFileSync(argv[0], "utf8");
  passthrough = argv.slice(1);
}

// Always via a temp FILE, never via -c with multiline content. Escaping through the shell
// is the layer that breaks: a backslash means one thing to bash, another to cmd, and a
// third to Python's string parser, and the failures are silent rather than loud.
const dir = mkdtempSync(join(tmpdir(), "lkhs-py-"));
const file = join(dir, "snippet.py");
writeFileSync(file, PREAMBLE + body, "utf8");

try {
  const r = spawnSync("python", ["-X", "utf8", file, ...passthrough], {
    stdio: "inherit",
    // shell:false. With shell:true a snippet containing <, > or | is mangled by cmd.exe
    // redirection parsing, and the failure is silent: exit 0 with no work done.
    shell: false,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.error) {
    console.error(`run-python: could not start python: ${r.error.message}`);
    process.exit(127);
  }
  process.exit(r.status ?? 1);
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ }
}
