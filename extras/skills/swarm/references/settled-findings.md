# Swarm settled findings

## Research

| Finding | Source |
|---|---|
| Task fit beats agent count: +80.8% on decomposable work, -39% to -70% on sequential planning, against a single agent | Kim et al., Towards a Science of Scaling Agent Systems, arXiv 2512.08296 |
| Independent parallel agents amplify errors 17.2x; a central checker contains it to 4.4x | Kim et al. |
| Nine frontier judges give about two effective independent votes (correlated errors) | Kohli, Nine Judges, Two Effective Votes, arXiv 2605.29800 |
| Group-size scaling has diminishing returns; dense communication speeds premature convergence | Chen et al., Diversity Collapse in Multi-Agent LLM Systems, arXiv 2604.18005 |
| Persona prompts do not improve accuracy | arXiv 2311.10054 |
| Plain sampling-and-voting raises accuracy with agent count; it needs comparable answers, so it does not apply to prose synthesis | Li et al., More Agents Is All You Need, arXiv 2402.05120 |
| Flat self-coordination at scale: twenty agents slowed to the throughput of two or three | Cursor, Scaling long-running autonomous coding, 2026-01-14 |
| Start with the simplest solution; add complexity only when needed | Anthropic, Building effective agents |

## Post-mortems of past runs

| Run type | Agents | Time | Notes |
|---|---|---|---|
| Paper drafting | 152 | 2 h 07 m, 15.3M subagent tokens | 99 referee findings each got a verifier (65 confirmed). The user judged the ladder unnecessary and preferred to verify after the fact. Output numbers spot-checked against the stats files: matched |
| Research sweep | 6 | 17 min, 0.95M tokens | 5 Sonnet lanes + Opus synthesis with top-5 spot check. The preferred shape |
| Per-institution funding sweep | 39 | | Opus verifiers missed an eligibility rule on one institution's official page; the main-loop re-check caught it. The main-loop spot check is not optional |
| Career decision analysis | 17 | | Odds estimates were agent judgments made before the funding facts existed. Order runs so judgments see the facts |
| Game build | 19 | | Build swarm; headless smoke test passed. Previewing the result needs a localhost server; opening it via file:// renders a static snapshot |

## Operational lessons

- Changing opts (model/effort) on a finished agent invalidates its cache key: an Opus draft was re-queued on Sonnet after a routing edit. Back up outputs and narrow the edit to unstarted agents.
- Stopping mid-run loses in-flight agents. Wait on `journal.jsonl` (started vs result by key) before `TaskStop`.
- Journal `result` lines have no label; map keys from `started` lines.
- Concurrency is roughly the number of CPU cores minus 2, so on an 8-core machine a 55-agent stage runs in about 9 waves.
- Swarm output that names people to contact must state contact status from what the user said, not infer it. A past swarm assumed earlier outreach that had never happened.
