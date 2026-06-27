# Verify & self-heal (read this if you are Claude Code)

Your job: confirm Claude Mind is fully installed and working, and fix anything that is
not, autonomously. You have a Bash tool and this repo. Work the loop below until it is
green, then run the functional tests, then report plainly to the user. macOS target.

## The loop

```
1. npm run doctor
2. For every line marked [✗ FAIL], run the command after "FIX:" (from the vault folder).
   Treat [! WARN] as optional unless the user asked for that part (e.g. persona).
3. Re-run npm run doctor. Repeat until it prints "0 failed".
4. npm run doctor -- --deep        # adds the real embed -> query -> retrieve round-trip
5. Run the functional tests below.
```

`doctor` is diagnostic only; it never changes anything, so it is safe to run as often
as you like. Every FAIL it prints comes with the exact fix. Do not improvise around it
unless a fix command itself errors — then use the matrix below.

## What "fully working" means (functional tests)

After doctor is green:

1. **Retrieval returns real hits:**
   `npm run query "something the user actually worked on"` → expect ranked results,
   not an empty set. (If empty, ingestion hasn't run: `npm run ingest:dirs && npm run embed`.)
2. **The daemon gate works:**
   `curl -s -X POST http://127.0.0.1:PORT/gate -H 'content-type: application/json' -d '{"prompt":"what was I working on"}'`
   (PORT from `~/.claude/lkhs-capture-config.json`, default 7077) → JSON with `inject`/`hits`.
3. **The MCP tools are live:** `claude mcp list` shows `lkhs-memory`. In a NEW Claude
   Code session in any folder, the `lkhs-memory` tools (search_memory, user_profile,
   etc.) should be callable.
4. **Hooks fire:** tell the user to quit and reopen Claude Code once (hooks load at
   session start). Confirm the LKHS context block appears at the top of a new session,
   and `.claude/logs/ambient.log` gets a `capture-hook:fired` line after a session ends.
5. **It survives a reboot (optional but ideal):** after a restart, `launchctl list |
   grep claudemind` still shows the 4 jobs and the daemon answers `/health`.

Report each as pass/fail with the evidence. Don't claim it works if a test didn't run.

## Failure matrix

| Symptom | Cause | Fix |
|---|---|---|
| `npm install` fails building **better-sqlite3 / onnxruntime** | Xcode Command Line Tools missing | `xcode-select --install`, accept the dialog, then `npm install` again |
| Native dep error like `NODE_MODULE_VERSION mismatch` or `invalid ELF/Mach-O` | node_modules built for a different Node | `npm rebuild` (or delete `node_modules` and `npm install`) |
| doctor: **dependencies missing** | `npm install` never finished | `npm install` from the vault folder |
| doctor: **profile missing** / **global config** wrong vault | setup not run, or run from the wrong folder | from THIS folder: `node scripts/finalize-setup.mjs --answers answers.json` (recreate `answers.json` from the SETUP.md schema if it was deleted) |
| doctor: **global hooks** not wired | hook install skipped | `npm run install:hooks` |
| doctor: **MCP server** not registered | registration skipped, or `claude` wasn't on PATH at setup | `npm run install:mcp`, then `claude mcp list` to confirm |
| doctor: **launchd jobs** missing | jobs not loaded | `npm run install:launchd`, then `launchctl list | grep claudemind` |
| doctor: **retrieval daemon** no response | daemon not running / port busy | macOS: `npm run install:launchd` (re-loads keepalive). Manual start: `npm run serve`. Port busy: `lsof -i :7077` to find the other process, or change `daemonPort` in `~/.claude/lkhs-capture-config.json` and re-run `npm run install:launchd` |
| Hooks don't fire in new sessions | `node` not on the PATH Claude Code uses, or settings not picked up | confirm `which node`; check `~/.claude/settings.json` has the three LKHS entries (re-run `npm run install:hooks`); fully quit and reopen Claude Code |
| `launch.command` won't open (Gatekeeper "unidentified developer") | macOS quarantine on a double-clicked script | right-click → Open once, or `xattr -d com.apple.quarantine launch.command`, or just run `bash launch.command` |
| Background summaries / captures produce nothing | the `claude` CLI isn't found by launchd, or not signed in | confirm `claude --version` works in Terminal and you're signed in; `npm run install:launchd` re-bakes the real `claude` path into the jobs; check `.claude/logs/launchd.*.err.log` |
| `claude -p` under a launchd job can't authenticate | OAuth token not reachable from the background job | run `claude` once interactively to refresh login; the sweep/dream use the same credentials as your normal CLI |
| Console at :7099 won't load | web server not started | `npm run web` (or `launch.command`); check the port with `lsof -i :7099` |
| Retrieval returns nothing for real queries | nothing ingested yet | `npm run ingest:dirs` then `npm run embed`; large folders take a while |
| Everything green but you moved the folder | absolute paths in launchd + global config went stale | from the new location: `node scripts/finalize-setup.mjs --answers answers.json` |

## Logs to read when stuck

- `.claude/logs/ambient.log` — watcher embeds, compiles, and `capture-hook:fired` audit lines.
- `.claude/logs/launchd.<job>.out.log` / `.err.log` — stdout/stderr of each background job.
- `npm run status` — store contents, layer counts, service liveness, freshness.

## When it's done

Tell the user, plainly, what passed and that it is now self-maintaining: it starts at
login, restarts itself if it crashes, captures every session, and consolidates nightly,
with no further action from them. If something is only partially set up (e.g. they
skipped the persona/chat step), say exactly what is and isn't on, and how to finish it.
