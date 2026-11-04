# Paper types and venue constraints

Pick the skeleton, then the Discussion style. Templates marked (source) follow cited guidance; (synthesis) means no single source states that order, so check it against the target journal.

## T1. Empirical paper, IMRaD (source: S1, S7, S11, S12, S8)

1. Title carrying the one contribution.
2. Abstract: context, gap, "here we", results, implication.
3. Introduction: field gap, specific gap, last paragraph says what was done and found, contributions with forward references.
4. Methods: repeatable detail with reasons, in the order the participant or pipeline experiences it. One setup table.
5. Results: declarative subheadings; each paragraph question, evidence, answer; first paragraph gives the method gist; failures and exploratory analyses labelled.
6. Discussion: principal findings in words; strengths and weaknesses; relation to other studies; meaning and implications; open questions.

Reader expects a clear gap, a method they can trust, claims that match the data, and honest limits.

## T2. Methods, tool or pipeline paper, including a BRM Tutorial (source: S15, S16, S17; the BRM order is synthesis)

1. Title naming the tool and what it lets the reader do.
2. Abstract for a non-specialist.
3. Statement of need: who has what problem, what exists, why build rather than contribute.
4. Design: choices and trade-offs, not an API listing.
5. Worked example or case study on a real question; validation numbers support it.
6. Evidence of use; availability of code, data and materials.
7. Discussion: limits, when not to use it, extensions.

BRM Tutorials add a step-by-step guide and are expected to meet TOP Level 2 transparency. JOSS papers are 750 to 1,750 words with their own required sections and no new results.

## T3. Benchmark or evaluation paper (synthesis from S18, S5, S1)

1. Title and abstract: what is measured, why current measures fall short, what the benchmark shows (finding first).
2. Introduction: the measurement gap; contributions list.
3. Design: construct, items, scoring, reason for each choice; documentation and access.
4. Evaluation setup: models, settings, controls.
5. Results as findings: validity checks first, then the main comparison, then what explains the pattern.
6. Discussion: what the findings mean for using or trusting these systems; construct limits; maintenance and release.

## T4. Practitioner guide: build it, check it, recommend (synthesis from S15 tutorial scope, S17, S1)

1. The practitioner's problem and the decision they face.
2. The recommended approach in plain words, with one worked example.
3. How to build it.
4. How to check it works, with a small number of evidence numbers.
5. Recommendations by situation, then caveats and limits.

No source gives an order for practitioner guides. BRM's Tutorial scope and S17's "publish for users" are the nearest.

## T5. Short report (UNVERIFIED structure)

No primary source on short-report structure was read. Working pattern (judgment): compressed T1 with one claim, one figure and a two-paragraph Discussion. Check the venue's article types first; BRM lists no brief-report type.

## Hybrid: empirical skeleton, practitioner Discussion (judgment; the an earlier paper pattern)

Use when the evidence is a comparative study but the reader is a group making a deployment decision.

- Introduction ends on the reader's questions, which become the Results halves in the same order.
- Method is T1, stated once, with the practical constraint (for an earlier paper, one 16 GB consumer card) in the first setup paragraph.
- Results come in mirrored halves, each ending on what the option costs under the practical constraint.
- Discussion: findings in words, then what each finding means against prior work, then recommendations by situation (for an earlier paper, by card size), then limitations, then open questions. Numbers stay in Results.

## Venue constraints

| Venue | Abstract | Body and floats | Required pieces | Status |
|---|---|---|---|---|
| Behavior Research Methods | at most 250 words | sections "appropriate for their content"; APA 7 | data availability statement for original research; Tutorials at TOP Level 2 | Verified, Springer page read 14 Oct 2026 |
| Information Processing & Management | about 250 words per a third-party template | unknown | CRediT statement per the same template | UNVERIFIED: the Elsevier guide returned 403. Read the live guide before fixing the structure. |
| JOSS | Summary for a non-specialist | 750 to 1,750 words | statement of need, state of the field, software design, research impact, AI usage disclosure | Verified (living docs) |
| NeurIPS Datasets and Benchmarks | n/a | n/a | documentation, reproducibility, accessibility; reviewable code and data | Verified for the 2025 blog only |
| A tested budget | at most three claims, one number per sentence | an earlier paper: about 5,000 words, at most 4 tables, appendix to supplement | AI disclosure that describes the actual process | House |
