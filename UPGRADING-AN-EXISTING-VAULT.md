# Upgrading a vault that already has memories in it

For an install that has been running for a while and has real ingested work in it. If you
are installing fresh, ignore this file and read `SETUP.md`.

## The short version

Open Claude Code in your Claude Mind folder and say:

> **upgrade this vault**

It will pull the new code, back up your store, and migrate. You do not need to read the
rest of this.

## What is actually safe, and why

Everything you have built lives in paths that git does not track: `.claude/memory/`
(the store, your profile, your facts), `journal/`, `cards/`, `themes/`, `library/`,
`persona/`. Pulling new code therefore cannot touch any of it. The upgrade replaces
engine files and documentation, nothing else.

**Your embeddings stay valid.** The embedding model is the same (bge-small), the vector
dimension is the same (384), and the contextual prefix each chunk is embedded with is
byte-identical between versions. A vector computed months ago is the vector this code
would compute today, so there is no reason to recompute it — and every reason not to, on
a vault with tens of thousands of chunks.

**Your database migrates in place.** The store adds the columns and tables the newer
engine needs the first time it opens the file. That migration is additive, nullable and
idempotent, and it was verified against a database actually built by the older engine:
the rows survive, retrieval keeps working, and running it twice changes nothing the
second time.

## What gets redone, and what does not

`node scripts/migrate-vault.mjs` prints the plan before it runs anything. It is
conditional on what your vault actually contains, so a vault with no persona layer is
never told to re-tag facts it does not have.

| | cost | why |
|---|---|---|
| backup | free | Timestamped copy of the store, facts and profile before anything writes |
| schema | free | Add the new columns and tables; existing rows untouched |
| capture sweep | model | Summarize sessions that happened but were never captured |
| skill index | local | New router; nothing to route to until it is built |
| facts embed | local | Old schema had no fact vector table, so existing facts are unretrievable until embedded |
| scope tagging | free | Without it every fact defaults to `personal` and profile filtering cannot work |
| graph | local | Format changed substantially; the old graph file cannot be read |
| journals | local | **The only re-embed.** Journal chunks gain a date stamp so recency-aware retrieval can tell an old session from a recent one |
| cards / themes | model | Their prompts and schema improved |
| state, moc | local | TODAY.md digest and the browsable map |
| lessons | model | Optional. The new capability: mines what tends to go wrong from your own past sessions |

**Do not run `npm run reindex` as part of an upgrade.** It re-embeds every chunk in the
vault. On an established install that is hours of compute to reproduce vectors that are
still correct. The migration re-embeds journals only, which is a small fraction of the
corpus and is the one thing that genuinely changed.

## If something goes wrong

The migration is resumable. Completed steps are recorded, so re-running skips them and
picks up where it stopped. A single step can be retried on its own:

```bash
node scripts/migrate-vault.mjs --apply --only graph
```

The vault is only stamped as migrated once every required step has actually completed, so
a partial run cannot masquerade as a finished one.

To roll back entirely: stop the daemon, then copy the timestamped file out of
`.claude/memory/backups/` over `.claude/memory/vector_store.db`. The backup step prints
the exact filename when it runs.

## Verify

```bash
npm run doctor
```

Fix anything it flags — it prints the exact command for each failure — and re-run until
it is clean.
