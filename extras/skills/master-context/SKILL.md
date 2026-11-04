---
name: master-context
description: Point Claude at a directory and bulk-build a "Master Context" catalog base for everything in it - one CATALOG.md per project or work, a filterable INDEX.md, and a synthesis layer on top. Use when the user says "build a master context for X", "catalog this whole directory/workspace", "do the master context thing here", "index all my projects in X", "rebuild the catalog", or "add these N new projects to the catalog". Fans out one cheap catalog agent per project via a Workflow (parallel, Sonnet low effort), then one session-model synthesis agent writes INDEX + the portfolio/authorial layer. Also covers adding a single item to an existing base.
---

# Master Context Builder

Bulk-builds a centralized, chattable catalog of every project or work in a target directory. It copies or points only. **Source folders are read-only: never edited, moved, or deleted.**

Default location for a new base: `<Target>\<TargetName>MasterContext\` (for example `D:\Projects\ProjectsMasterContext\`). Ask the user if they want it elsewhere.

## Procedure

### 1. Scout (inline, main loop)

- Enumerate the target directory 1-2 levels deep and identify the real project units. Merge obvious copies and backups (`X - Copy (2)`, `XBACKUP*`, `X_old`) into their parent as provenance; they do not get their own slug.
- Look for a stale prior index (for example `projects_index.md`, old audits). Use it as seed hints only, never as truth.
- Check whether a base already exists at the target (a `*MasterContext\` folder with a `SCHEMA.md`). If yes, this is an **extend/rebuild**: recover the saved workflow script path and `resumeFromRunId` from project memory and resume with an edited `PROJECTS` array. Cached agents replay free. Only build fresh if no base exists.
- If another base exists elsewhere on the machine, read its SCHEMA.md and one CATALOG.md as the live exemplar before writing a new schema.

### 2. Pick the domain preset and write SCHEMA.md

If an existing SCHEMA.md is available, adapt it verbatim and change only the domain vocabulary. Otherwise write SCHEMA.md from the tables below. Never invent a new directory shape: every base must be machine-filterable the same way.

| Preset | Asset copying | Per-item files | Body-section flavor |
|---|---|---|---|
| research | preprints/data/stats/figures copied, cited literature excluded | CATALOG.md + MANIFEST.md + assets/ | Methods, Key Findings (real numbers), Data & Stats |
| writing | canonical version + plain-text extraction copied | CATALOG.md + MANIFEST.md + assets/ | Synopsis, Form & Craft, Themes, Versions Inventory |
| code | none, pointers by path only | CATALOG.md only | Architecture, Entry Points, How to Run, Reuse Candidates |
| generic | decide per corpus, default none | CATALOG.md (+ MANIFEST.md if copying) | adapt from the code preset |

Common invariants for every preset:

- YAML frontmatter with `slug` (lowercase-kebab, stable, the `[[wikilink]]` target), `status` (`active`, `paused`, `done`, `abandoned`, `sandbox`), `one_liner`, `related` (list of slugs), `tags`, `last_updated`, and `sources` (absolute paths of the originals).
- Ten fixed body sections, in this order, ending in `## Related Work in Corpus`, with a `## Provenance` section covering copies, backups and variants.

Default ten sections per preset:

| # | research | writing | code |
|---|---|---|---|
| 1 | Overview | Overview | Overview |
| 2 | Status & Timeline | Status & Timeline | Status & Activity |
| 3 | Research Question | Synopsis | Architecture |
| 4 | Methods | Form & Craft | Entry Points |
| 5 | Key Findings (real numbers) | Themes | How to Run |
| 6 | Data & Stats | Versions Inventory | Dependencies & Config |
| 7 | Outputs & Drafts | Key Passages | Reuse Candidates |
| 8 | Open Threads | Open Threads | Open Threads |
| 9 | Provenance | Provenance | Provenance |
| 10 | Related Work in Corpus | Related Work in Corpus | Related Work in Corpus |

Base layout:

```
<Base>\
  SCHEMA.md            frontmatter fields, section order, preset choice
  INDEX.md             orientation paragraph + one row per item
  <slug>\CATALOG.md    one folder per item
  <slug>\MANIFEST.md   only for copying presets: what was copied, from where, size, date
  <slug>\assets\       only for copying presets
  <synthesis files>    see step 4
  _meta\build_log.md
```

### 3. Build the PROJECTS array

One entry per unit: `{ slug, group, sources: [relative paths], hint }`. Hints carry: what the stale index believed, "NEW since <date>" for unknowns, merge instructions for copies, and cross-corpus links to slugs in other bases.

### 4. Run the Workflow (requires the Workflow tool; invoking this skill is the opt-in)

Template. Adapt paths and preset, keep the shape:

```js
export const meta = { name: '<base>-build', description: '...',
  phases: [{ title: 'Catalog', model: 'sonnet' }, { title: 'Synthesize' }] }
// ROW schema: slug, project, group, projType, status, one_liner, tech/domain
// arrays, related, reuse_candidates|authorial_observations, open_threads
phase('Catalog')
const rows = await parallel(PROJECTS.map(p => () =>
  agent(catalogPrompt(p), { label: 'catalog:' + p.slug, phase: 'Catalog',
    agentType: 'general-purpose', model: 'sonnet', effort: 'low', schema: ROW })))
phase('Synthesize')
const synthSummary = await agent(synthPrompt(rows.filter(Boolean)), {
  label: 'synthesize', phase: 'Synthesize', agentType: 'general-purpose',
  effort: 'high' })  // no model override: inherits the session model
return { count: rows.filter(Boolean).length, synthSummary }
```

- Catalog agents: **Sonnet, effort low**, cheap and parallel (the original used Opus at low effort; switch to `model: 'opus'` on a Max plan). Their prompt must say: read SCHEMA.md first and follow it EXACTLY; sources are READ-ONLY; ground every claim in files actually read; use an honest `status: sandbox` for empty shells; write `<slug>\CATALOG.md` (and MANIFEST.md/assets for copying presets); return the structured row.
- Synthesis agent: **no model override** (inherits the session model). It writes `INDEX.md` (orientation paragraph + one filterable row per project linking to its CATALOG.md), the domain synthesis layer (`PORTFOLIO.md` + `REUSE_MAP.md` for code; `authorial\PROFILE.md` + `STYLE_NOTES.md` + `INCONSISTENCY_REPORT.md` for research and writing), and `_meta\build_log.md`.
- Load the built-in `workflow-authoring` skill for the script API before writing the script.

### 5. Close the loop (do not skip)

1. Spot-check output: the base root has SCHEMA.md and INDEX.md plus one folder per slug. Open 2-3 CATALOG.md files and verify frontmatter and section order match SCHEMA.md.
2. **Save a project memory note** (auto-memory or the project's CLAUDE.md) recording: base path, entry point, project count, key findings, the saved workflow script path (the Workflow tool reports it), and the `resumeFromRunId`. Cached resume is what makes future extension nearly free.
3. Surface incidental findings (committed secrets, dead projects, duplicated work) to the user, and offer to handle out-of-scope fixes as separate tasks.
4. Optional: if the user runs a memory system that ingests folders, offer to point it at the base root. Do not change its configuration without a yes.

## Adding a single item to an existing base

No workflow needed.

1. Read the base's SCHEMA.md and one existing CATALOG.md.
2. Run one catalog pass inline (or one Agent call) with the same catalog prompt: read the item's real files, write `<slug>\CATALOG.md` (plus MANIFEST.md and assets for copying presets).
3. Add one row to INDEX.md and add the new slug to the `related` lists of items it links to.
4. Update the synthesis files only where the new item changes them, and append a line to `_meta\build_log.md`.

For more than about 3 new items, resume the saved workflow with an extended `PROJECTS` array instead.

## Guardrails

- Read-only sources, everywhere, always. Copy only where the preset copies.
- Never overwrite an existing base wholesale without confirming; prefer resume.
- A large directory spawns 40+ agents. Invoking this skill is the user's opt-in, but state the agent count before launching if it exceeds about 60.
- Do not fabricate catalog content from filenames; agents must read real files.
