# Persona synthesis — the "build my deep user model" step

The persona layer is what makes the brain feel like it *knows* the user, not just
their files. It is built from two sources: `core_profile.json` (ground truth) and an
exported Claude chat history. This doc is the runbook for the synthesis step that
sits between `persona-extract.ts` (mechanical) and `persona-facts.ts` /
`persona-write-docs.ts` (mechanical). The middle step is an LLM task — Claude runs it.

The clinical tier is quarantined automatically: any health/medication/crisis material
is routed to `persona_clinical/` and `persona_clinical.jsonl`, never auto-injected,
boosted, graphed, or shown in the console. The classifier lexicon is generic by
default; override it per-user via the `clinical` block in the global config.

## Pipeline

```
1. export    user downloads their Claude data export (Settings → Privacy → Export data)
             → a folder with conversations.json and projects/*.json
2. extract    npm run persona:extract -- /path/to/export
             → .claude/memory/persona_raw/{batch-NN.md, manifest.json, timeline.*, ...}
3. SYNTHESIS  (this doc) Claude reads each batch and produces TWO artifacts:
             → merged-facets.json   (atomic facts, schema below)
             → persona-docs.json    (prose docs, schema below)
4. facts      npm run persona:facts -- merged-facets.json
             → persona_facts.jsonl + persona_clinical.jsonl + persona/entities.json
5. docs       npx tsx .claude/bin/persona-write-docs.ts persona-docs.json
             → persona/*.md (+ persona_clinical/*.md for sensitive docs)
6. index      npm run embed && npm run graph
```

## Step 3 — what Claude does

Read `manifest.json`, then each `batch-NN.md` (chronological conversation batches),
plus `projects-personal.md` and `stories-juvenilia.md` if present. For best results,
run one extraction agent per batch (the Workflow / Agent tools), each returning the
facet object below, then merge the arrays. Deduplicate near-identical statements.
Every statement must be grounded in the batches — do not invent. No em dashes.

### Artifact A — `merged-facets.json`

Exact keys and item fields consumed by `persona-facts.ts` (anything else is ignored):

```json
{
  "biography":            [ { "event": "string", "evidence": "string", "date": "YYYY or YYYY-MM-DD" } ],
  "psychology_cognition": [ { "observation": "string", "evidence": "string" } ],
  "values_worldview":     [ { "value": "string", "evidence": "string" } ],
  "decision_patterns":    [ { "pattern": "string", "evidence": "string" } ],
  "intellectual_themes":  [ { "theme": "string", "period": "string", "note": "string" } ],
  "research_identity":    [ { "item": "string", "evidence": "string" } ],
  "voice_style":          [ { "observation": "string", "example": "string" } ],
  "notable_quotes":       [ { "text": "string", "date": "string" } ],
  "relationships":        [ { "person": "string", "role": "string", "notes": "string" } ],
  "health_wellbeing":     [ { "note": "string", "date": "string" } ]
}
```

Notes:
- `health_wellbeing` is force-quarantined to the clinical tier. Also, any statement in
  another bucket that trips the clinical classifier is auto-rerouted, so you don't have
  to perfectly sort sensitive content — but do put obvious health material here.
- `evidence`/`example` should be a short grounding snippet or a date; PII (emails,
  phone numbers) is scrubbed automatically.
- Dates are parsed loosely (1990–present); stray years in non-date fields are dropped.

### Artifact B — `persona-docs.json`

Consumed by `persona-write-docs.ts`. `sensitive: true` docs go to `persona_clinical/`.

```json
{
  "result": {
    "docs": [
      { "file": "PROFILE.md",  "sensitive": false, "body": "---\ntitle: ...\naliases: [...]\ndomain: persona\nalways_on: true\n---\n# <Name>\n<one-screen synthesis>" },
      { "file": "biography.md",                 "sensitive": false, "body": "---\ntitle: ...\n---\n# ..." },
      { "file": "psychology-cognition.md",      "sensitive": false, "body": "..." },
      { "file": "values-worldview.md",          "sensitive": false, "body": "..." },
      { "file": "decision-patterns.md",         "sensitive": false, "body": "..." },
      { "file": "intellectual-trajectory.md",   "sensitive": false, "body": "..." },
      { "file": "research-identity.md",         "sensitive": false, "body": "..." },
      { "file": "voice-style.md",               "sensitive": false, "body": "..." },
      { "file": "relationships-context.md",     "sensitive": false, "body": "..." },
      { "file": "notable-quotes.md",            "sensitive": false, "body": "..." },
      { "file": "TIMELINE.md",                  "sensitive": false, "body": "..." },
      { "file": "health-wellbeing.md",          "sensitive": true,  "body": "..." }
    ]
  }
}
```

`PROFILE.md` is the always-on card injected every session by the SessionStart hook, so
keep it to roughly one screen: who they are, how they work, what they're focused on,
and a pointer that deeper facets are retrievable. Each other doc renders one facet in
prose. The body may include a frontmatter block (title/aliases/domain) — the writer
strips any agent preamble before it.

## Privacy

The raw export dump (`persona_raw/`), the clinical tier (`persona_clinical/`), and the
whole `persona/` layer are gitignored and never leave the machine. Only the user's own
local brain reads them. If the user is uncomfortable with deep chat synthesis, skip
steps 3–6 entirely; the file/project memory works without the persona layer.
