# Structural checklist

Rule IDs used in audits. Each rule names its source code (see `sources.md`) and a status:

- **Sourced**: the source states it and the text was read (most re-opened 14 Oct 2026).
- **House**: a rule from the original author's own papers and reviews. Treat it as a strong default, not an authority.
- **Judgment**: synthesis with no single source. Apply it, but do not cite it as an authority to the user or a reviewer.

Sections S to P apply to outlines and drafts. Section F applies only at the prose stage and is passed to mimesis, not reported in an outline audit.

## Contents
- S. Claim and story
- A. Abstract and introduction
- M. Method
- R. Results
- D. Discussion and limitations
- P. House rules
- F. Prose stage (not for outline audits)
- X. Process tests
- Failure-mode map

## S. Claim and story

| ID | Rule | Fix when violated | Source | Status |
|---|---|---|---|---|
| S-1 | One central contribution, statable in one sentence; the title and abstract both carry it. | Write the sentence; re-point the title and abstract to it. | S1, S3 | Sourced |
| S-2 | One to three claims that fit one theme. Anything else is cut or moved to a second paper or the supplement. | Name the claims; list what moves out. | S5, S6, S1 | Sourced |
| S-3 | Contributions are refutable findings with scope, listed at the end of the introduction, each forward-referenced to the section that shows it. Every forward reference resolves. | Rewrite topic-style contributions ("we study X") as findings; fix dead or wrong section pointers. | S3, S4 | Sourced |
| S-4 | Every paragraph has a role you can name in one line. A paragraph with no nameable role is deleted. | Reduce each paragraph to one line; cut the ones with no claim. | S1, S5 | Sourced |
| S-5 | Tell the story of the results, not the order in which the work was done. | Reorder by claim; remove "first we tried" narration. | S1, S3, S4 | Sourced |
| S-6 | Each subject sits in one place. Only the central idea recurs. Parallel points get parallel form. (Mensh and Kording call the violation zig-zag.) | Merge the scattered pieces into the one paragraph where the subject lives. | S1, S6 | Sourced |
| S-7 | Results follow the claims in the order the introduction states them. | Reorder Results, or reorder the contribution list, so they match. | Judgment from S1 rule 4 and S3 forward references | Judgment |
| S-8 | The whole paper can be told to a colleague in a few minutes. | If it cannot, return to S-1 and S-2. | S1 | Sourced |

## A. Abstract and introduction

| ID | Rule | Fix | Source | Status |
|---|---|---|---|---|
| A-1 | Abstract order: context, gap, "here we" with approach, results in 1 to 3 sentences, implication. | Reorder sentences into the five slots. | S1, S11 | Sourced |
| A-2 | Abstract makes at most three claims, with at most one number per sentence. | Cut claims to the 1 to 3 from S-2; move extra numbers to Results. | author's submission checklist | House |
| A-3 | Abstract length within the venue cap. BRM: 250 words. IP&M: unknown until the live guide is read. | Trim; mark UNVERIFIED caps as such. | S15 | Sourced (BRM only) |
| A-4 | Abstract numbers limited to the headline one or two. Nature says avoid numbers; Gernsbacher reportedly says include sample and summary statistics. Choose per venue. | Keep the headline number only. | S10; S7 is paraphrase | Judgment |
| A-5 | Introduction narrows from the field gap to the specific gap, then the last paragraph says what the paper does and finds. It answers: the problem, why it matters, why it is hard, why it is unsolved, the approach and result with limits. | Add the missing step; move literature detail out. | S1, S4 | Sourced |
| A-6 | Novelty and gap claims match the evidence for them. "No study has" needs a search behind it; otherwise "prior comparisons rarely". | Soften to what the field check supports. | S5 ("inform, not persuade") | Sourced |
| A-7 | Related work is short, placed after or alongside the idea, and is not a literature dump. Each paragraph says what prior work found and stops; the gap is stated once, in the introduction. | Cut repeated "we extend" tails; keep the gap in one place. | S3, S4, S1 | Sourced |
| A-8 | No "the rest of this paper is organised as follows" roadmap. | Replace with forward references at the claims. | S3, S13 | Sourced |
| A-9 | Written for a reader who does not know the work: terms defined, few acronyms. | Define on first use or cut the acronym. | S1 | Sourced |

## M. Method

| ID | Rule | Fix | Source | Status |
|---|---|---|---|---|
| M-1 | Method is repeatable and gives the reason for each non-obvious choice. It holds no results. A check's design goes in Method; its outcome goes in Results. | Move outcomes to Results; keep one-sentence reasons. | S12 | Sourced |
| M-2 | Setup details (models, sizes, hardware, collections, settings) are stated once, in Method, with one setup table listing every model including question and prompt generators. Abstract and introduction describe the approach in words. | Strip setup lists from abstract and introduction; complete Table 1. | S1 rule 4; author's submission checklist | Sourced + House |
| M-3 | Tool or pipeline papers: design choices and trade-offs in the paper; usage documentation elsewhere. | Move API or command detail to the repository. | S16, S17 | Sourced |
| M-4 | A justification that needs its own figure usually belongs in the supplement unless a claim depends on it. | One sentence of reason in Method; figure to supplement. | an earlier paper's review ("audit vibes") | House |

## R. Results

| ID | Rule | Fix | Source | Status |
|---|---|---|---|---|
| R-1 | Subsection headings are declarative findings; read in order, they are the argument. A topic label or a truism is not a finding. | Rewrite the heading as what the data showed. | S1 | Sourced |
| R-2 | Each paragraph: the question it answers, the evidence, then a one-sentence answer. | Restructure the paragraph line. | S1 | Sourced |
| R-3 | Results report what the data show; why and so-what go to the Discussion. (UNC and Mensh-Kording differ here; this reconciliation is judgment.) | Move interpretation to Discussion. | S12, S1 | Sourced + judgment |
| R-4 | Be selective: show the data that bear on the claims, not everything collected. | Cut or move to supplement. | S12, S5 | Sourced |
| R-5 | Do not repeat a table's or figure's numbers in prose; state the pattern and point to the float. | Keep one number; point to the float for the rest. | S12 | Sourced |
| R-6 | Figure and table titles state the conclusion. Every float is called out by number in a body paragraph at the claim it supports. | Add callouts; retitle floats. | S1, S6; author's submission checklist | Sourced + House |
| R-7 | The first Results paragraph gives the gist of the method, because many readers skip Methods. | Add one sentence of gist to the opening line. | S1 | Sourced |
| R-8 | Exclusions, deviations, failed arms and exploratory analyses are reported and labelled. | Add the line; label exploratory. | S7 (paraphrase) | Judgment |
| R-9 | A validation of a result sits next to that result. | Move it adjacent. | S1 rule 4 | Sourced |

## D. Discussion and limitations

| ID | Rule | Fix | Source | Status |
|---|---|---|---|---|
| D-1 | The first paragraph restates the principal findings in words, focused on meaning, with no numbers. | Rewrite as findings in words. | S1, S8 | Sourced |
| D-2 | Order: principal findings; strengths and weaknesses of the study; strengths and weaknesses relative to other studies; meaning and implications; unanswered questions and future research. | Reorder; add the missing part. | S8 | Sourced (PMC text read 14 Oct) |
| D-3 | Each limitation says what it is, how it could have affected the result, and what would address it. One limitation per paragraph when it bears on a main claim. | Split inventory paragraphs; add the effect on the result. | S5, S14 (the what/effect/fix split is judgment) | Sourced + judgment |
| D-4 | Verbs match the evidence ("supports", "suggests"; not "proves", "caught" when the cause is unsettled). | Soften, or settle the cause first. | S5 ("avoid the trap of overclaiming") | Sourced |
| D-5 | Ends with what readers can now do and the open questions. | Add the recommendations and open questions. | S12, S1, S8 | Sourced |
| D-6 | Neither the Discussion nor the Conclusion repeats the abstract or introduction. | Cut the repeat, or replace the Conclusion with the open question. | S4 | Sourced |
| D-7 | Discussion lines carry no new numbers; at most a pointer to the section that has the number. | Replace numbers with pointers. | author's review notes | House |
| D-8 | A subject is covered in Results or Limitations, not both in full. Results state the fact; Limitations say how it bounds the claims. | Merge or split cleanly. | S1 rule 4 | Sourced |

## P. House rules

| ID | Rule | Memory |
|---|---|---|
| P-1 | No version talk: no "v5", "previously reported", "corrected", "earlier draft". Conditions are named by what they are. | author's review notes |
| P-2 | No build or software labels in the paper ("measured on build X"). Hardware numbers come from one measurement campaign. | author's review notes |
| P-3 | Weak arms are reported honestly for what they show, without a confessional tone or overstatement. | author's review notes |
| P-4 | One number per outline paragraph; one number per abstract sentence. | author's review notes; author's submission checklist |
| P-5 | Length and float budget set before outlining (an earlier paper: body about 5,000 words, at most 4 tables, appendix to a supplementary file). Density and coverage are not goals. | author's review notes |
| P-6 | Headings and claim lines avoid the banned shapes: antithesis ("X, not Y"; "not a X but a Y"), punchy line then reversal, aphorism closers, "which means", "the point is". | author's review notes |
| P-7 | In a practitioner paper, every section answers one of the reader's questions. Name the specific setup (e.g. the exact GPU) once, in Method; elsewhere the practical constraint appears only where it carries a result (what fits, how long it takes), never as a restated label. Frame hardware as "what we used", with what fits smaller setups, not as a requirement. | author's review notes |
| P-8 | Argument sections (Discussion, Conclusion) are built from the author's own answers to two or three questions, in the author's order. No template literature layer the author did not ask for. | author's review notes |
| P-9 | A cold reader can say the claim back after the abstract. | author's submission checklist |

## F. Prose stage (pass to mimesis; do not report in outline audits)

| ID | Rule | Source | Status |
|---|---|---|---|
| F-1 | Old, linking information at the start of a sentence; new information at the end. | S2, S13 | Sourced |
| F-2 | One point per paragraph; subject near its verb; actions in verbs, not nominalizations. | S2, S13 | Sourced |
| F-3 | One term per concept for the whole paper. (Exception: it also applies to outlines, since the outline sets the terms.) | S1 | Sourced |
| F-4 | Context, content, conclusion at paragraph level; first and last sentences agree. | S1, S13 | Sourced |
| F-5 | Cull "very", "it should be noted", "utilize" and similar. | S13 | Sourced |
| F-6 | Short sentences, one idea each; paragraphs of about five sentences; 15 to 20 words per sentence. | S7 via WebFetch paraphrase | Judgment, re-verify before citing |
| F-7 | Research prose under about 7 copulas per 1,000 words; no long-then-short verdict rhythm; avoid runs of sentences opening "The". | author's review notes | House |

## X. Process tests

| ID | Test | Source | Status |
|---|---|---|---|
| X-1 | Hand the outline or draft to a naive reader and ask where they got lost; read aloud. | S13, S3; S7 paraphrase | Sourced |
| X-2 | When a paragraph is bad, rewrite it from its outline line instead of patching it. | S1 | Sourced |
| X-3 | Spend about equal effort on abstract, introduction, figures and the rest. | S5, S1 | Sourced |

## Failure-mode map (judgment)

| The author's complaint | Rules to check first |
|---|---|
| Over-technical, dense | A-9, M-2, M-4, P-5, R-4 |
| Number-dumping, audit-like | P-4, R-5, D-1, D-7, M-4, A-2 |
| No story | S-1, S-3, S-5, R-1, R-2 |
| No real Discussion | D-1 to D-6, P-8 |
| Claims in the wrong order | S-6, S-7, R-9, S-3 |
| Reads like an audit or apology | P-1, P-2, P-3, M-4 |
| Practical angle missing | P-7, D-5 |

Not found in any source: a numeric rule for how often to restate setup details. M-2 and S-6 are the nearest.
