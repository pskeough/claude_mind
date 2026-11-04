---
name: paper-structure
description: Structure a research paper before any prose is written. Picks the paper type and venue limits, pins the central contribution and its 1 to 3 claims, asks only the questions that change the structure, builds a paragraph-by-paragraph claim outline (one claim, evidence, at most one number each; findings as Results headings; a real Discussion) and audits an outline or draft against a sourced checklist. Use whenever the user says "structure this paper", "outline the paper", "paper outline", "paper shape", "restructure", "reorder the claims", "the paper feels off", "too technical", "too dense", "results dump", "reads like an audit", "where should the discussion go", "there's no discussion", or starts drafting any paper section (abstract, introduction, results, discussion), even when they only ask for prose. NOT for writing the sentences (that is the author, or mimesis in their research voice), NOT for checking numbers against data (paper-claim-audit), and NOT for rebuilding a paper from raw data end to end (paper-forge).
---

# Paper structure

AI-drafted papers get rejected by their own authors for the same reasons every time: over-technical, dense, number-dumping, audit-like, claims in the wrong order, no real Discussion. Rewriting the prose again does not fix that. What works is agreeing a paragraph-by-paragraph claim outline first; the author can then write or rewrite every sentence, so the job here is the structure, the order of claims and correct numbers. Prose quality is not this skill's job.

The working rule: no prose until the user has approved the outline.

## Where this sits next to the other paper tools

| Need | Use |
|---|---|
| Shape of the paper, claim order, outline, structural audit of an outline or draft | this skill |
| Sentences in the author's research voice, after the outline is approved | mimesis MCP with the research voice, if installed |
| Do the numbers in the draft match the data and receipts | paper-claim-audit |
| Whole pipeline from raw data to a draft, with literature and venue choice | paper-forge (its plan stage can run this skill's audit on the plan) |
| Which statistical test or effect size | statistical-analysis |

This skill reads numbers; it never produces them. If a number in the outline looks wrong, flag it with CHECK and hand it to paper-claim-audit.

## Before starting

1. Find what already exists: the current draft or outline, any numbers sheet, the latest plan note, and the user's framing notes. If Claude Mind is installed, search it (`search_memory`) for the paper name.
2. Read `references/checklist.md` once per session. The audit cites its rule IDs.
3. Do not touch the paper's own files unless the user asks. Write outlines and audits to a notes folder next to the paper.

## Step 1. Paper type and venue

Pick one type from `references/paper-types.md`: empirical (T1), methods or tool (T2), benchmark or evaluation (T3), practitioner guide (T4), short report (T5). Mixed papers are common; name the skeleton and the Discussion style separately (for example a T1 skeleton with a T4 Discussion).

Record the venue constraints that change structure: abstract word cap, body word budget, table and figure limits, required sections (data availability, AI disclosure, Conclusion heading), and article type. When the venue guide has not been read, say so and mark the constraint UNVERIFIED rather than guessing.

## Step 2. Central contribution and claims

Write the one central contribution as one plain sentence a stranger could repeat (rule S-1). Then list 1 to 3 claims (rule S-2). Each claim is a finding with scope, stated so it could be wrong (rule S-3), not a topic ("we study judging").

Everything in the paper serves one of these claims or the setup needed to trust them. Material that serves none goes to the supplement or a second paper. Tell the user what you would cut and why; do not cut silently.

## Step 3. Ask only the questions that change the structure

Ask before drafting the outline. Ask a question only if the two plausible answers would produce different outlines. Three to five questions is normal; more means the material is not ready. Typical structure-changing questions:

- Which reader is this for, and what decision do they face? (Sets the order of Results and the Discussion style.)
- Which of the candidate claims is the headline, and which are supporting?
- Is a named weak or failed arm a finding in its own right, a limitation, or supplement material?
- Does the venue require a separate Conclusion or Limitations heading?
- Is the title meant to carry the contribution or name the topics?
- Where a result has two readings, which reading does the evidence support?

Do not ask about wording, tone or citations at this stage. For the Discussion, ask the user the two or three questions it must answer and build the Discussion lines from their answers, in their order. A template Discussion is the thing authors reject.

When running as a subagent or with no one to ask, write the questions at the top of the deliverable, make the most conservative assumption for each, and mark every line that depends on an assumption with ASSUMED.

## Step 4. The outline

One line per paragraph. Each line carries: the paragraph's single claim, the evidence, and at most one number. Use this format exactly:

```
# <Paper short name>: outline, paragraph by paragraph (<date>)

Central contribution: <one sentence>
Claims: (1) ... (2) ... (3) ...
Type and venue: <T#>, <journal>; abstract <cap>; body <budget>; <table/figure limits>
Numbers trace to <numbers sheet>. CHECK = needs one more look. PENDING = result not in yet. ASSUMED = depends on an open question.

## Abstract (<n> sentences, about <n> words)
- A1 Context. ...
## 1. Introduction
- 1.1 <claim>. Evidence: <...>. Number: <one, or none>.
## 4. Results: <half or theme>
- 4.1 <heading stated as the finding>. Evidence: <...>. Figure/Table <n>. Number: <one>.
## Discussion
- 6.1 Principal findings in words. ...
## Figures and tables (body)
- Table 1: ... (called out in 3.0)
```

What the outline must get right, with the rule behind each:

- Results headings are declarative findings that, read in order, are the argument (R-1). A heading that only names a topic ("Judge speed") or states a truism ("Smaller judges are faster") is not a finding.
- Results order follows the claims in the order the introduction states them (S-7), and each subject sits in one place (S-6). A validation of a result sits next to the result, not three paragraphs later.
- One number per paragraph (P-4). Other numbers go to the figure, the table, the Method (for settings) or the supplement. Say where each displaced number went.
- Setup details (models, sizes, hardware, collections, settings) are stated once, in the Method and Table 1 (M-2). The abstract and introduction describe the approach in words.
- Results report what the data show; Methods hold no results (M-1, R-3). A pre-registered check's design goes in Method and its outcome in Results.
- The Discussion follows Docherty and Smith (D-2): principal findings in words, strengths and weaknesses, relation to other studies, meaning and what readers can do, open questions. Discussion lines carry no new numbers, only a pointer to the section that has them (D-7).
- Every table and figure is called out in a body paragraph (R-6), and the float list respects the venue limit.
- Weak arms are stated plainly as what they show (P-3). No version history, no build labels (P-1, P-2).
- In a practitioner paper the reader's question and the hardware or cost constraint appear in every major section, not in one paragraph (P-7).

Keep every CHECK and PENDING marker from the source. Never invent a number, a citation or a result. Moving a number to another paragraph is fine and should be noted in the change log.

## Step 5. Structural audit

Run the audit on the outline you just built, or on an existing outline or draft the user hands you. Read the whole thing first, then walk `references/checklist.md` section by section. Report only violations, ordered by how much they change the paper. Format:

```
# Structural audit: <paper> (<date>)
Checked against references/checklist.md. <n> violations; <n> questions for the author.

| # | Where | Rule | Problem | Fix |
|---|---|---|---|---|
| 1 | 4.7 | S-6 | Expert check of the main result sits after the secondary results | Move to sit after 4.1 |

Questions before prose: 1. ... 2. ...
Holds up: <one line on what already passes, so it is not changed by accident>
```

One row per violation, each under about 40 words. Cite the rule ID; the reference file holds the source. Do not pad the audit with style notes that belong to the prose stage (rules F-1 to F-7).

When auditing a full draft rather than an outline, first reduce the draft to one line per paragraph (the claim each paragraph makes, or "no claim"), then audit that reduction. The reduction itself is useful: it shows where paragraphs carry no claim.

## Step 6. Revised outline and change log

When revising an existing outline, write three files next to it: the audit, the revised outline in the same format, and a before-and-after table. Keep the table readable on a phone: four short columns (Section, Before, After, Rule), each cell a few words. Group by section in paper order.

Then stop and wait for the user's approval. After approval, prose is written section by section with the approved outline line as the content for each paragraph. This skill does not draft prose.

## Writing the outline itself

The outline is a working document, not prose, but the author reads every line. Flat declarative phrases. No em dashes. No antithesis in headings or claim lines ("X, not Y"; "not a X but a Y"), no aphorism closers, no "which means" or "the point is" (P-6). Use the same term for the same thing throughout (F-3), because the outline sets the terms the prose will use.

## Lessons from a paper that went wrong first

- Density was the failure, not missing content. A 52-page rewrite read as bloated; the fix was a 5,000-word body cap, at most 4 tables and an appendix moved to a supplementary file. Set the budget in Step 1.
- Methods that justify every choice with a figure read as an audit. A non-obvious choice gets one sentence of reason; the figure goes to the supplement unless a claim depends on it.
- A Discussion that restates Results with numbers is not a Discussion. It interprets, relates to prior work, and tells the reader what to do.
- The author's own framing beats the template. Ask for it in Step 3 rather than imposing T1.

## Reference files

- `references/checklist.md`: the rule IDs used in audits, each with its source and whether it is sourced, a house rule, or judgment. Includes the failure-mode map.
- `references/paper-types.md`: the five section templates, venue constraints (verified and unverified), and the hybrid pattern.
- `references/sources.md`: the sources, what each contributes, and verification status.
