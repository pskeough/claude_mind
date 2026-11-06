# extras

Optional Claude Code add-ons that pair with Claude Mind. None of it is needed for
the memory system to run.

Install or update them with one command from the Claude Mind folder:

```bash
node extras/install-extras.mjs --groups core,research
node extras/install-extras.mjs --groups voice --mimesis <path to Mimesis>
```

It copies into `~/.claude/` and touches only the names below. A copy you already
have that differs is moved to `~/.claude/backups/extras-<time>/` first. Re-run it
after `npm run upgrade` to pick up new versions. Claude loads a skill only when a
task matches its description, so an unused skill costs nothing.

## core

| | What it is for |
|---|---|
| `master-context` (skill) | catalogs a whole directory of projects into an index Claude can query |
| `swarm` (skill) | parallel multi-agent runs with the Workflow tool |
| `web-researcher` (agent) | a Sonnet subagent for web search; returns every claim with URL, date and a verbatim quote so the main session can check what it uses. Reads pages through the `defuddle` CLI (`npm install -g defuddle`), or WebFetch without it |

## research

| Skill | What it is for |
|---|---|
| `paper-library` | builds a verified, quotation-backed library from a bibliography; catches hallucinated references |
| `openalex-database` | free scholarly API: verify citations, find DOIs, citation networks, literature counts |
| `paper-structure` | claim outline and structural audit of a paper before any prose is written |
| `paper-claim-audit` | audits every empirical claim in a draft against the raw data before submission |
| `paper-forge` | full data-to-draft paper pipeline as two Workflow runs (large; Sonnet by default) |
| `statistical-analysis` | test choice, assumptions, effect sizes, APA reporting, corrections |
| `degenerate-input-filtering` | removes constant, empty and single-item inputs before a test silently breaks |
| `nan-safe-correlation` | correct correlation matrices under missing data |
| `statistical-significance-annotation` | significance brackets and asterisks on plots, with corrected p-values |
| `general-figure-guide` | quality check for a figure before it goes in a paper |
| `shap-model-explainability` | SHAP attributions, explainer choice, plots |
| `eval-methodology-playbook` | LLM-as-judge and evaluation design: rubrics, bias controls, reliability |
| `scientific-slides` | beamer decks for talks, with timing |
| `latex-research-posters` | conference posters in LaTeX |

## voice (only with Mimesis)

The `mimesis` skill routes "in my voice" requests to the voice engine, and `/voice`
shows or switches the active voice. The skill ships in the Mimesis repo
(`claude/skills/mimesis`) so it updates with the engine; the installer copies it
from there and writes your Mimesis path into `/voice`.

## wellbeing

`mind-companion`: mood and pacing conversations backed by a bundled clinical-psychology KB, paired with the usage-rhythm module. Install with `npm run install:wellbeing`, not here directly; see `docs/rhythm.md`.

## Also here

- `global-CLAUDE.md`: a starter for `~/.claude/CLAUDE.md`. Merge the sections you
  want into your own file by hand; do not overwrite it.
- `PLUGINS.md`: optional plugins and settings worth knowing about.

The heavy skills (`paper-forge`, `swarm`) default to Sonnet and small runs, so they
suit a Pro plan. On Max you can raise their sizes when you invoke them.
