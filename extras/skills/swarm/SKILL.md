---
name: swarm
description: Multi-agent swarm runs with the Workflow tool, fan-out of parallel Sonnet agents, lanes, pipelines, one synthesis agent. Use when the user says "swarm", "fan out", "run a workflow", "parallel agents", "multi-agent", "deploy Sonnet agents", "bunch of agents", or asks to resume, stop or archive a run. NOT for one quick lookup, a single subagent, or a catalog base (use master-context).
---

# Swarms

## Settings (edit these for your machine)

| Setting | Default | Meaning |
|---|---|---|
| `SWARMS_DIR` | `<current project>\swarms\` | Root for run folders. Created on demand the first time a swarm runs. |
| Run folder | `SWARMS_DIR\<topic>_<YYYY-MM-DD>\` | One folder per run, with an `agents\` subfolder. |
| Run index | `SWARMS_DIR\README.md` | One row per run: date, topic, agent count, time, deliverable path. |

Script API, schemas, pipeline vs parallel, and resume mechanics: load the built-in `workflow-authoring` skill. This file holds the conventions and the lessons from past runs. Measured findings and run post-mortems are in `references/settled-findings.md`; read it before designing a new swarm.

## 1. Does it fit a swarm?

- Yes when the work splits into independent pieces: one lane per institution, per source, per section, per repo. Parallel agents gained +80.8% on decomposable work in published measurements.
- No when steps depend on each other (planning, a single argument, a chain of edits): swarms lost 39 to 70% there. Do it in the main loop.
- A single lookup stays inline. Two or three searches go to one `web-researcher` Agent, not a workflow.
- Default size is under 6 agents on a Pro plan and under 10 on Max, unless the user asks for scale ("go big", "big swarm"). Say the agent count before launching.

## 2. Before launch

- Check usage if a usage tool or `/usage` is available. Every agent draws on the same plan limit. A past 152-agent run used 15.3M subagent tokens; state the rough cost when a run will be large.
- Respect data freezes. If the user has frozen a dataset, the swarm runs no model calls, API calls or GPU jobs against it. CPU work on stored files is fine.
- Anything that costs money outside the plan (paid APIs, cloud compute) needs the user's yes first.
- Create the run folder `SWARMS_DIR\<topic>_<YYYY-MM-DD>\` with `agents\`. After launch, copy the persisted script to `workflow.js` in the run folder and add a row to `SWARMS_DIR\README.md`.

## 3. Routing

- Every worker agent: `model: 'sonnet', effort: 'high'`. That covers collection, drafting, claim audits, critique, building and QA. Sonnet defaults to medium effort, so set high explicitly.
- Web collection lanes: add `agentType: 'web-researcher'`.
- The final synthesis runs on Sonnet with `effort: 'high'` on a Pro plan. On a Max plan, or when the user asks, run it on Opus (`model: 'opus'`) and keep every other agent on Sonnet. Give it a spot-check duty: re-open the cited source for its top 3 to 5 items and mark each CHECKED or UNCHECKED.
- Default to no in-run verification ladders (one refuter per finding, per-claim checkers). In a past run, 99 per-finding verifiers took about two thirds of the agents and the user judged them unnecessary, while a main-loop spot check after another run caught an error its verifiers missed. End with a "What is unverified" section and offer a verify pass as a separate run.
- When the main loop reports the result, it re-opens one or two of the numbers or pages the user will act on first. Sonnet output is a lead until checked.

## 4. Default shape

```
lanes (parallel, Sonnet, each writes agents/<lane>.md, returns ~200-word summary)
  -> optional single critic (Sonnet) when the output is prose the user will use
  -> synthesis (Opus): reads agents/*.md, spot-checks top items, writes the deliverable + README.md
```

- Give lanes different assignments, sources or rubrics. Persona names do not add accuracy, and identical copies add redundancy, not diversity.
- Reviewer swarms produce issue lists, not scores. Nine judges gave about two effective votes.
- Order stages so that judgments see the facts. A lane that estimates odds or ranks options runs after the lane that collects the facts it depends on.
- Log what a run drops (`log()`); a silent cap reads as full coverage.

## 5. Prompts

- One shared `CTX` block: today's date, the user's situation, file paths to read first, and the evidence rule (URL, access date, short verbatim quote; mark aggregators UNVERIFIED).
- Each agent writes its full output to a file in the run folder and returns a short summary. The synthesis reads the files.
- Agents get CLAUDE.md injected. Name only the rule a stage needs.
- Progress reporting (optional): add one line to `CTX` asking each agent to write `[progress n/m] <done>; next: <next>` lines as it goes and to begin its final answer with a short `[summary]` block (Did / Changed / Result / Open). The returned summary to the synthesis can be that block.
- Voice: if the user has the mimesis skill installed and wants drafting in their own voice, drafting agents use it with `voice=` passed explicitly. Otherwise write plain prose.
- Swarms never send email and never contact anyone. They list recipients only, and they state contact status only from what the user has said, never inferred.
- Plain flat prose in deliverables: no em dashes, no rhetorical constructions.

## 6. Running, stopping, resuming

- The resume cache key is prompt + opts. Changing `model` or `effort` on an agent re-runs it, and anything whose prompt embeds its output. Back up finished outputs before resuming an edited script.
- Before `TaskStop`, wait for in-flight agents you want to keep: compare `started` vs `result` keys in `journal.jsonl` (result lines carry no label; map by `key`).
- Switching unstarted agents to another model: edit the persisted script, stop, resume with `resumeFromRunId`. Narrow the edit to agents that have not started.
- When the run finishes: copy the run's transcript folder (under `%USERPROFILE%\.claude\projects\<project>\<session>\subagents\workflows\<runId>\`) into the run folder as `_transcript\`, read the outputs, spot-check, then report in plain language.

## 7. Shapes that have worked

Each finished run's `workflow.js` in `SWARMS_DIR` becomes a template for the next. Until there are some, these shapes are proven:

- Research sweep (preferred): 5 Sonnet lanes split by source or question, 1 Opus synthesis with a top-5 spot check. 6 agents, about 17 minutes.
- Per-entity sweep: one lane per institution, person or product, all reading a shared profile file written by the main loop first, so every lane applies the same criteria.
- Decision analysis: reader lanes on the facts, a few hostile-reviewer lanes, one lane per option or path, a critic, then a one-page decision from the synthesis.
- Drafting: one unit per section with draft, audit, critic and apply steps per unit. Do not add a per-finding verifier ladder.
- Build: design doc, one lane per module, a headless smoke test, then assembly into the deliverable (for example a single-file HTML app).
