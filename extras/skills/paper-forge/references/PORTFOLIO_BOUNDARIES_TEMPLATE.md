# Portfolio boundaries (binding for paper-forge runs)

Use this when two or more of your papers draw on the same data, models or prior work. Copy it into your project, fill it in, and set `boundariesFile` in the args. If you have only one paper, skip it: forge_setup.py writes a stub that tells agents to flag any overlap they notice.

Where a live project file disagrees with this map, the live file wins. If a workflow finds a conflict between this file and a live receipt, it stops that claim and logs it in NEEDS_USER.md. It does not resolve the conflict itself.

Short names: list each paper's short id here (for example A = ..., B = ...).

## 1. Ownership table

| Paper | Status | Venue | People | Owns (its claims) | May cite, must not re-claim | Shared assets |
|---|---|---|---|---|---|---|
| | | | | | | |

## 2. Pairwise overlap rules

For each pair of papers that share data or claims: which paper reports which result first, what the other may say about it (one sentence, cited), and which numbers each may print.

## 3. Retired claims (never reappear)

Claims that were withdrawn or corrected, quoted exactly, with the date and the file that retired them.

## 4. Shared-asset rules

Datasets, prompts, rubrics, labels or model checkpoints used by more than one paper: which paper describes them in full, and how the others refer to them.

## 5. Self-citation rules

Which of your earlier papers or preprints each paper cites, and for what.

## 6. Numbers to recompute

Numbers that appear in more than one paper and must be recomputed from the raw files before reuse.
