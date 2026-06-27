# SETUP — first-run install (read this if you are Claude Code)

You are Claude Code, opened in a freshly cloned Claude Mind vault. Your job is to set
up a personal, always-on memory brain for the person whose Mac this is. Work WITH them:
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
4. **install-launchd** → loads four LaunchAgents: keepalive `daemon` + `watcher`,
   hourly `sweep`, daily `dream`. The brain is now always-on and survives reboot.

Confirm: `launchctl list | grep claudemind` (4 jobs) and `claude mcp list` (lists
`lkhs-memory`). Then delete `answers.json` (it duplicated the profile).

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

## Step 4 — Ingest her Claude chat history (the persona layer)

First have the user export their Claude data: **claude.ai → Settings → Privacy →
Export data**. They get an email with a zip; unzip it to a folder containing
`conversations.json` (and maybe `projects/`). Get that folder's path, then:

```bash
npm run persona:extract -- /path/to/export
```

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

## Verify

```bash
npm run status     # brain-health dashboard
npm run smoke      # engine round-trip
```

- The daemon (port 7077) and watcher should be running (launchd). The console:
  `npm run web` then open http://127.0.0.1:7099 (or double-click `launch.command`).
- Tell the user to quit and reopen Claude Code so the new hooks load. On the next
  session, the SessionStart context and per-prompt memory injection should appear, and
  the `lkhs-memory` MCP tools should be callable from any project.

## Done

Tell the user, plainly: it is installed and always-on; it grows by itself as they use
Claude Code; the console is at http://127.0.0.1:7099; and to remove everything outside
this folder they can run `npm run uninstall`. Point them at `README.md` for day-to-day use.
