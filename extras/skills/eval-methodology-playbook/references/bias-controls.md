# Bias controls: full checklist and reporting format

Priority order reflects what has actually threatened validity in past large-N judge pipelines, highest risk first.

## 1. Judge circularity / self-preference (family bias)

**Threat:** the judge model shares a family or lab with some subject models and may systematically favor or disfavor its own family.

**Control:** a stratified sample (400+ recommended) scored by 2 or more architecturally independent judges (different lab, different training data). Precedent: the primary judge was a Google frontier model; the cross-model judges were DeepSeek V3.1 and GPT-5, with a byte-identical prompt (verify this down to character count; do not just say "the same prompt"), the same temperature, and the same voting scheme (3-vote consensus, verdict by threshold plus majority).

**Report:**

| Judge | Clean N | Agreement with primary | Score correlation (r) |
|---|---|---|---|

Fill one row per judge. Target 90% or higher agreement and r of 0.6 or higher on the primary metric.

Also report disagreement **direction**. If the primary judge is *stricter* toward its own family (scores its family as worse), that is evidence against family bias, not for it. State this explicitly rather than letting the reader assume disagreement means bias. Precedent: the primary judge scored its own family's responses 0.52 points *higher* on sycophancy severity than DeepSeek did (that is, stricter), with 86% of disagreements in the "primary flags, cross-model does not" direction.

**Caveat to report honestly:** cross-model validation confirms judge *methodology* reliability on the sampled subset. It does not by itself confirm that every population-level finding replicates in that subsample if the subsample was not stratified for the specific effect (a rare-event spike may simply not appear in a modest stratified sample). Say so if it is true; do not overclaim.

## 2. Position / order bias

**Threat:** for pairwise or ranked comparisons, the verdict tracks presentation order, not content.

**Control:** run every comparison in both orders, and either require agreement across orders or apply a documented both-orders consolidation rule (for example average the two, or discard or flag disagreements as ties).

**Report:** first-position preference rate per judge model. Precedent: one judge model showed 73% first-position preference uncontrolled; the both-orders design contained it. If both-orders is skipped for cost reasons, say so and report it as an acknowledged limitation, not silently.

## 3. Verbosity / length bias

**Threat:** the judge (or a human) rates longer responses as better independent of content quality.

**Control:** quantify tie-flips attributable to length. For example, take a set of judged ties and check whether length-normalizing the responses (truncating or paraphrasing to equal length) flips the verdict.

**Report:** the count of flips attributable to length, and whether a de-verbosity correction step was applied in the primary pipeline. Precedent: about 14-15 of 20 verbosity-driven ties identified and corrected by design. Report it as a named pipeline step in methods, not a footnote.

## 4. Evidence-window / recency bias

**Threat:** for long-context or multi-turn evaluation, the verdict correlates with position in the context rather than content.

**Control:** where feasible, permute the position of the evidence or response of interest within the context window across a subsample and check verdict stability.

## 5. Consensus voting as a floor

Default: 3-vote consensus per item at moderate temperature (about 0.7, not 0.0; full determinism removes the value of voting). Majority rule for the verdict; document tie-breaking. Document a fallback judge model and its trigger condition (quota, rate limit) so a partial run does not silently mix in an uncontrolled second judge without disclosure.

## Reporting rule

Every pipeline write-up should have a bias-control section with one line per control listing: threat, method, result, and whether it passed the acceptance bar. A control that was not run should say so explicitly ("not run; N/A because ...") rather than being omitted. Omission reads as an oversight, not a decision, if a reviewer later asks.
