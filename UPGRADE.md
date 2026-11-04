# Upgrading an existing Claude Mind install

This is the runbook for a vault that is **already set up and holding data**. If
you are installing for the first time, use `SETUP.md` instead.

It is written to be handed to Claude Code. Open Claude Code in the vault folder
and say:

> Read UPGRADE.md and upgrade this install. Run the doctor afterwards and fix
> anything it reports.

---

## The one-liner

```bash
npm run upgrade
```

Preview it first without changing anything:

```bash
npm run upgrade -- --dry
```

---

## Why this is safe

Everything the system generates about you is **untracked by git**. The upgrade
pulls new engine code and cannot touch your content, because git does not know
your content exists. Specifically untracked, and therefore untouched:

| Your data | Where |
|---|---|
| The vector store | `.claude/memory/vector_store.db` |
| Session journals and library digests | `journal/`, `library/` |
| Project cards, theme cards, the graph | `cards/`, `themes/`, `graph/`, `HOME.md` |
| Your profile and the deep persona layer | `.claude/memory/core_profile.json`, `persona/` |
| Your config and setup answers | `.claude/lkhs.config.json`, `answers.json` |
| Your notes | everything you put in `wiki/` and `raw/` |
| v2 runtime state | hygiene, miner, recalibration and report artifacts |

Three tracked files are rewritten by the running system, which is what makes a
plain `git pull` conflict on a live vault. `npm run upgrade` handles all three:

- `.claude/memory/MEMORY.md` — your routing index. **Backed up and restored.**
- `VAULT-INDEX.md` — your compiled namespace map. **Backed up and restored.**
- `CLAUDE.md` — the operating manual that ships with the engine. **Replaced**
  with the new version; your old copy is kept in the backup folder.

Everything is copied to `.claude/backups/upgrade-<timestamp>/` before anything
moves, and the script prints that path when it finishes.

---

## Installs that are not a plain clone

The script handles all three states an install can be in, with no flags:

| State | How it got there | What the upgrade does |
|---|---|---|
| clone | `git clone` of this repo | fast-forward |
| diverged | a private copy of the engine, or `origin` pointed at your own repo | adopts this repo |
| unpacked | copied out of a zip, no `.git` folder | `git init`, then adopts this repo |

**Adopting** backs up every local file that differs from this repo into
`.claude/backups/upgrade-<timestamp>/engine/`, points the folder at
`origin/main`, and checks out the current engine. Git never touches untracked
files, and all your data is untracked, so it stays exactly where it is. If
`origin` pointed somewhere else, that URL is kept as the `previous-origin`
remote rather than discarded. From then on the install is a normal clone and
later upgrades are fast-forwards.

Git has to be installed for this (https://git-scm.com). To upgrade from a
different repo: `npm run upgrade -- --remote <url>`.

---

## Plan budget (Pro vs Max)

Background work (session capture, the nightly refresh, ingest, wiki compiles)
calls `claude -p` on your subscription. On a Pro plan that needs a cap:

```bash
npm run upgrade -- --plan pro    # 30 background calls a day, 12 kept for capture, 2 workers
npm run upgrade -- --plan max    # no cap
```

This writes `llmBudget` into `.claude/lkhs.config.json`. An install whose old
engine capped by default keeps its cap automatically. `npm run budget` shows
today's usage.

---

## What it does, in order

1. **Preconditions**: confirms this is a Claude Mind vault and that git exists.
2. **Remote**: points `origin` at this repo (keeping any other URL as
   `previous-origin`), checks it is reachable, fetches.
3. **Plan**: fast-forward if the local history is contained in upstream,
   otherwise adopt.
4. **Backup**: the three mutable files, your config and profile, and in adopt
   mode every engine file that differs from upstream.
5. **Update**: fast-forward, or reset to upstream and check out its files. In
   fast-forward mode a local edit to a tracked file stops the run instead of
   being discarded.
6. **Restore**: puts your `MEMORY.md` and `VAULT-INDEX.md` back.
7. **Config**: rewrites dated model ids (`claude-sonnet-4-6`) to aliases
   (`sonnet`) so they track the newest model, and applies `--plan`.
8. **Dependencies and rewiring**: `npm install`, plus `npm rebuild` if your
   Node major version changed (the native modules are compiled per Node ABI).
   Then re-installs the global hooks, re-registers the MCP server, and
   re-registers the background jobs (launchd on macOS, Task Scheduler on
   Windows), whose entries embed absolute paths.
9. **Verify**: runs `npm run doctor` and reports.

---

## After the upgrade

Bring the data up to the new engine. This is resumable and prints its plan
before doing anything:

```bash
node scripts/migrate-vault.mjs           # show the plan
node scripts/migrate-vault.mjs --apply   # run it
```

Do **not** run `npm run reindex` as part of an upgrade. The embedding model,
dimension and contextual prefix have not changed, so every stored vector is
still valid; reindexing a large vault is hours of compute for nothing.
`UPGRADING-AN-EXISTING-VAULT.md` has the reasoning.

If a new module appeared that you want on (the voice loop, weekly reports,
evals), see the module section of `SETUP.md`. The config keys are additive and
anything unconfigured stays dormant.

---

## If something breaks

`docs/verify-and-fix.md` is the symptom → cause → fix matrix, and
`npm run doctor` prints a specific FIX line for every failure it finds. The
intended loop is: run doctor, apply the fixes it names, run it again.

To get back to exactly where you were, everything from before the upgrade is in
`.claude/backups/upgrade-<timestamp>/`.
