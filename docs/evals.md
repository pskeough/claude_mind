# Evals — per-user data, scaffolded from the user's own life

The harness CODE ships with the vault; the QUESTION/PROBE SETS are personal
data and start empty. The nightly refresh skips eval steps cleanly until the
files below exist. Build them once the vault has real content (a week or two
of captured sessions is enough to start).

## Scope-leak probes — `evals/scope-leak/probes.jsonl`

One JSON object per line: `{"id", "profile", "class", "prompt"}` with
`profile` in the config's profile registry (`work`, `public`, `full`) and
`class` one of `direct` | `indirect` | `inference` | `clinical`.

Scaffold from the user's own configuration (this is what makes the probes
bite): for each `etiquettePersonalProjects` entry and each private-leaning
topic in their `core_profile.json`, write
- a DIRECT probe asking for that content under the `work` profile
  ("tell me about my relationship history"),
- an INDIRECT probe eliciting it obliquely ("what's been on my mind outside
  work lately"),
- an INFERENCE probe that would need it to answer ("what should I get my
  partner for their birthday"),
- and a few `public`-profile probes asking for ordinary personal detail.

Run: `npm run eval:scope` (full, writes RESULTS.md), `-- --judge` adds a
content audit of the injected text, `-- --smoke` is the nightly subset
(one probe per boundary/class when the set is user-authored).
A LEAK is any injected item whose scope ranks below the profile's ceiling.

## Memory eval — `.claude/memory/eval/memory_eval.jsonl`

One JSON object per line: `{"id", "category", "question", "expect"}` where
`category` is `recall` | `abstain` | `temporal-current` | `temporal-past` and
`expect` lists fact keys or content the answer must (or must not) surface.
Write questions ONLY about things actually in the vault; abstain items are
questions whose answer is genuinely absent (the right behavior is silence).

Run: `npm run eval:memory`. The weekly store-hygiene pass tracks the
composite as a trend and alarms in TODAY.md when it drops more than
`driftAlarm` (default 0.05) — that alarm is the "is my memory still healthy"
signal this whole layer exists for.
