export const meta = {
  name: 'forge-write',
  description: 'Paper forge part B: exemplar dissection, section plan, figures, Opus drafting (via mimesis when connected), Sonnet review lenses, Opus adjudication and revision, submission plan',
  whenToUse: 'Second half of a paper-forge run, after forge_ground.js and any experiments. Args = forge_args.json object.',
  phases: [
    { title: 'Exemplars', detail: 'Sonnet dissects 2-3 published papers per target journal' },
    { title: 'Plan', detail: 'section decision protocol + claim-sentence candidates', model: 'sonnet' },
    { title: 'Figures', detail: 'builds figures from receipts', model: 'sonnet' },
    { title: 'Draft', detail: 'drafts each section (mimesis when connected); Sonnet claim audit' },
    { title: 'Assemble', detail: 'assembles the paper and two abstracts', model: 'sonnet' },
    { title: 'Review', detail: 'five Sonnet lenses, Opus adjudication and revision' },
    { title: 'Submission', detail: 'submission plan, NEEDS_USER, README', model: 'sonnet' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
// Model for the judgement-heavy agents. Default 'sonnet' so a run fits a Pro plan; set
// "bigModel": "opus" in the args file on a Max plan for the original Opus routing.
const BIG = A.bigModel || 'sonnet'
const OUT = A.outDir
const P = A.projectDir
const PAPERS = A.papers || []
const AUTHOR = A.author || 'the user'
const VOICE = A.voice || 'research'
const MIMESIS_OFF = String(A.mimesis || 'auto').toLowerCase() === 'off'

const CTX = `
CONTEXT. Paper forge run "${A.slug}" (${A.title}) for ${AUTHOR}. Today is ${A.date}. Project folder: ${P}. Run folder: ${OUT} (write ONLY inside it).
Part A outputs you build on: ${OUT}/PREMISE.md, ${OUT}/INTERPRETATION.md, ${OUT}/CLAIMS.md (the licensed claims and the claims not made), ${OUT}/RECEIPTS.md (the only source of numbers), ${OUT}/EXPERIMENTS.md (and ${OUT}/experiments/ for any results run since), ${OUT}/lit/*.md, ${OUT}/venue/VENUE-<paper>.md.
READ FIRST, every agent: ${OUT}/input/DECISIONS_VERBATIM.md, ${OUT}/input/PORTFOLIO_BOUNDARIES.md (binding), and ${OUT}/input/PAPER_LESSONS.md (the 11-rule gate).
Collaborators: ${A.collaborators || 'none stated'}
Data sensitivity: ${A.sensitivity || 'none stated'}
HARD RULES. No provider API calls and no GPU jobs. Never modify anything outside ${OUT}. Never contact anyone. Every number in prose is copied from RECEIPTS.md with its receipt id in an HTML comment (<!-- R:id -->); if none exists write [NO RECEIPT] and list it. Existing manuscripts in ${P} are evidence, not text to reuse. Banned in prose: em dashes, antithesis ("not X, but Y"), aphorism closers, punchy-then-reversal, ", which is/means" self-explanation, "It is" opening a sentence, "the way a X does" similes, declarative ratings, first-person meta, "we read/take X as/to mean" as a formula, announce-a-count openers, three-item reflex lists, delve/leverage/multifaceted/crucially/remarkably.
${A.notes ? 'NOTES: ' + A.notes : ''}
LOGGING. Before finishing, write what you read, did and wrote to ${OUT}/agents/<your label>.md.`

const NO_MIMESIS_RULES = `Draft directly. Follow every banned construction in HARD RULES. Then reread your own text for structural tells a word-level check misses: paragraph openers that repeat one skeleton, closer formulas, announce-a-count openers, "we read X as Y" at a constant rate, one modesty formula reused, inventory paragraphs, long-then-short rhythm. Fix each one. Mark each subsection written this way <!-- NO-MIMESIS -->.`
const MIMESIS = MIMESIS_OFF ? `
VOICE. This is ${AUTHOR}'s research prose. The mimesis voice engine is switched off for this run. ${NO_MIMESIS_RULES}` : `
VOICE. This is ${AUTHOR}'s research prose. First check whether the mimesis MCP tools are connected (ToolSearch "mimesis").
IF CONNECTED: per subsection, compose_slate(task=..., voice="${VOICE}", n=2) and write TWO genuinely different candidates from opposed briefs (plain-procedural vs argument-forward), gate_candidates(candidates=[...], voice="${VOICE}", task=...), apply the winner's repair instructions, then scrub_ai_footprint(voice="${VOICE}") and fix every flag (hard flags self-explanation, unheeded-reversal, way-simile, declarative-rating are non-negotiable). retrieve_transform_demos(query_text=..., voice="${VOICE}") gives AI-to-author rewrite pairs; use them. Always pass voice="${VOICE}". If a mimesis call errors twice, write that subsection without it and mark it <!-- UNGATED -->.
IF NOT CONNECTED: ${NO_MIMESIS_RULES}`

const EXLIST = { type: 'object', properties: { exemplars: { type: 'array', items: { type: 'object', properties: {
  paper_id: { type: 'string' }, key: { type: 'string' }, citation: { type: 'string' }, url: { type: 'string' } },
  required: ['paper_id', 'key', 'citation', 'url'] } } }, required: ['exemplars'] }
const SECTIONS = { type: 'object', properties: { sections: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, title: { type: 'string' }, words: { type: 'number' }, brief: { type: 'string' } },
  required: ['id', 'title', 'words', 'brief'] } }, summary: { type: 'string' } }, required: ['sections', 'summary'] }
const DONE = { type: 'object', properties: { file: { type: 'string' }, summary: { type: 'string' },
  needs_user: { type: 'array', items: { type: 'string' } } }, required: ['file', 'summary'] }
const FIND = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  section: { type: 'string' }, severity: { type: 'string', description: 'major | minor' }, point: { type: 'string' },
  evidence: { type: 'string', description: 'quote from the draft or receipt' }, fix: { type: 'string' } },
  required: ['section', 'severity', 'point', 'fix'] } } }, required: ['findings'] }

// ---------- 1. Exemplars ----------
phase('Exemplars')
const ex = await agent(CTX + `\n\nTASK. Read ${OUT}/venue/VENUE-*.md and return the EXEMPLARS listed for each paper id (${PAPERS.map(p => p.id).join(', ')}), at most 3 per paper, with a short key each.`,
  { label: 'exemplar-list', phase: 'Exemplars', model: 'sonnet', effort: 'high', schema: EXLIST })
const exemplars = ex ? ex.exemplars.slice(0, 3 * PAPERS.length) : []
await parallel(exemplars.map(e => () => agent(CTX + `\n\nTASK. Put a hard timeout on every fetch (curl --max-time 60, scripts wrapped in a 90 s timeout); if the paper will not load, use its abstract page or skip it and say so. Dissect the published exemplar paper "${e.citation}" (${e.url}) for paper ${e.paper_id}. Get the full text (WebFetch, or the defuddle CLI if installed; if paywalled, use the arXiv/PMC/author copy and say which). Write ${OUT}/exemplars/${e.paper_id}-${e.key}.md: section order with approximate word counts, number and role of figures and tables, where the main claim first appears and how it is phrased (quote under 30 words), how the introduction moves from problem to contribution, how methods are made replicable, how limitations are framed, the abstract's structure, and anything this journal's papers do that ours must match.`,
  { label: 'exemplar-' + e.paper_id + '-' + e.key, phase: 'Exemplars', agentType: 'web-researcher', model: 'sonnet', effort: 'high' })))
log('Exemplars dissected: ' + exemplars.length)

// ---------- 2-7. Per paper: plan -> figures -> draft -> assemble -> review -> submission ----------
const results = await pipeline(PAPERS,
  // Plan
  p => agent(CTX + `\n\nTASK. Conceptual plan for paper "${p.id}" (${p.working_title}). Read CLAIMS.md, INTERPRETATION.md, VENUE-${p.id}.md (format checklist) and ${OUT}/exemplars/${p.id}-*.md.
Write ${OUT}/plan/${p.id}/OUTLINE.md, a section decision protocol: for every section and subsection, its purpose, the one point it makes, the receipt ids and literature it uses, required disclosures, word target (sum within the venue limit), figures/tables it calls out by number, and what it must not say. Structure follows the exemplars and the venue's article type. Figure 1 shows the method or the core contrast. Abstract plan: at most three claims, one number per sentence.
Write ${OUT}/plan/${p.id}/CLAIM_CANDIDATES.md: TWO complete claim sets from opposed briefs (one conservative-procedural, one strongest-honest-argument), each with the one-sentence contribution and each section's point sentence. Label them X and Y only; do not say which you prefer anywhere in that file (the user chooses blind; paper-lessons Rule 9). Put your preference and reasons in ${OUT}/plan/${p.id}/PREFERENCE_SEALED.md. Draft proceeds on your preferred set, marked provisional.
Write ${OUT}/plan/${p.id}/FIGURES.md: each figure and table with data source (receipt ids and files) and design.
Return the section list (at most 10 drafting units; group small sections).`,
    { label: 'plan-' + p.id, phase: 'Plan', model: BIG, effort: 'high', schema: SECTIONS }),
  // Figures
  (plan, p) => agent(CTX + `\n\nTASK. Build the figures and tables in ${OUT}/plan/${p.id}/FIGURES.md from the raw files and receipts, with scripts in ${OUT}/figures/${p.id}/ (matplotlib; vector PDF + 300 dpi PNG). Follow the general-figure-guide skill (and the dataviz skill if it is installed): render each figure and inspect the image for clipped text, overlaps, empty panels and wrong filtering before accepting it. Tables as Markdown in ${OUT}/figures/${p.id}/tables.md with receipt ids. Write ${OUT}/figures/${p.id}/README.md mapping figure number to file, script and receipts.`,
    { label: 'figures-' + p.id, phase: 'Figures', model: BIG, effort: 'high', schema: DONE }).then(() => plan),
  // Draft (nested pipeline over sections)
  (plan, p) => plan ? pipeline(plan.sections,
    s => agent(CTX + MIMESIS + `\n\nTASK. Draft section "${s.id}" (${s.title}, about ${s.words} words) of paper ${p.id}. Brief: ${s.brief}
Read ${OUT}/plan/${p.id}/OUTLINE.md and the provisional claim set in ${OUT}/plan/${p.id}/PREFERENCE_SEALED.md, the receipts and literature it names, and the exemplar notes. For every citation you use, re-open the source and confirm the claim (the lit files are leads). Cite with \\cite{key}; collect BibTeX in ${OUT}/drafts/${p.id}/refs-${s.id}.bib. Mark open questions [NEEDS USER: ...]. Write ${OUT}/drafts/${p.id}/${s.id}.md.`,
      { label: 'draft-' + p.id + '-' + s.id, phase: 'Draft', model: BIG, effort: 'high', schema: DONE }),
    (d, s) => agent(CTX + `\n\nTASK. Claim audit of ${OUT}/drafts/${p.id}/${s.id}.md. Check every number, count, test statistic, direction claim, citation claim and cross-reference against RECEIPTS.md (scale, denominator, rounding) and CLAIMS.md (strength). Fix transcription errors in place with minimal edits. Anything claimed beyond CLAIMS.md: rewrite to the licensed strength and flag it. Write the verdict table (MATCH / CORRECTED / NO RECEIPT / OVERCLAIM) to ${OUT}/drafts/${p.id}/${s.id}.audit.md.`,
      { label: 'audit-' + p.id + '-' + s.id, phase: 'Draft', model: 'sonnet', effort: 'high' })) : null,
  // Assemble
  (d, p) => agent(CTX + MIMESIS + `\n\nTASK. Assemble paper ${p.id}. Join ${OUT}/drafts/${p.id}/*.md (not .audit.md, not .bib) in OUTLINE order into ${OUT}/drafts/${p.id}/DRAFT_v1.md; merge the .bib files into refs.bib (dedupe keys, verify each DOI against https://api.crossref.org/works/<doi>; OpenAlex may be rate-limited). Consistency pass: cross-references, one term per concept, the same number stated two ways, repeated claims, every figure and table called out by number at the point of its claim, every "see Appendix/Table/Figure" pointing at content that exists. Then write TWO abstracts from opposed briefs (via compose_slate + gate_candidates with voice="${VOICE}" when mimesis is connected and not switched off; otherwise per the no-mimesis rules above), within the venue limit, at most three claims and one number per sentence, into ${OUT}/drafts/${p.id}/ABSTRACTS.md labelled A and B only. Log every edit in ${OUT}/drafts/${p.id}/ASSEMBLY_NOTES.md.`,
    { label: 'assemble-' + p.id, phase: 'Assemble', model: BIG, effort: 'high', schema: DONE }),
  // Review: lenses (Sonnet) -> adjudicate (Opus) -> revise (Opus)
  async (d, p) => {
    const DR = `${OUT}/drafts/${p.id}/DRAFT_v1.md`
    const LENSES = [
      { key: 'referee', ctx: true, prompt: `You are a hostile referee for the primary journal in ${OUT}/venue/VENUE-${p.id}.md, recruited from the pool that journal would use. Read ${DR} in full and the relevant literature files. Attack scope fit, contribution over prior work, claims stronger than the evidence, methodological holes presented as solved, and missing limitations. Include at least two points where the paper undersells a result.` },
      { key: 'stats', ctx: true, prompt: `You are a methods and statistics referee. Read ${DR}, RECEIPTS.md and the analysis files. Check test choice, assumptions, multiplicity and corrections, effect sizes and CIs, denominators, pseudo-replication, same-family judging (paper-lessons Rule 6), exclusions, and whether the design lets a reader replicate (Rule 7: one setup table with every model version, judge, temperature, votes, cell counts).` },
      { key: 'novelty', ctx: true, prompt: `You are a novelty and positioning referee. Read ${DR}, ${OUT}/lit/*.md and ${OUT}/exemplars/${p.id}-*.md. Is anything claimed as new that prior work did? What must be cited that is not? Is the external-evidence requirement met (Rule 5)? Compare the paper's shape with the exemplars and say where it falls short of what this journal publishes.` },
      { key: 'prose', ctx: true, prompt: `You are the prose and structure reviewer. Read ${DR} and ${OUT}/input/PAPER_LESSONS.md rules 8 and 9${A.voiceFeedbackFile ? `, and ${A.voiceFeedbackFile} (the author's own verbatim feedback on AI prose)` : ''}. Find structural AI tells the word-level scrub misses (paragraph-opener skeletons repeated, closer formulas, announce-a-count openers, "we read X as Y" at a constant rate, one modesty formula reused, inventory paragraphs, long-then-short rhythm), unclear sentences, undefined or drifting terms, and abstract density. Quote each.` },
      { key: 'cold', ctx: false, prompt: `You have never seen this project. Read ONLY the abstract, the introduction, and the Figure 1 caption of ${DR}. Stop there. Then: (1) state the paper's main claim in one sentence, (2) state what you think the evidence is, (3) list what confused you, (4) say whether you would keep reading as a busy editor and why. Return each confusion as a finding with section and fix.` },
    ]
    const lensOut = await parallel(LENSES.map(l => () => agent((l.ctx ? CTX + '\n\nTASK. ' : 'TASK. ') + l.prompt + ` Write your report to ${OUT}/review/${p.id}/lens-${l.key}.md and return findings.`,
      { label: 'lens-' + p.id + '-' + l.key, phase: 'Review', model: 'sonnet', effort: 'high', schema: FIND })))
    const findings = lensOut.filter(Boolean).flatMap((r, i) => r.findings.map(f => ({ ...f, lens: LENSES[i].key })))
    log(p.id + ': ' + findings.length + ' review findings to adjudicate')
    await agent(CTX + `\n\nTASK. Adjudicate these review findings on ${DR}. Sonnet lenses produced them; they are leads. For each: re-open the draft text, RECEIPTS.md, CLAIMS.md and the literature, then CONFIRM (with the exact fix), PARTLY (what holds, revised fix) or REFUTE (why). Refuse any finding that re-opens a decision in DECISIONS_VERBATIM.md without new evidence, and any fix that adds a number without a receipt. Merge duplicates. Compare the cold reader's one-sentence claim with CLAIMS.md and report the gap. Write ${OUT}/review/${p.id}/ADJUDICATION.md (confirmed ranked by severity, then partly, then refuted one line each).\nFINDINGS:\n` + JSON.stringify(findings),
      { label: 'adjudicate-' + p.id, phase: 'Review', model: BIG, effort: 'high' })
    return agent(CTX + MIMESIS + `\n\nTASK. Revise paper ${p.id}. Apply every CONFIRMED and PARTLY fix in ${OUT}/review/${p.id}/ADJUDICATION.md to a copy: ${OUT}/drafts/${p.id}/DRAFT_v2.md (leave DRAFT_v1.md untouched). New or changed prose follows the VOICE instructions above (mimesis when connected). Then re-run the claim audit on every changed paragraph against RECEIPTS.md and CLAIMS.md and append the table to ${OUT}/drafts/${p.id}/REVISION_LOG.md with each fix's status (APPLIED with location, or DEFERRED with reason).`,
      { label: 'revise-' + p.id, phase: 'Review', model: BIG, effort: 'high', schema: DONE })
  },
  // Submission plan
  (d, p) => agent(CTX + `\n\nTASK. Submission plan for paper ${p.id}. Read DRAFT_v2.md, REVISION_LOG.md, VENUE-${p.id}.md, CLAIM_CANDIDATES.md, and PAPER_LESSONS.md. Write:
1. ${OUT}/plan/${p.id}/SUBMISSION_PLAN.md: the 11-rule gate with each rule's status (PASS / FAIL / OPEN, with evidence); the venue format checklist checked against DRAFT_v2.md; co-author and mentor steps written as single bounded asks with a proposed date (drafts only, never sent); the generative-AI disclosure text that describes what actually happened (this draft was machine-drafted from the author's data under the author's direction, and through the mimesis voice model only if the drafts show it was used; count <!-- NO-MIMESIS --> and <!-- UNGATED --> markers to tell); preprint status and policy; a dated path from now to submission, with the 72-hour freeze.
2. ${OUT}/plan/${p.id}/NEEDS_USER.md: (A) facts only the user can confirm, (B) decisions, starting with the blind claim-set choice X/Y and the abstract choice A/B, (C) blocked items and what unblocks them, (D) runnable follow-ups (CPU/GPU) with estimates. Each item says what it blocks. Deduplicate every [NEEDS USER] marker in the drafts into this file.`,
    { label: 'submission-' + p.id, phase: 'Submission', model: BIG, effort: 'high', schema: DONE }),
)

phase('Submission')
await agent(CTX + `\n\nTASK. Write ${OUT}/README.md for the user: what this forge run did (parts A and B), the paper(s) produced with their target journals, a file map, counts (sections, words, mimesis-gated vs UNGATED vs NO-MIMESIS, receipts, claims audited, findings raised/confirmed/refuted per paper), what is unverified (Sonnet-found citations not re-opened by an Opus agent, DRAFT receipts), and the first three things to do next. Flat declarative prose.${A.runLogFile ? ` Also add one row for this run to ${A.runLogFile} (the only file outside the run folder you may edit; append a table row, change nothing else; if the file does not exist, skip this).` : ''}`,
  { label: 'readme', phase: 'Submission', model: BIG, effort: 'high' })

return { papers: PAPERS.map(p => p.id), done: results.filter(Boolean).length, exemplars: exemplars.length }
