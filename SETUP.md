# SETUP — first-run install (read this if you are Claude Code)

You are Claude Code, opened in a freshly cloned Claude Mind vault. Your job is to set
up a personal, always-on memory brain for the person whose machine this is (macOS,
Windows, or Linux — platform-specific bits are called out where they differ). Work WITH them:
ask the questions in Step 1 conversationally, confirm before destructive or
outward-facing steps, and explain what each step does in plain language. Do not dump
this file at them. No em dashes in anything you write.

This was built on Windows and ported to macOS. The target here is macOS with the Max
subscription and the `claude` CLI signed in. Everything runs locally; no API keys.

If `.claude/memory/core_profile.json` already exists and is filled in, setup has
already run — skip to "Verify" and report status instead of re-installing.

---

## Step 0 — Bootstrap (deterministic)

In the Terminal, from the vault folder:

```bash
bash setup.sh
```

This runs preflight checks and `npm install` (compiles native deps for this Mac;
takes a few minutes). If preflight fails, fix the ✗ items it prints (usually:
install Claude Code, sign in; or `xcode-select --install`) and re-run. You may run
these yourself with the Bash tool instead of asking the user to.

---

## Step 1 — Interview, then write `answers.json`

Ask the user, in a natural back-and-forth (not a form):

- Their name (what they want to be called), and optionally legal name, age, where they live.
- What they do: profession/role, fields of interest, areas of expertise.
- How they want Claude to talk to them (tone, prose vs bullets, anything to avoid).
- **Which folders hold their work** — the directories to ingest as projects. Ask for
  absolute paths (e.g. `/Users/<them>/Documents`, `/Users/<them>/Projects`,
  `/Users/<them>/Desktop/Work`). These become `ingestRoots`. You may `ls ~` and
  suggest likely candidates, but confirm each with them.
- Any current goals/objectives and active projects worth tracking (optional).
- Anywhere that should NOT be captured (sensitive client folders → `exclude`).

Write their answers to `answers.json` in the vault root using this shape (omit what
they didn't give):

```json
{
  "user": {
    "handle": "kath", "email": "", "display_name": "Kath", "legal_name": "",
    "age": 0, "nationality": "", "location_current": "Sydney",
    "education": ["..."], "core_interests": ["..."], "expertise_areas": ["..."],
    "tone": "warm, plain, direct", "formatting": "prose, light bullets",
    "communication_preferences": ["no jargon", "explain tradeoffs"],
    "writing_voice": "..."
  },
  "objectives": { "key": { "title": "", "target": "", "status": "", "deadline": "YYYY-MM-DD" } },
  "projects":   { "key": { "focus": "", "status": "", "started": "YYYY-MM-DD", "github": "" } },
  "domains": [],
  "ingestRoots": ["/Users/<them>/Documents", "/Users/<them>/Projects"],
  "exclude": [],
  "summaryModel": "claude-sonnet-4-6"
}
```

Validate every path in `ingestRoots` exists (`ls` each) before continuing.

### Modules (ask, then write `.claude/lkhs.config.json` in the vault)

The memory core is always on. Ask which optional modules they want and write a
repo-local `.claude/lkhs.config.json` (see `.claude/lkhs.config.example.json`
for every key and its documentation):

- **Privacy profiles** (recommend ON — ships on by default): sessions can run
  under a `work` or `public` profile that cannot retrieve private/personal
  memory. Ask: "any project folders where sessions should be treated as
  personal?" -> `etiquettePersonalProjects`. "Any folders where Claude should
  only see professional memory?" -> add those folder names to the `work`
  profile's `pin_cwds`.
- **Voice loop** (needs a Mimesis-style voice system installed separately):
  if they have one, set `mimesisProfilesRoot` to its profiles/ dir; the
  nightly miner and weekly recalibration activate automatically. Otherwise
  omit the key — everything voice-related stays dormant.
- **Weekly report** (default ON): a Sunday rollup of their week from the
  session ledger. `"reports": { "weekly": false }` opts out.
- **Evals** (grow with use): the leak-probe set and the memory question set
  are per-user data. Scaffold a starter probe set now from their answers —
  see `docs/evals.md` — or skip; the nightly steps skip cleanly until the
  files exist.

---

## Step 2 — Install the wiring (deterministic)

```bash
node scripts/finalize-setup.mjs --answers answers.json
```

This runs four steps in order and stops on any failure:
1. **write-config** → `.claude/memory/core_profile.json` + global `~/.claude/lkhs-capture-config.json`.
2. **install-global-hooks** → copies the capture/retrieval hooks into `~/.claude/hooks/`
   and wires them into `~/.claude/settings.json` (backed up first; existing hooks preserved).
   Now memory captures and retrieval fire in EVERY project, not just this folder.
3. **register-mcp** → registers the `lkhs-memory` MCP server at user scope.
4. **install-launchd** → macOS only: loads four LaunchAgents: keepalive `daemon` +
   `watcher`, hourly `sweep`, daily `dream`. On Windows/Linux this step no-ops —
   register the equivalent scheduled jobs per the **Persistence** section below.

Confirm: `launchctl list | grep claudemind` (4 jobs) and `claude mcp list` (lists
`lkhs-memory`). **Keep `answers.json`** (it is local and gitignored). It lets the user
re-run `node scripts/finalize-setup.mjs --answers answers.json` in one command if they
ever move the folder, repair the install, or upgrade — see "Persistence" below.

---

## Step 3 — Ingest her files and projects

```bash
npm run ingest:dirs
```

Walks each `ingestRoot`, treats each immediate subfolder as a project, and writes a
digest + embeddings into `library/`. This is the "map out all her work" pass and can
take a while on large trees (it summarizes via the `claude` CLI). Watch the output;
re-run anytime to pick up new projects (it is incremental / hash-skipped).

---

## Step 4 — Ingest their chat history (the persona layer, ANY provider)

The persona synthesizes from their AI conversation history. It accepts exports
from **Claude, ChatGPT, Gemini, or any transcript folder** via the universal
importer; ask which assistants they have used and gather every export they want
included:

- **Claude**: claude.ai → Settings → Privacy → Export data (emailed zip; unzip to a
  folder with `conversations.json` and maybe `projects/`).
- **ChatGPT**: chatgpt.com → Settings → Data controls → Export (zip contains
  `conversations.json` in OpenAI's format).
- **Gemini / anything else**: Google Takeout JSON, or a folder of .md/.txt
  transcripts (files with `User:` / `Assistant:` speaker lines split into turns).

Normalize each export (the importer auto-detects the format; `--append` merges
several providers into one corpus), then extract:

```bash
npm run import:chats -- /path/to/claude-export
npm run import:chats -- /path/to/chatgpt-export --out /path/to/claude-export --append
npm run persona:extract -- /path/to/claude-export/normalized
```

A pure-Claude export can also skip the normalizer and run persona:extract on the
export folder directly (same result). If the Claude export has a `projects/`
folder, copy it into the `normalized/` dir before extracting so project docs are
included.

This produces conversation batches in `.claude/memory/persona_raw/`. Now do the
**synthesis** step: follow `docs/persona-synthesis.md` exactly — read the batches,
produce `merged-facets.json` and `persona-docs.json` to its schemas (use the Workflow
or Agent tools, one extractor per batch, then merge), then:

```bash
npm run persona:facts -- merged-facets.json
npx tsx .claude/bin/persona-write-docs.ts persona-docs.json
```

Health/medication/crisis material is auto-quarantined to `persona_clinical/` and is
never injected or shown. The whole persona layer is gitignored and stays local. If the
user would rather not synthesize their chat history, skip this step; the file/project
memory works without it.

---

## Step 5 — Build the indexes

```bash
npm run embed      # full local re-embed of everything ingested
npm run graph      # knowledge graph + interactive graph.html
npm run cards      # L2 project-state cards
npm run themes     # L3 theme cards
npm run moc        # Obsidian HOME map
```

---

## Verify (and fix anything that isn't working)

Run the diagnostic, fix every failure it reports, repeat until clean:

```bash
npm run doctor            # checks every component; prints the exact FIX for each ✗
# ...apply each FIX line, then re-run until it prints "0 failed"...
npm run doctor -- --deep  # adds the real embed -> query -> retrieve round-trip
```

Then run the functional tests and follow the full failure matrix in
**`docs/verify-and-fix.md`** — that doc is written for you to self-heal the install.
Do not tell the user it works until `doctor` is green and the round-trip passes.

Finally: the console is `npm run web` → http://127.0.0.1:7099 (or double-click
`launch.command`). Have the user quit and reopen Claude Code once so the hooks load;
on the next session the LKHS context block should appear and the `lkhs-memory` MCP
tools should be callable from any project.

## Persistence — set up once, then it runs itself

**macOS**: `npm run install:launchd` (done in Step 2) loads the four LaunchAgents.

**Windows**: launchd does not exist; register the equivalent Task Scheduler jobs
yourself (run these from the vault folder, substituting the absolute vault path;
confirm with the user first since they modify system scheduling):

```powershell
$V = (Get-Location).Path; $N = (Get-Command node).Source
schtasks /Create /TN "ClaudeMind-Daemon"  /SC ONLOGON /TR "`"$N`" --import tsx `"$V\.claude\bin\lkhs-daemon.ts`"" /F
schtasks /Create /TN "ClaudeMind-Watcher" /SC ONLOGON /TR "`"$N`" --import tsx `"$V\.claude\bin\ambient-watcher.ts`"" /F
schtasks /Create /TN "ClaudeMind-Sweep"   /SC HOURLY  /TR "`"$N`" --import tsx `"$V\.claude\bin\capture-sweep.ts`"" /F
schtasks /Create /TN "ClaudeMind-Refresh" /SC DAILY /ST 04:00 /TR "`"$N`" `"$V\scripts\refresh.mjs`"" /F
```

(Each task should also set the working directory to the vault; if `schtasks` quoting
fights you, create the four tasks in the Task Scheduler UI instead — same commands.)

**Linux**: cron or systemd user timers with the same four commands.

After this one install, the user does NOTHING to keep it working:

- The scheduled jobs auto-start at login and survive reboot; on macOS the daemon and
  watcher auto-restart if they ever crash (KeepAlive). The hourly sweep and nightly
  refresh run on their own.
- The hooks and the MCP registration live in `~/.claude/` and persist across Claude
  Code updates.
- Background summaries run on the Claude subscription via the `claude` CLI; the dollar
  budget cap is set to `off` in the jobs, so nothing silently stops.
- It only grows: every session is captured, every changed file re-embedded.

The few times anything is needed (all rare, all one-liners):

- **Moved the folder?** Re-run `node scripts/finalize-setup.mjs --answers answers.json`
  from the new location (relinks launchd + config to the new path). So pick the final
  location BEFORE setup — `~/ClaudeMind` is a good home; don't move it casually.
- **Upgraded Node to a new major version?** `npm rebuild` (recompiles native modules).
- **Want it gone?** `npm run uninstall` removes the jobs/hooks/MCP; then delete the folder.

## Done

Tell the user, plainly: it is installed and always-on; it grows by itself as they use
Claude Code; the console is at http://127.0.0.1:7099; and they don't need to touch it
again. Point them at `README.md` for day-to-day use.
