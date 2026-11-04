# Audit conventions: full detail

## Project layout reference

The user points the audit at a manuscript and a data/stats folder. Folder names vary; this is the default shape the skill expects:

```
<project>\
  manuscript\   *.tex, *.md, *.pdf          draft(s), possibly multiple dated versions
  data\         *.csv, *.jsonl, *.sha256     raw data + optional hash-lock
  stats\        *.txt, *.csv, *.md           computed results + interpretation notes
                                             (mature projects: CLAIMS_LEDGER.md,
                                             00_MASTER_VALIDATION_REPORT.md,
                                             STATISTICAL_SUPPLEMENT_VALIDATED.md,
                                             FDR_CORRECTION_REPORT.md; read these first)
  scripts\      *.py, *.R, *.ipynb           code that produced stats\
  figures\      *.png, *.pdf                 generated plots and tables
```

If the project uses different names (`results\`, `analysis\`, `output\`), map them to these roles and say which folder plays which role at the top of the audit. If it is unclear which project a draft belongs to, ask.

A useful convention, where it exists: the stats folder pairs a raw output file with an interpretation file for each analysis, for example `analysis1_regression_results.txt` + `analysis1_interpretation.txt`. When recomputing, check whether the interpretation file's prose matches its own paired raw output. Mismatches there are real and cheap to catch.

## Verdict taxonomy (exact definitions)

**MATCH**: the claim as stated in the draft is fully supported. The cited or computed value reproduces within reporting precision, the direction is correct, and no material caveat is missing. A MATCH still gets a row in the table; silence is not evidence that a check was done.

**CORRECTED**: the claim's *direction* or general thrust survives, but the specific value is wrong. Always state old value -> corrected value, and the receipt (script, file or recomputation) backing the correction. A correction does not need to be catastrophic to count: third-decimal drift from a re-run at a different snapshot still gets logged as CORRECTED if it is asserted as a load-bearing precise number, even if no conclusion changes. In the notes, distinguish "cosmetic" corrections (no conclusion changes) from "structural" ones (the claim reads differently once the value is right: bands, thresholds, or comparisons crossing a stated boundary).

**NEW**: the audit surfaced a supportable finding the draft does not currently claim. Log these separately as *potential additions*, not corrections. They need the author's decision, not an automatic edit. Precedent: a permutation test was not in the original draft but robustly reproduced the headline interaction under clustering. It was logged as NEW and offered as a strengthener, not inserted silently into the text.

**UNVERIFIABLE / retired**: cannot be checked with what is in the project (needs data never captured, such as logprobs for calibration curves, or a measurement never taken, such as latency). Two sub-cases:
- *Never claimed, and should not be*: no action; note it is out of scope.
- *Claimed in the draft but unverifiable*: flag for removal or explicit reframing as an assumption ("we did not measure X; Y is an assumption, not a finding"). Do not let an unverifiable claim stay in the draft phrased as if it were measured.

**UNSUPPORTED** (from step 2, no source at all) is counted with UNVERIFIABLE in the roll-up and always appears under "What NOT to claim."

## Failure-pattern catalog (ranked by real frequency in past audits)

1. **Sign errors.** A claim states a direction opposite to what the current data shows. Always recompute direction independently; do not eyeball whether a number is "in the right ballpark." A prior "fix" to a wrong claim can itself be wrong, so re-derive from raw data rather than trusting an existing corrected file if there is any doubt.
2. **Stale subset or silently smaller n.** A cached stats file was computed on an old data pull and the current raw data has grown. Check the n embedded in (or inferable from) a stats file against the current row count of the source file.
3. **Logging or accounting artifacts in cost or count claims.** Check unit prices, whether retried or resumed calls were counted, and whether the "total" in a summary file actually sums its own line items.
4. **Non-convergent values reported as point estimates.** Common in ranking methods such as Bradley-Terry, where an item that never lost a comparison has an undefined or diverging strength at finite iterations. Check whether the fit converged for every reported value, not just whether it produced *a* number.
5. **Threshold or band-edge rounding.** A value stated as inside a "safe" range when it is at or past the edge. Recompute the exact value and compare it to the literal stated range, not the implied one.
6. **Third-decimal snapshot drift.** Lowest severity. Log it; treat it as a defect only if it crosses a significance or band threshold.

## Worked example row set (format reference; values illustrate the format only)

| # | Claim (as stated) | Location | Verdict | Corrected value / note | Source |
|---|---|---|---|---|---|
| C1 | "Error rate correlates with model generation (rho rising 0.30 to 0.50 across generations)" | Abstract | MATCH | Reproduces exactly from `analysis3_correlation_by_generation.csv` | stats\ |
| C2 | "RAG abstains slightly more on unanswerable questions (36/98 vs 42/98)" | Sec. 4.2 | CORRECTED: sign backwards | Scripted classifier: RAG abstains far LESS (62/98 -> 17/98); replace with the corrected mechanism finding | stats\F12 receipt |
| C3 | "Frontier closed-book cost about $0.95 for the full run" | Sec. 6, cost table | CORRECTED | Honest cost about $14.7 (missed ~3.4M resumed tokens; judge price 6.7-10x too low) | recomputed from raw logs |
| C4 | "Gold-anchor items score 192.8/275.0/301.1" | Sec. 5, Table 4 | CORRECTED | Non-convergent (never beaten): report as lower bounds at the stated n_iter, not point values | Bradley-Terry fit diagnostics |
| C5 | "Judges show no measurable position bias" | Sec. 7, limitations | UNSUPPORTED: remove or add evidence | No both-orders check present for this judge; run it or reframe as untested | none found |

Use this shape. Adapt columns only if the draft's citation style needs an extra column (for example an external citation key vs. an internal data source). Do not drop columns.
