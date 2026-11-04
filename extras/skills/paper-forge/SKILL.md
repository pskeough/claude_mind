---
name: paper-forge
description: Rebuild a research paper from its data to a submission-ready draft with a two-part Workflow run - inventory, re-derived results with receipts, literature, interpretation, Q1 venue choice, exemplar-shaped planning, drafting (through the mimesis voice engine when it is connected), review lenses with one adjudicator, and a submission plan. Defaults to Sonnet throughout for a Pro plan. Use when the user says "paper forge", "forge this paper", "rebuild the paper from the data", "write up my project as a paper", "write up <project> as a paper", "run the paper pipeline", or asks for a full paper workflow on one of their research projects. NOT for editing an existing draft line by line (use the main chat), and NOT for a pre-submission audit alone (use paper-claim-audit).
---

# Paper forge

Two workflows per paper, with the main chat in between:

```
forge_setup.py args.json            freeze inputs verbatim into <outDir>/input/
forge_ground.js  (Workflow, args)   inventory -> premise -> analysis + literature -> receipts -> interpretation -> venue
main chat                           read PREMISE/INTERPRETATION/EXPERIMENTS; run RUN-TONIGHT experiments (under a GPU lease if GPUs are shared)
forge_write.js   (Workflow, args)   exemplars -> plan -> figures -> draft -> assemble -> review -> submission plan
```

## Paths used in this file

- `<SKILL>` is this skill folder, normally `%USERPROFILE%\.claude\skills\paper-forge\` on Windows (`~/.claude/skills/paper-forge/` elsewhere).
- `<projectDir>` is the user's paper project folder: the data, scripts, notes and any earlier drafts.
- `<outDir>` is the run folder, by convention `<projectDir>\paper_forge_<date>`. Every agent writes only inside it.

Files: `<SKILL>/workflows/forge_ground.js`, `<SKILL>/workflows/forge_write.js`, `<SKILL>/scripts/forge_setup.py`, `<SKILL>/scripts/gpu_lease.py` (optional), `<SKILL>/references/PAPER_LESSONS.md` (the 11-rule gate), `<SKILL>/references/PORTFOLIO_BOUNDARIES_TEMPLATE.md`, `<SKILL>/references/args.example.json`.

Launch each workflow with `Workflow({scriptPath: <copy in the run folder>, args: <the args object>})`. Copy the two scripts into `<outDir>/` first so the run folder holds the exact script that ran.

## Steps

1. Copy `references/args.example.json` into the project, fill it in, and save it (for example `<projectDir>\forge_args.json`).
2. `python -u <SKILL>/scripts/forge_setup.py <projectDir>\forge_args.json` creates `<outDir>` and freezes the inputs.
3. Copy `forge_ground.js` and `forge_write.js` into `<outDir>`. Launch part A with the parsed args object.
4. In the main chat, read `PREMISE.md`, `INTERPRETATION.md`, `CLAIMS.md` and `EXPERIMENTS.md`. Run any RUN-TONIGHT experiment from the main chat, log it in `<outDir>/experiments/`, then launch part B.
5. Do the "After a run" checks below and report.

## Args file

JSON with: `slug`, `title`, `date`, `projectDir`, `outDir`, `papers` [{`id`, `working_title`, `anchor_premise`}], `collaborators`, `decisionFiles` (quoted verbatim into every prompt via `input/DECISIONS_VERBATIM.md`), `receiptHints`, `hardLimits`, `sensitivity`, `venueHints`, `notes`. Give `projectDir` and `outDir` as absolute paths: the workflows use them as written. Optional: `author` (name used in prompts; default "the user"), `owner` (short id such as P1 for the GPU board), `boundariesFile` (a filled-in portfolio boundaries file), `lessonsFile` (defaults to `references/PAPER_LESSONS.md`), `priorPapers` (paths to the user's earlier papers, read for tone and evaluation method), `mimesis` ("auto" or "off"; default "auto"), `voice` (mimesis voice name; default "research"), `voiceFeedbackFile` (a file of the user's own verbatim feedback on AI prose, read by the prose lens), `runLogFile` (a Markdown table the final step appends one row to), `bigModel` (model for the judgement stages; default "sonnet", see Plan limits). Pass the parsed object as `args`, never a JSON string.

## Plan limits (read before launching)

A forge run is large: part A is about 20-25 agents and part B about 25-30 per paper. On a Claude Pro plan that does not fit one 5-hour usage window on Opus, so this copy defaults every agent to Sonnet (`"bigModel": "sonnet"`). The rule below about Opus deciding is the original design; it applies only when `"bigModel": "opus"` is set, which is for Max plans.

On Pro: tell the user the agent count before launching, run part A and part B in different usage windows, and offer the cheaper alternative first when the user only needs part of the pipeline (for example `paper-claim-audit` on an existing draft, or one stage run by hand in the main chat).

## Rules the design encodes (and why)

- **Decisions are quoted verbatim, never summarised.** In a past run a hand-written decision block went stale and about 130 prompts defended a superseded decision.
- **Sonnet finds, Opus decides** (with `"bigModel": "opus"`; on the Pro default the judgement stages run on Sonnet too). Sonnet: inventory, literature, venue sweeps, exemplar dissection, claim transcription audits, review lenses. Opus: premise, re-derivation, interpretation, venue choice, planning, figures, drafting, adjudication, revision, submission plan. The workflows set `model: BIG` explicitly on every judgement agent; in a past run, model inheritance put a whole run on the wrong model. In that run, Sonnet verifiers got 9 of 12 sampled fixes partly wrong, while Sonnet transcription audits were right 18 of 18.
- **Five review lenses, one adjudicator.** Nine judges gave about two effective votes. A per-finding verify ladder cost 99 agents for leads the user re-checked anyway.
- **RECEIPTS.md is the only source of numbers.** Every number in prose carries `<!-- R:id -->`.
- **Rule 9 (the user writes the claims).** The plan stage writes two blind claim sets X and Y and seals its own preference; the draft proceeds provisionally. The user's job afterwards is to pick X or Y, then a cheap redraft.
- **The premise is open.** Existing drafts are evidence, not a base to extend. If the user has several papers drawing on the same data, a portfolio boundaries file (template in `references/`) is binding across them.
- **No paid API calls and no GPU inside a workflow.** GPU experiments run from the main chat only.

## Drafting voice: mimesis branch

The drafting, assembly and revision agents check whether the mimesis MCP tools are connected (ToolSearch "mimesis").

- **Connected and `mimesis` is not "off":** per subsection, `compose_slate` with two genuinely different candidates, `gate_candidates`, apply the repair instructions, then `scrub_ai_footprint` and fix every flag. `retrieve_transform_demos` supplies AI-to-author rewrite pairs. Every call passes `voice=<args.voice>` explicitly. If a call errors twice, that subsection is written without it and marked `<!-- UNGATED -->`.
- **Not connected, or `mimesis` is "off":** the agent drafts directly, follows the banned-constructions list in the workflow's HARD RULES, then rereads its own text for the structural tells listed in the prose lens (repeated paragraph-opener skeletons, closer formulas, announce-a-count openers, one modesty formula reused, long-then-short rhythm). Each such subsection is marked `<!-- NO-MIMESIS -->` so the README can count them.

Banned in prose either way: em dashes, antithesis ("not X, but Y"), aphorism closers, punchy-then-reversal, ", which is/means" self-explanation, "It is" opening a sentence, "the way a X does" similes, declarative ratings, first-person meta, "we read/take X as/to mean" as a formula, announce-a-count openers, three-item reflex lists, delve/leverage/multifaceted/crucially/remarkably.

## Skills and agents the workflows call on

`web-researcher` (Sonnet subagent) for literature, venue and exemplar collection; `statistical-analysis`, `eval-methodology-playbook`, `nan-safe-correlation` and `degenerate-input-filtering` for re-derivation; `openalex-database` and `paper-library` for citation checks; `general-figure-guide` for figures; `paper-claim-audit` for a standalone audit afterwards. The inventory's memory lane uses the `lkhs-memory` MCP (Claude Mind) when it is connected and records that it was absent otherwise. For a poster or talk from the finished paper, use `latex-research-posters` or `scientific-slides`.

## GPU coordination between chats (optional)

Only relevant when experiments need a local GPU and more than one chat may use it. Skip this section on a machine without NVIDIA GPUs or when only one chat runs.

```
python -u scripts/gpu_lease.py status
python -u scripts/gpu_lease.py board --tail 40
python -u scripts/gpu_lease.py post --owner P3 --msg "propose: GPU ~90 min, 9 GB, control rerun"
python -u scripts/gpu_lease.py acquire --owner P3 --gpu any --minutes 90 --vram-gb 9 --purpose "..."
python -u scripts/gpu_lease.py renew --owner P3 --minutes 60
python -u scripts/gpu_lease.py release --owner P3
```

The lease state lives in `%USERPROFILE%\.paper_forge\gpu\` by default (override with `--state-dir` or the `PAPER_FORGE_GPU_DIR` environment variable). Cards are detected with `nvidia-smi`.

- Post the proposal to the board and read the board before acquiring. If another chat has a pending proposal for the same window, message it (SendMessage) and agree an order; the more decisive experiment goes first.
- One job per card. Set `CUDA_DEVICE_ORDER=PCI_BUS_ID` and `CUDA_VISIBLE_DEVICES=<n>`. Never share a card, and never start on a card the tool reports BUSY.
- Before launching, list live GPU processes (`nvidia-smi`) so a stale job is not mistaken for a free card. Log every run as a deviation or exploratory analysis in the run folder's `experiments/`, with the lease times.
- Renew before expiry; release the moment the job ends. A lease 30 min past expiry can be broken by others.
- Seed every sampling call. Batch size changes results, so keep it fixed across compared runs.

## Pacing

Check plan usage before each workflow (`/usage` in Claude Code). The 5-hour window binds before the weekly one when several forge chats run together. If the 5-hour window is above 85%, wait for the reset at a stage boundary; stopping mid-run loses in-flight agents. Rough size: part A about 20-25 agents, part B about 25-30 per paper.

## After a run

Copy the workflow transcript into `<outDir>/_transcript/`. Spot-check two or three numbers the user will act on against the raw files before reporting. Report in plain language: what the paper now claims, what blocks submission, and what the user must decide (from `NEEDS_USER.md`).
