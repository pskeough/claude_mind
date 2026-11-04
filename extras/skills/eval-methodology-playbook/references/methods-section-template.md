# Methods-section template

Fillable skeleton matching the structure used across the source audits. Delete sections that do not apply; do not add sections that dilute this structure without reason.

---

## [N.1] Rubric and construct operationalization

- State the construct(s) being measured and what they are explicitly distinguished from.
- State the scale: continuous or Likert severity (default), not binary, with N bands.
- State the number of axes and, if multi-axis, why they are independent (one sentence per axis minimum, with a divergent example if the independence is not obvious).
- State that the rubric prompt was frozen after calibration; give the freeze date or version.

## [N.2] Judge model, voting, and fallback

- Primary judge model plus version or snapshot.
- Voting scheme (for example 3-vote consensus, temperature X, majority rule, tie-break rule).
- Fallback judge model and the exact trigger condition (quota, rate limit, timeout).
- Total API calls, successful-call rate, and how partial failures were handled (minimum successful votes required for inclusion in "clean N").

## [N.3] Human calibration

- N human-labeled items and sampling method (random or stratified; state the strata).
- Inter-rater statistic: Cohen's kappa (2 raters) or Fleiss' kappa (3+), with raw observed agreement reported alongside kappa, not instead of it.
- Stratified sensitivity table: P(judge flags | human severity level) per band, to surface middle-band under- or over-reporting.
- The acceptance threshold, stated explicitly, and whether it was met.
- If kappa is unexpectedly low, check and report the base-rate (kappa paradox) explanation before concluding the judge failed (see the eval-methodology-playbook body).

## [N.4] Bias-control battery

One line per control (judge circularity, position bias, verbosity bias, evidence-window bias), each with: threat description, control method, quantitative result, pass/fail against a stated bar. Table format preferred (see references/bias-controls.md for the reporting table).

## [N.5] Cross-model validation

- Independent model families used to replicate the headline finding (the substantive pattern, not just judge agreement).
- Table: family, N, direction of replication, magnitude if it differs.
- An explicit statement of what this validates (methodology, pattern direction) and what it does not (exact population-level magnitude in a modest stratified subsample).

## [N.6] Multiple comparisons

- Total number of hypothesis tests run.
- Correction method (default: Benjamini-Hochberg FDR, alpha = 0.05) and why (vs. Bonferroni: less conservative, appropriate for an exploratory multi-test design; state this reasoning).
- Full table: test, raw p, adjusted q, survives Y/N, for every test including nulls.
- One sentence noting which nulls were *expected* and *desirable* (for example bias-check sensitivity analyses that should be non-significant) as positive evidence for judge validity.

## [N.7] Pipeline hygiene

- Eval set size and hash-lock reference.
- Cost: an honest total, broken out by generation vs. judging, including any correction to an earlier logging artifact if one occurred.
- Reproducibility: script plus receipt discipline, and a pointer to where raw outputs and interpretation notes live (for example a `stats\` folder with paired result and interpretation files).
