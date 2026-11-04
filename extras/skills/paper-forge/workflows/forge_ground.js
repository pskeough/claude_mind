export const meta = {
  name: 'forge-ground',
  description: 'Paper forge part A: inventory, premise, re-derived results with receipts, literature, interpretation, venue choice',
  whenToUse: 'First half of a paper-forge run. Args = forge_args.json object. Run forge_setup.py first.',
  phases: [
    { title: 'Inventory', detail: 'Sonnet lanes walk the project and Claude Mind' },
    { title: 'Premise', detail: 'what the data can support, analysis and lit plan', model: 'sonnet' },
    { title: 'Analysis and literature', detail: 're-derivation with receipts; Sonnet literature lanes in parallel' },
    { title: 'Receipts', detail: 'merge per-task receipts into RECEIPTS.md' },
    { title: 'Interpretation', detail: 'premises vs literature and receipts, claims per paper, experiments', model: 'sonnet' },
    { title: 'Venue', detail: 'Sonnet journal sweeps, Opus pick + format checklist + exemplars' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
// Model for the judgement-heavy agents. Default 'sonnet' so a run fits a Pro plan; set
// "bigModel": "opus" in the args file on a Max plan for the original Opus routing.
const BIG = A.bigModel || 'sonnet'
const OUT = A.outDir
const P = A.projectDir
const PAPERS = A.papers || []
const paperList = PAPERS.map(p => `- ${p.id}: ${p.working_title}. Anchor premise (open to change): ${p.anchor_premise}`).join('\n')
const AUTHOR = A.author || 'the user'
const PRIOR = (A.priorPapers || []).filter(Boolean)

const CTX = `
CONTEXT. Paper forge run "${A.slug}" (${A.title}) for ${AUTHOR}. Today is ${A.date}. Project folder: ${P}. Run folder: ${OUT} (write ONLY inside it).
Anchor papers (the premise is open; the goal is the strongest publication-grade papers the findings support, and existing drafts are evidence to read, never a base to extend):
${paperList}
Collaborators: ${A.collaborators || 'none stated'}
READ FIRST, every agent: ${OUT}/input/DECISIONS_VERBATIM.md (decisions, deviations, withdrawals, quoted verbatim; newer file wins on conflict), ${OUT}/input/PORTFOLIO_BOUNDARIES.md (binding: which claims belong to which of the user's papers, retired claims that must never reappear), and the files your task names.
Known hard limits on what may be claimed:
${(A.hardLimits || []).map(x => '- ' + x).join('\n')}
Receipt hints and precedence: ${(A.receiptHints || []).join(' ; ')}
Data sensitivity: ${A.sensitivity || 'none stated'}
HARD RULES. No paid provider API calls (any paid LLM or cloud-compute API). No GPU jobs inside this workflow: GPU experiments are proposed here and run later by the main chat. CPU re-analysis of stored files is fine. Never modify anything outside ${OUT}. Never contact anyone or send email. Every number you write must carry its source (file + script/row); mark [NO RECEIPT] rather than guess. Prose for the user: flat declarative, no em dashes, no antithesis, no aphorism closers, no ", which is/means" self-explanation.
${A.notes ? 'NOTES: ' + A.notes : ''}
LOGGING. Before finishing, write what you read, did and wrote to ${OUT}/agents/<your label>.md.`

const TASK_LIST = { type: 'object', properties: {
  candidates: { type: 'array', items: { type: 'object', properties: {
    paper_id: { type: 'string' }, premise: { type: 'string' }, supports: { type: 'string' }, cannot_claim: { type: 'string' } },
    required: ['paper_id', 'premise'] } },
  analysis_tasks: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string', description: 'short kebab id' }, question: { type: 'string' },
    inputs: { type: 'string', description: 'exact files/scripts' }, method: { type: 'string' } },
    required: ['id', 'question', 'inputs', 'method'] } },
  lit_lanes: { type: 'array', items: { type: 'object', properties: {
    key: { type: 'string' }, brief: { type: 'string' } }, required: ['key', 'brief'] } },
  summary: { type: 'string' } },
  required: ['candidates', 'analysis_tasks', 'lit_lanes', 'summary'] }

const DONE = { type: 'object', properties: { file: { type: 'string' }, summary: { type: 'string' },
  needs_user: { type: 'array', items: { type: 'string' } } }, required: ['file', 'summary'] }

// ---------- 1. Inventory (Sonnet lanes) ----------
phase('Inventory')
const LANES = [
  { key: 'data', prompt: `Inventory every DATA and RESULTS file in ${P} (json, jsonl, csv, parquet, npy, result markdown tables). For each: path, size, rows/records where cheap to count, what it holds, which script produced it, date, and whether a newer version supersedes it. Skip venvs, caches, model weights, node_modules, .git. Write ${OUT}/inventory/data.md.` },
  { key: 'code', prompt: `Inventory every SCRIPT and METHOD document in ${P}: analysis scripts, runners, configs, prompts, judge rubrics, preregistrations. For each script: path, what it computes, inputs, outputs, and whether it still runs on current data (read it; do not execute anything that calls a model or GPU). Identify the canonical pipeline end to end. Write ${OUT}/inventory/code.md.` },
  { key: 'history', prompt: `Inventory the REPORTS, DRAFTS, AUDITS and DECISION documents in ${P}: manuscripts (.tex/.md/.pdf), reviews, audits, handoffs, research logs. Build a dated timeline of what was claimed, what was corrected or withdrawn, and which document is newest for each topic. Quote corrections verbatim. List every manuscript version with date. Write ${OUT}/inventory/history.md.` },
  { key: 'mind', prompt: `Query Claude Mind (lkhs-memory MCP; load tools via ToolSearch "+lkhs-memory"): project_state, timeline and search_memory for this project and each anchor paper; search for decisions, withdrawn or corrected claims, reviewer and mentor feedback, what the user said they wanted these papers to be, and collaborator commitments. Run check_claims on the anchor premises. Use fetch_transcript on the 2-3 most decision-heavy sessions. Write ${OUT}/inventory/mind.md with dates and session ids for every item. If the lkhs-memory tools are not available, write ${OUT}/inventory/mind.md saying so in one line and stop; do not invent history.` },
]
const inv = await parallel(LANES.map(l => () => agent(CTX + '\n\nTASK (inventory lane, you are a collector; the Opus stages judge).\n' + l.prompt + '\nReturn a 150-word summary.',
  { label: 'inv-' + l.key, phase: 'Inventory', model: 'sonnet', effort: 'high' })))
log('Inventory lanes done: ' + inv.filter(Boolean).length + '/' + LANES.length)

// ---------- 2. Premise (Opus) ----------
phase('Premise')
const plan = await agent(CTX + `\n\nTASK. You are the lead researcher. Read ${OUT}/inventory/*.md, then open the key data files and the newest manuscript(s) yourself. Write ${OUT}/PREMISE.md:
1. What the data on disk can support, stated plainly, with the file behind each statement.
2. Candidate papers ranked. Start from the anchor papers, but re-scope, split or merge them if the evidence says so, and say why. For each: the premise, the strongest honest claim, what it cannot claim, the evidence gap a Q1 referee would find first, and overlap risk with the user's other papers per PORTFOLIO_BOUNDARIES.md.
3. The analyses that must be re-derived from raw files before anyone writes (every headline number, every test the paper will rest on), and new CPU analyses that would materially strengthen a candidate. At most 8 tasks; list any you dropped.
4. Literature lanes (at most 5): the construct, the method, competing explanations, the external-evidence question (paper-lessons Rule 5: show the problem outside our own pipeline), and field-of-venue work.
Keep paper ids stable: use the anchor ids (${PAPERS.map(p => p.id).join(', ')}) unless you add or merge, then explain.`,
  { label: 'premise', phase: 'Premise', model: BIG, effort: 'high', schema: TASK_LIST })
if (!plan) { log('Premise agent failed; stopping'); return { error: 'premise failed' } }
const tasks = plan.analysis_tasks.slice(0, 8)
const lanes = plan.lit_lanes.slice(0, 5)
if (plan.analysis_tasks.length > 8) log('Dropped analysis tasks: ' + plan.analysis_tasks.slice(8).map(t => t.id).join(', '))
if (plan.lit_lanes.length > 5) log('Dropped lit lanes: ' + plan.lit_lanes.slice(5).map(t => t.key).join(', '))

// ---------- 3. Analysis (Opus) and literature (Sonnet) in parallel ----------
phase('Analysis and literature')
const [ana, lit] = await parallel([
  () => pipeline(tasks, t => agent(CTX + `\n\nTASK. Re-derive analysis "${t.id}": ${t.question}\nInputs: ${t.inputs}\nMethod: ${t.method}\nWork from raw files. Prefer the project's own scripts (copy into ${OUT}/analysis/scripts/ before modifying); otherwise write your own there. CPU only. Before any test: filter degenerate inputs (constant, all-NaN, single-item groups) and report effective N; pick tests per the statistical-analysis and eval-methodology-playbook skills (degenerate-input-filtering and nan-safe-correlation for the filtering and correlation steps); recompute p from the statistic and df; state every denominator; check cells multiply to N; use pairwise deletion for correlations with missing data. Compare your numbers with every place the project previously reported them and list mismatches.
Write ${OUT}/analysis/${t.id}.md (question, method, result, comparison with earlier reports, caveats) and ${OUT}/analysis/${t.id}.receipts.md (a table: receipt id ${t.id}-NN | value exactly as it should be printed | file | script + command | note).`,
    { label: 'ana-' + t.id, phase: 'Analysis and literature', model: BIG, effort: 'high', schema: DONE })),
  () => parallel(lanes.map(l => () => agent(CTX + `\n\nTASK (literature lane "${l.key}"; you are a collector, Opus verifies what it uses). ${l.brief}
Find 8-15 relevant works, weighted to 2022-2026 and to Q1 journals and top venues. Verify every item exists: exact title, authors, venue, year, DOI or arXiv id. Use the Crossref API first (https://api.crossref.org/works?query=... and https://api.crossref.org/works/<doi>, no key needed), the arXiv API over https (https://export.arxiv.org/api/query?...), then publisher pages. OpenAlex (see the openalex-database skill) and Semantic Scholar sometimes return HTTP 429 when their rate budget is spent (the OpenAlex daily budget resets 00:00 UTC); try them once, and do not retry in a loop. Put a hard timeout on every fetch (curl --max-time 60; for defuddle or any script, wrap it with a 90 s timeout); in a past run a lit agent hung on one arXiv fetch for 3.4 hours and stalled the whole run. If a source will not load within the timeout, skip it and note it. Publisher sites often return 403 to curl; use WebFetch or the arXiv/PMC/author copy. For each: a verbatim quote under 30 words from the abstract or body with its URL, what it found, and exactly how it bears on our premise (supports, competes, or threatens it). Mark anything you could not open UNVERIFIED. Never paste project data or interview text into a search. Write ${OUT}/lit/${l.key}.md with a BibTeX block at the end.`,
    { label: 'lit-' + l.key, phase: 'Analysis and literature', agentType: 'web-researcher', model: 'sonnet', effort: 'high', schema: DONE }))),
])
log('Analyses: ' + (ana || []).filter(Boolean).length + '/' + tasks.length + '; lit lanes: ' + (lit || []).filter(Boolean).length + '/' + lanes.length)

// ---------- 4. Receipts merge ----------
phase('Receipts')
await agent(CTX + `\n\nTASK. Merge every ${OUT}/analysis/*.receipts.md into ${OUT}/RECEIPTS.md (one table, grouped by analysis, receipt ids unchanged). Then list conflicts: the same quantity with two values, a value that disagrees with the project's earlier reports (from analysis/*.md comparison sections), and receipts whose file does not exist. Do not resolve conflicts; list them under "Open conflicts".`,
  { label: 'receipts-merge', phase: 'Receipts', model: 'sonnet', effort: 'high' })

// ---------- 5. Interpretation (Opus) ----------
phase('Interpretation')
const interp = await agent(CTX + `\n\nTASK. You are the lead researcher again. Read ${OUT}/PREMISE.md, ${OUT}/RECEIPTS.md (including Open conflicts), ${OUT}/analysis/*.md and ${OUT}/lit/*.md. Re-open the source of any citation you rely on (the lit files are Sonnet leads). ${PRIOR.length ? 'Also read two of the user\'s earlier papers for tone and evaluation method, chosen from: ' + PRIOR.join(' ; ') + '.' : 'If the project folder holds the user\'s earlier papers, read two for tone and evaluation method.'} The house standard: a statistical spine suited to the data (non-parametric where assumptions are doubtful), a claims ledger, and an explicit "what we do not claim".
Write:
1. ${OUT}/INTERPRETATION.md: each premise tested against receipts and literature (holds / holds narrower / fails, with why); interpretation angles; alternative explanations each paper must address and how the data answers them; what the literature says that we did not know; resolution of every Open conflict in RECEIPTS.md (say which value is right and why, or mark unresolved).
2. ${OUT}/CLAIMS.md: per paper id, the claims at the strength the receipts license, each with receipt ids, the claims explicitly not made, and required disclosures.
3. ${OUT}/EXPERIMENTS.md: experiments that would decisively change a claim, ranked. For each: question, why decisive, exact runnable plan (script, models, N), CPU or GPU, GPU minutes and VRAM estimate, and what result would change what claim. Mark each RUN-TONIGHT (under 3 GPU hours and decisive), LATER, or NOT-WORTH-IT. Nothing here runs inside the workflow.
Return a 250-word summary and the NEEDS USER items.`,
  { label: 'interpret', phase: 'Interpretation', model: BIG, effort: 'high', schema: DONE })

// ---------- 6. Venue ----------
phase('Venue')
const venueIds = PAPERS.map(p => p.id)
const vs = await pipeline(venueIds,
  id => agent(CTX + `\n\nTASK (venue sweep for paper "${id}"; collector). Read ${OUT}/CLAIMS.md and ${OUT}/INTERPRETATION.md for this paper. ${A.venueHints || ''}
Find 5-7 Q1 journals (Scimago/JCR Q1 in the relevant category; say which category and the source) that fit this paper's claims and methods. For each: aims-and-scope quote with URL, 2-3 papers they published 2023-2026 closest to ours (title, DOI, open access or not), article types and word/figure limits from the author guidelines page, preprint policy (preprints such as arXiv must be allowed if the paper has or will have one), APC and whether there is a no-fee route, typical time to first decision if stated. Also note any special issue open now. Write ${OUT}/venue/sweep-${id}.md.`,
    { label: 'venue-sweep-' + id, phase: 'Venue', agentType: 'web-researcher', model: 'sonnet', effort: 'high', schema: DONE }),
  (s, id) => agent(CTX + `\n\nTASK. Choose the venue for paper "${id}". Read ${OUT}/venue/sweep-${id}.md, ${OUT}/CLAIMS.md, ${OUT}/input/PAPER_LESSONS.md. Re-open the author-guidelines page of your top two. Write ${OUT}/venue/VENUE-${id}.md: primary and fallback with reasons tied to the claims (fit, the referee pool the paper will face, what that pool will attack), then a FORMAT CHECKLIST for the primary built from the live guidelines (article type, word and page limits and what counts, abstract limit and structure, figure/table limits, reference style, required statements: data availability, ethics, competing interests, CRediT, generative-AI disclosure), then EXEMPLARS: the 2-3 published papers in the primary (or its closest peer) that best match this paper's shape, with DOI and a full-text URL you confirmed opens.`,
    { label: 'venue-pick-' + id, phase: 'Venue', model: BIG, effort: 'high', schema: DONE }))

return {
  premise: plan.summary,
  candidates: plan.candidates.map(c => c.paper_id + ': ' + c.premise),
  analyses: tasks.map(t => t.id),
  lit_lanes: lanes.map(l => l.key),
  interpretation: interp ? interp.summary : null,
  needs_user: [interp, ...vs].filter(Boolean).flatMap(x => x.needs_user || []),
  venues: vs.filter(Boolean).map(v => v.file),
  next: 'Main chat: read EXPERIMENTS.md, run RUN-TONIGHT items (under a GPU lease if GPUs are shared), then launch forge_write.js.',
}
