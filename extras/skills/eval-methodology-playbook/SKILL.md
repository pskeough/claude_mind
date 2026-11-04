---
name: eval-methodology-playbook
description: Field-tested LLM-as-judge and evaluation-design playbook, distilled from several large-N audits (N from about 500 to 28,800) that passed peer review. Use when the user says "design an eval", "build a judge", "LLM-as-judge rubric", "judge protocol", "how should I score this", "severity scoring", "bias controls", "position bias", "verbosity bias", "self-preference bias", "judge circularity", "IRR", "inter-rater reliability", "kappa", "calibrate the judge", "cross-model validation", "how should I evaluate", "multiple comparisons", "FDR correction", or is designing or running any LLM-as-judge audit or benchmark. Encodes continuous severity over binary pass/fail, multi-axis rubrics, cross-model judge validation, human gold-subset calibration, and large-N automated pipeline hygiene.
---

# Eval methodology playbook

This is not a generic "how to build an LLM judge" guide. It is a methodology distilled from several completed large-N LLM-as-judge audits (a sycophancy severity audit at N=8,830, a demographic-bias audit at N=28,800, an explanation-faithfulness audit at N=522) and one large RAG audit. When the user asks for help designing or running an evaluation, use these conventions. Reviewers have accepted them, and deviating from them (reaching for binary pass/fail, skipping cross-model validation, not correcting for multiple comparisons) is a methodological regression, not a simplification.

## The core conventions

1. **Continuous severity scoring, never binary pass/fail.** In the sycophancy audit, binary metrics explained only 29% of behavioral variance and let 93.6% of moderate sycophancy pass filters undetected. A binary judge hides exactly the moderate cases where the signal lives. Default to a Likert or continuous severity scale (typically 1-5) with each band anchored by concrete examples, not just an adjective.
2. **Multi-axis rubrics, not a single quality score.** The explanation-faithfulness audit used four independent axes (Demographic Perception, Faithfulness, Projection Accuracy, Fairwashing Index) because collapsing them hid a 21.1% faithful-but-fairwashing quadrant. If two things can be good or bad independently, they get independent axes.
3. **Cross-model validation of the judge itself**, not just of the subject models. Never trust a single judge family's verdicts as ground truth. See Bias controls below.
4. **Large-N automated pipelines**, run against provider APIs (directly or through an aggregator) on an explicit budget, with the pipeline itself treated as an artifact: idempotent, hash-locked eval sets, re-runnable.
5. **Every judge gets a human-labeled gold subset and a reported inter-rater statistic.** No paper ships without a kappa or an equivalent calibration number.

## Rubric construction

Operationalize the construct before writing a single prompt. For each axis: state the theoretical construct (for example, "sycophancy" is not "agreement"; it is agreement that overrides evidence or the user's stated correction), then write 3-5 severity bands, each anchored with a real response excerpt, not just a label. A rubric that only defines "1 = not sycophantic, 5 = very sycophantic" without worked examples is not usable. The judge will regress to a default, and disagreement with human raters will spike in the middle bands. That is where AI judges under-report: in a sensitivity audit, Level 3 was flagged only 26.3% of the time it should have been, and Level 4 only 38.5%.

Freeze the rubric prompt **byte-for-byte** once validation starts. Any wording change requires re-running calibration. Do not tweak the judge prompt mid-run to fix a spot-check disagreement; that is p-hacking the judge.

See `references/rubric-construction.md` for the full worked template (construct definition, band-anchoring format, failure modes when axes are not independent).

## Severity over binary: the default posture

Unless the user explicitly asks for a screening or triage pass, do not propose binary pass/fail or accept/reject verdicts as the primary metric. If a binary gate is needed operationally (for example a content filter), compute it as a *derived threshold* on the continuous score and report both. Never let the binary gate be the only recorded value, because that throws away the moderate-severity cases.

## Bias controls

Every judge pipeline needs explicit controls for these, in priority order (highest real risk first):

- **Judge circularity / self-preference (family bias).** If the judge model is in the same family as some of the models being judged, this is a live threat to validity, not a hypothetical. One past paper needed a dedicated section on it. Mitigation: run a stratified sample (400+) through at least two independent-family judges (precedent: DeepSeek V3.1 and GPT-5, byte-identical prompt, same voting scheme) and report verdict agreement % and score correlation (Pearson r). Target 90% or higher verdict agreement and r of 0.6 or higher on the primary metric before trusting the primary judge alone. Report the *direction* of any disagreement: if the primary judge is stricter (not more lenient) toward its own family, that is evidence against bias, not for it.
- **Position / order bias.** Run pairwise or multi-response comparisons in **both orders** and require agreement, or use a both-orders consolidation rule. This is not optional for pairwise judging. One judge model showed 73% first-position preference; run in one order only, it would have silently inverted results.
- **Verbosity / length bias.** Quantify it; do not just assert it is controlled. Count tie-flips attributable to length (precedent: a de-verbosity correction step reversed about 14-15 of 20 verbosity-driven ties). Report the correction as a named pipeline step.
- **Evidence-window / recency bias.** For long-context or multi-turn judging, check whether the verdict tracks position in the context window independent of content.
- **Best-of-N consensus voting** as a floor, not a substitute for the above. Default: 3-vote consensus per item (temperature about 0.7) with majority rule, and a documented fallback judge model if the primary hits quota. State both models and the fallback trigger condition in the methods.

See `references/bias-controls.md` for the full checklist with numeric precedents and the reporting table format.

## Calibration against a human-labeled gold subset

Every judge needs a human-labeled subset (precedents: N=186 human annotations for the sycophancy audit; N=200+ stratified items for kappa checks). Compute:

- **Cohen's kappa** (two raters) or **Fleiss' kappa** (3+ raters or judges) between the AI judge and human labels, on the same items and the same scale.
- A **judge-sensitivity table**: P(AI flags | human severity level), broken out by severity band. This surfaces middle-band under-reporting. Do not report only an aggregate kappa; report it stratified.

**The kappa paradox: check this before panicking over a "bad" kappa.** If the base rate is lopsided (for example 99% of items are in the safe/negative class), Fleiss' kappa can fall to moderate even when raw observed agreement is high, because expected chance agreement is already near ceiling. Always report **both** kappa and raw observed agreement side by side, and check the base rate before concluding the judge degraded. Precedent: kappa dropped from 0.88 to 0.49 between model generations while raw agreement *rose* from 88.2% to 91.5%, purely because the newer generation was 99% safe.

**Acceptance thresholds** (working defaults, not a universal law; state them explicitly in methods): kappa of 0.6 or higher (substantial agreement) is the bar for shipping a judge as primary; 0.4-0.6 is usable only with a documented mitigation (for example cross-model corroboration); below 0.4 the judge needs rubric revision before any large-N run.

For the test choice and reporting of agreement statistics, `statistical-analysis` covers kappa and ICC in more depth.

## Cross-model validation

Distinct from the bias-control checks above (which stress-test judge agreement), this validates the *pattern*, not just the judge. Run the pipeline's headline finding through at least one architecturally distinct model family and confirm the pattern replicates in direction even if the magnitude shifts. Precedent: the demographic-bias audit validated across four model families from Google, OpenAI, DeepSeek and Zhipu (GLM) specifically to catch an Eastern/Western divergence that a single-family study would have missed.

## Large-N pipeline hygiene

- Hash-lock the eval set (`eval_set.sha256` alongside `eval_set.jsonl`) so re-runs are provably against identical inputs.
- Every claim in the eventual paper must trace to a script plus a receipt. This is the discipline the `paper-claim-audit` skill checks at the end; treat it as a pipeline requirement from day one, not a pre-submission cleanup task. Write results to a `stats\` folder as both the raw computation output and an interpretation note, paired by name (`analysis1_regression_results.txt` / `analysis1_interpretation.txt`).
- Budget and rate-limit explicitly: provider concurrency caps, retry with backoff, and a documented failure-handling rule (for example "2 or more successful votes required for an item to count in clean N"). Report the successful-call rate and any truncation from quota or credit exhaustion honestly. Do not drop it silently from N reporting. Precedent: one cross-model judge reached only 52% completion mid-run; the paper reported the resulting clean N rather than presenting the run as clean.
- Log cost honestly, including resumed and retried tokens and the judge's own token cost at its actual price. A logging-artifact undercount is a real failure mode: a reported frontier cost of $0.95 was about $14.7 once resumed tokens and judge pricing were counted properly.

## Multiple comparisons

Any pipeline running more than a handful of hypothesis tests needs correction before those p-values go in a paper. Default: **Benjamini-Hochberg FDR** at alpha = 0.05, not Bonferroni, which is overly conservative for exploratory multi-test designs. Report a full table: raw p, adjusted q, survives Y/N, for every test, not just the ones that survive. Nulls that *should* be null (for example bias-check sensitivity analyses) are themselves evidence for judge validity; say so explicitly in the write-up rather than treating non-significance as a gap.

## Methods-section template

`references/methods-section-template.md` has a fillable methods-section skeleton matching the structure used across the source audits: rubric and construct operationalization, judge model plus voting plus fallback, human calibration (N, kappa, stratified sensitivity), bias-control battery with a results table, cross-model validation table, multiple-comparisons statement. Use it as the starting point whenever the user is drafting the Methods section of an eval paper.

## When NOT to over-apply this

For quick exploratory scoring on a handful of examples (not a paper-bound pipeline), do not insist on the full battery. Name the pieces being skipped (for example "skipping cross-model validation since this is N=12 exploratory, not a claim") so the corner-cutting is visible rather than silent.
