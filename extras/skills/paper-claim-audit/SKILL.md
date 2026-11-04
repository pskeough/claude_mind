---
name: paper-claim-audit
description: Pre-submission audit of every empirical and statistical claim in a paper draft against its cited sources and the underlying raw data in the user's own project folder. Use when the user says "audit my claims", "check the paper before I submit", "does the data support this", "verify my numbers", "claim check", "pre-submission review", "sanity-check the stats section", "did I overclaim", "check for cherry-picking", or before submitting or resubmitting any paper draft (.tex/.md/.pdf manuscript) that has a data or stats folder behind it. It works against unpublished local data and receipts, which a web fact-checker or generic proofreader cannot do. Produces a claim-by-claim verdict table (MATCH/CORRECTED/NEW/UNVERIFIABLE).
---

# Paper claim audit

This method comes from a real validation campaign on a large LLM-evaluation paper: 186 claims, 17 test families, 16 sub-audits, receipts plus idempotent scripts, a `CLAIMS_LEDGER.md` and a `00_MASTER_VALIDATION_REPORT.md`. That campaign is the model to follow, not a generic fact-checking pass. The differentiator: this works against data that is not published anywhere (raw CSVs, stats outputs and receipts sitting in the user's project folder), so it can catch things no external tool can: stale intermediate files, a sign error, a logging artifact, a non-convergent value reported as a point estimate.

## When to use vs. its siblings

This is the "does the data support this" check for a **specific draft against specific project data**. For general eval-design help (not auditing an existing draft), use the `eval-methodology-playbook` skill. For checking that cited papers exist and say what they are cited as saying, `openalex-database` and `paper-library` do the lookups; this skill calls on them only for the citation rows.

## Inputs (ask if not given)

Before starting, establish:

1. **Manuscript path**: the draft file (.tex, .md, or .pdf). If several dated versions exist, use the most recent unless told otherwise.
2. **Data folder**: raw data (CSV, JSONL, parquet), possibly with a `.sha256` hash-lock file.
3. **Stats folder**: computed outputs (`.txt`/`.csv` result files, `.md` interpretation notes), and the analysis scripts that produced them.

A common layout, which this skill assumes only as a default:

```
<project>\
  manuscript\ or paper\   main.tex / draft.md / *.pdf
  data\                   *.csv, *.jsonl, *.sha256
  stats\ or results\      *.txt, *.csv, *.md (plus CLAIMS_LEDGER.md etc. in mature projects)
  scripts\ or analysis\   the code that produced stats\
  figures\                generated plots and tables
```

If the project has a `CLAIMS_LEDGER.md`, `*_VALIDATION_REPORT.md`, `STATISTICAL_SUPPLEMENT*.md` or `FDR_CORRECTION_REPORT.md`, read those first: they may already contain part of the audit.

If the project has no claims infrastructure yet, this audit is the first pass. Build the ledger from scratch rather than assuming one exists. If the draft or data location is ambiguous, ask. Do not audit one project's draft against another project's data.

## Process

### 1. Extract every empirical and statistical claim from the draft

Read the whole draft. Pull out every sentence that asserts a number, a statistical test result, a comparison, or an effect. Check the discussion and limitations sections as well as the abstract and results, since overclaiming often creeps in there. For each claim, capture: the exact sentence and location (section, plus page or line if available), the specific quantity asserted (a number, a direction, a significance claim), and the claim type (point estimate, correlation, test statistic, effect size, qualitative comparison).

Number them C1, C2, and so on. This numbering is the audit table's primary key. For a long paper, group claims into families (F01, F02, ...) by analysis and number within them.

### 2. Match each claim to a source

For each claim, find either:

- **A citation** to external literature. Verify the citation exists and says what it is cited as saying. Do not assume a citation is real; if the source is accessible, check it.
- **A raw-data or stats-file source** in the data or stats folder. Find the script or file that produced the number. If a ledger or receipts folder exists, check whether the claim is already covered there first.

If neither exists, the claim is **UNSUPPORTED**. Flag it immediately and do not guess a justification for it.

### 3. Recompute where feasible

Where the raw data is present, do not trust the cached stats file. Spot-check by recomputing the claim from raw data when it is cheap (a mean, a correlation, a proportion). This is how the source campaign caught real errors: two "stale" decomposition rows came from an old n=150/112 subset when the current raw data was n=400/302. Reading a cached result file as ground truth without checking its date and subset size against the current data is the most common way a claim audit misses a real problem.

### 4. Classify each claim into a verdict

Use exactly this taxonomy. It forces a decision; do not invent a fifth category.

- **MATCH**: the claim as stated is fully supported by the source or data, and values reproduce.
- **CORRECTED**: the claim's direction holds but the specific value is wrong (stale subset, rounding, wrong config, decimal drift, non-convergent value reported as converged). State the corrected value.
- **NEW**: the audit surfaced something the draft does not claim but the data supports. Flag it as a potential addition, not a defect.
- **UNVERIFIABLE / retired**: cannot be checked with available artifacts (for example it needs logprobs that were never captured, or a measurement never taken such as latency). Recommend removing the claim or caveating it explicitly as an assumption. Do not delete it silently.

UNSUPPORTED claims from step 2 are reported in the UNVERIFIABLE column of the roll-up and listed under "What NOT to claim."

Within CORRECTED, watch for these patterns, listed in order of how often they turned up in real audits:

- **Sign errors**: a claim asserts a direction opposite to what the data shows. Highest severity. Check direction independently of magnitude every time; do not just check that the number is "close." Precedent: a claim said a retrieval-augmented system "abstains slightly more," while scripted analysis showed it abstained far *less*. The sign was backwards, and the first audit that tried to check it also got it wrong. Recompute from raw data; do not trust an existing "fix."
- **Stale subset or cherry-picked config**: a number computed on an old or smaller data slice, or from a non-default pipeline config, without disclosure. Check the reported n against the current full dataset's n.
- **Logging or accounting artifacts**: a cost, count or rate figure that undercounts (missed resumed or retried tokens, wrong unit price) or overcounts. Precedent: a "$0.95" cost claim missed about 3.4M resumed tokens and used a stale judge price; the honest figure was about $14.7, an 8.8x understatement hiding in a logging artifact rather than a math error.
- **Non-convergent values reported as point estimates**: for example Bradley-Terry anchors that never lost a comparison in the sample. Report these as lower or upper bounds at the stated iteration count, not as converged point values.
- **Rounding or threshold inflation**: a value near a stated band gets rounded into a more favorable band, or a threshold-sensitive claim (for example "abstains 66-72%") is stated as a tight range when the true value sits at the edge or outside it. Precedent: the true value was 76.8%, outside the stated band.
- **Third-decimal drift from snapshot timing**: small non-substantive differences from re-running at a different data snapshot. Note these, but treat them as CORRECTED only if they cross a reported threshold or significance boundary, or are asserted as a load-bearing precise number.

### 5. Check statistical completeness

For every claim involving a comparison or test, flag if any of these is missing:

- Effect size (not just a p-value or significance language).
- Confidence interval, or at minimum a variance or SD alongside a mean.
- Sample size (n), stated per claim, not only once in a methods table, especially when strata have different n.
- Multiple-comparisons correction, if the claim is one of several tests in the same family. Check that the methods section states a correction and that this claim's p-value survives it. The `eval-methodology-playbook` default is Benjamini-Hochberg FDR at alpha = 0.05; `statistical-analysis` covers the alternatives.

### 6. Output the audit table

One row per claim:

| # | Claim (as stated) | Location | Verdict | Corrected value / note | Source |
|---|---|---|---|---|---|

Follow with:

- **Roll-up counts**: total claims, MATCH / CORRECTED / NEW / UNVERIFIABLE.
- **The corrections list**: every CORRECTED claim with old -> new value, in prose, ready to paste into a revision diff.
- **What NOT to claim**: every claim that should be removed or walked back (sign errors, unsupported overclaims), stated plainly.
- **Statistical completeness gaps**: claims missing effect size, CI, n or correction.

Write the table and lists to a file in the project (for example `stats\CLAIMS_AUDIT_<YYYY-MM-DD>.md`) as well as reporting them, so the next audit can start from it.

Do not soften a CORRECTED or remove-worthy verdict to spare the draft. The value of this audit is that it is more adversarial than a journal reviewer. State verdicts plainly, with no hedging language.

## Constraints

- Do not hard-depend on any external MCP or web service for the data checks. They run on file reads (Read, Grep, Glob, Bash for CSV and script inspection) and the project's own data. If Python is needed to recompute a statistic, run the project's existing scripts if present, or a short script if not. Never produce a result by eyeballing a CSV.
- Never invent a citation or a data source that is not actually present. If a claim cannot be traced, it is UNSUPPORTED, not "probably fine."
- If the draft or data location is not given, ask rather than guess.

See `references/audit-conventions.md` for the full verdict taxonomy, the layout reference, the failure-pattern catalog and a worked example row set.
