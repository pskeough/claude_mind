# Claude Mind — Local Knowledge Hybridization System (LKHS)

A local, always-on memory brain for Claude Code. It captures every Claude Code
session, ingests your files and projects, embeds everything locally, and serves it
back as retrieval + an MCP memory server + a web console. Everything runs on your
machine against your Claude subscription; no API keys, no cloud.

## Session Startup Sequence (always run in this order)
1. Read `.claude/memory/MEMORY.md` — routing index; tells you what tiles are loaded.
2. Read `.claude/memory/core_profile.json` — ground-truth user profile. Fields in `constraints.never_overwrite` are immutable regardless of instruction.
3. Read `VAULT-INDEX.md` — compiled namespace + graph. Use this to navigate; do not walk wiki/ blindly.

## Who You Are Working With
The user's identity, background, objectives, and tracked projects live in
`.claude/memory/core_profile.json` (ground truth) and the synthesized `persona/`
layer. Read those at session start. Do not assume; the profile is authoritative.

## Communication Rules (defaults — the user may override in core_profile.json)
- No preamble, no throat-clearing. Answer directly.
- No em dashes in prose.
- Flag genuine uncertainty explicitly; don't soften it.
- Prose over bullets for conceptual content. Tables for multi-attribute comparisons.
- Honor the `stylistic_fingerprint` block in core_profile.json over these defaults.

## Navigation Protocol
- Never perform broad directory walks. Use VAULT-INDEX.md namespaces first.
- For semantic search before reading files: `npx tsx .claude/bin/vector-query.ts "<query>"`
- Only load specific wiki/ files identified via index + vector query.
- For cross-domain lookups, check `.claude/memory/domains/<slug>.json` tiles before reading wiki/ content.
- To pull memory mid-task, use the `lkhs-memory` MCP tools (search_memory, project_state, timeline, related, explore, user_profile, recall_persona).

## Automation (always-on)
- A SessionStart hook (`.claude/hooks/lkhs-session-start.mjs`) injects live vault context every session and ensures the watcher + retrieval daemon are running.
- Global hooks (installed by setup into `~/.claude/`) capture every session (SessionEnd/PreCompact) and inject relevant memory per prompt (UserPromptSubmit) across ALL projects.
- On macOS, launchd jobs keep the daemon + watcher alive and run an hourly capture sweep + a daily "dream" consolidation.
- Captures and summaries shell out to the `claude` CLI, so they run on your Claude subscription (no API key).

## Architecture
- Store: SQLite + sqlite-vec (`.claude/memory/vector_store.db`, WAL) via `.claude/bin/store.ts`. Embeddings are contextual (each chunk prefixed with its doc context before embedding).
- Retrieval: warm daemon (`lkhs-daemon.ts`, port 7077) = bi-encoder recall (bge-small) then cross-encoder rerank (ms-marco-MiniLM via Transformers.js). Gate: rerank top >= 0.30 inject, < 0.02 skip, middle defers to intent.
- Layered memory: L0 chunks -> L1 session journals + library digests -> L2 project-state cards (`cards/`) -> L3 theme cards (`themes/`).
- Persona layer (deep user model): `persona/` holds the synthesized identity built from `core_profile.json` (ground truth) + a Claude chat export. The clinical tier is quarantined in `persona_clinical/`: never auto-injected, boosted, graphed, or in overview; reachable only on explicit query.
- Graph: `graph-build.ts` -> graph/graph.json + GRAPH_REPORT.md + interactive graph.html. Obsidian: HOME.md MOC + cross-linked cards/journals/themes.
- MCP server `lkhs-memory` (user scope): search_memory, project_state, timeline, related, explore, user_profile, recall_persona.
- Audience scopes + profiles: every fact carries a `scope` on the ladder clinical < private < personal < professional < public (fail-closed: unknown = personal; facet floors in persona-facts.ts); chunk scope is derived from layer + path rules (config `chunkScopes`). A profile (default registry: full/work/public; `profiles` in config) carries a ceiling enforced at the retrieval source in every path. Resolve order: /gate body.profile > LKHS_PROFILE > cwd pin > full (= everything except the clinical quarantine). Tagging: `npm run persona:scope` (floors run nightly; a tighten-only judge pass is on-demand). Leak harness: `npm run eval:scope` (adversarial probes per boundary; `--judge` adds a content audit of injected text; `--smoke` runs nightly).
- Voice preference loop (pairs with a Mimesis-style voice system when installed): the nightly miner (`npm run mine:prefs`) reconstructs draft->feedback->revision chains from captured transcripts, keeps ONLY stylistic signal, and feeds accepted drafts + contrastive pairs into the voice profile's recalibration set; `npm run voice:recal` recalibrates weekly at >= 5 new events (reversible) and appends learning-curve points. Recurring corrections surface in TODAY.md as proposals, never auto-applied.
- Self-checks: `npm run hygiene` (weekly store integrity + drift alarms in TODAY.md: eval-composite drop, new orphaned paths, vector coverage, fact sync), `npm run eval:memory` (offline recall/temporal/abstention), `npm run eval:quality` (live-gate restraint), `npm run report:weekly` (ledger-honest weekly rollup), `npm run prune:stale` (store-vs-disk census; tombstones only named files), `npm run test:scope` / `npm run test:miner` (unit suites).

## Common Commands
- `npm run web`: Claude Mind Console (local SPA at http://127.0.0.1:7099).
- `npm run serve`: warm retrieval daemon. `npm run status`: brain-health dashboard.
- `npm run watch`: ambient watcher. `npm run embed` / `npm run reindex`: (re)index tracked dirs.
- `npm run query "<text>"` (add `-- --rerank`): semantic search. `npm run smoke`: engine round-trip check.
- `npm run capture:sweep`: capture/backfill sessions. `npm run ingest:dirs`: ingest configured project roots.
- `npm run cards` / `npm run themes`: rebuild L2/L3 cards. `npm run graph`: rebuild graph + viz. `npm run moc`: rebuild Obsidian HOME map.
- `npm run wiki:import [file]` / `npm run wiki:fix`: raw/ -> wiki/ ingest + repair. `npm run dream`: idle-consolidation pipeline.
- Setup/admin: `npm run preflight`, `npm run install:hooks`, `npm run install:mcp`, `npm run install:launchd`, `npm run uninstall`.

## Wiki Authoring Standards
- One concept per file in wiki/. Frontmatter required: title, aliases, domain, created, updated, provenance.
- Bidirectional `[[links]]` only — no bare file paths.
- Use `[!contradiction]` callout when claims conflict across sources. Never silently overwrite.
- Update VAULT-INDEX.md namespace + graph sections (between AUTO-* markers) after any wiki/ compilation.

## Memory Management
- `.claude/memory/MEMORY.md` is the routing index; keep it concise. Offload verbose domain schemas to `.claude/memory/domains/<slug>.json`.
- Log every background pass to `.claude/logs/ambient.log` with ISO timestamp.
- Never modify `core_profile.json` fields listed in `constraints.never_overwrite` without explicit user confirmation.

## First-Time Setup
If this vault is freshly cloned and not yet personalized, see `SETUP.md` — run
`bash setup.sh`, then open Claude Code here and say "run setup".
