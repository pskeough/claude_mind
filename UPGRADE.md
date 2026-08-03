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

## What it does, in order

1. **Preconditions** — confirms this is a Claude Mind vault and a git clone.
2. **Remote** — reports `origin` and checks it is reachable.
3. **Backup** — copies the three mutable files plus your config.
4. **Clean tree** — resets only those three. Any *other* local edit to a
   tracked file stops the run rather than being silently discarded.
5. **Pull** — fast-forward only.
6. **Restore** — puts your `MEMORY.md` and `VAULT-INDEX.md` back.
7. **Dependencies and rewiring** — `npm install`, plus `npm rebuild` if your
   Node major version changed since the last run (the native modules
   `better-sqlite3` and `onnxruntime` are compiled per machine and per Node
   ABI). Then re-installs the global hooks, re-registers the MCP server, and on
   macOS rewrites the launchd jobs, whose plists embed an absolute path to
   `node` and so must be regenerated whenever Node moves.
8. **Verify** — runs `npm run doctor` and reports.

---

## If `origin` is missing, dead, or points somewhere old

Early installs were delivered before the public repo existed, so an old vault
may have no `origin`, or one pointing at a repo that no longer resolves. The
script will not guess: if `origin` is unreachable it stops and tells you to
re-run with the current repo.

```bash
npm run upgrade -- --remote https://github.com/pskeough/claude_mind.git
```

That repoints `origin` and continues. Your data is untracked, so changing the
remote does not put any of it at risk.

If the vault turns out not to be a git clone at all, the upgrade cannot run.
Clone the repo fresh into a new folder and copy your untracked data across
(`.claude/memory/`, `journal/`, `library/`, `cards/`, `themes/`, `graph/`,
`persona/`, `wiki/`, `raw/`, `answers.json`), then run
`node scripts/finalize-setup.mjs --answers answers.json` in the new folder.

---

## After the upgrade

`npm run doctor` runs automatically at the end. If it is green, you are done.

Two things worth doing when the upgrade spans a lot of versions:

```bash
npm run reindex     # re-embed everything (needed if the chunker changed)
npm run dream       # rebuild cards, themes, graph and the map of content
```

Neither is destructive; both are rebuilds from data you already have. `reindex`
on a large vault takes a while and is CPU-bound, so run it when you do not need
the machine.

If a new module appeared that you want on (the voice loop, weekly reports,
evals), see the module section of `SETUP.md` — the config keys are additive and
anything unconfigured stays dormant.

---

## If something breaks

`docs/verify-and-fix.md` is the symptom → cause → fix matrix, and
`npm run doctor` prints a specific FIX line for every failure it finds. The
intended loop is: run doctor, apply the fixes it names, run it again.

To get back to exactly where you were, everything from before the upgrade is in
`.claude/backups/upgrade-<timestamp>/`.
