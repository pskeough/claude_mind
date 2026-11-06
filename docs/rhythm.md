# Wellbeing module: usage rhythm and mind-companion

An opt-in add-on for someone who wants Claude to help them keep an eye on their own pace,
built first for bipolar disorder. It works in the background and almost never speaks.

Turn it on: `npm run install:wellbeing`. Turn it off: `node scripts/install-wellbeing.mjs --off`.

## What it does

**Logs, every night.** `rhythm.mjs scan` runs in the nightly refresh. It reads the
timestamps of the messages you typed into Claude Code (all projects, `~/.claude/projects`)
and records one row per day: active minutes, messages, sessions, projects, new projects,
messages after midnight, first and last active hour. It never stores what you wrote.
Headless `claude -p` runs (the vault's own miners and scripts) are excluded. A day runs
05:00 to 05:00, so 2am belongs to the night before.

**Learns your usual.** Each day is compared with a rolling baseline of your previous six
weeks (median and spread, robust to the odd huge day, days off included). Nothing is
judged until 14 active days are on file. Days inside a period you reported as manic stay
out of the baseline, so an episode never becomes your new normal.

**Flags rarely.** A day counts as elevated only when late-night use AND volume or breadth
are both well beyond your own spread (2.5 robust SDs at the default `low` sensitivity),
or volume and breadth are both extreme together. The level goes to `elevated` only when
three of the last four days are like that. One wild night is logged and nothing else
happens. At `elevated` the next Claude session in any project gets one check-in note.
It is offered once that day. After the check-in nothing asks again for four days.

**Pacing mode when you say so.** Tell Claude "I'm manic" (or hypomanic, mixed, low) and it
records it. For the next five days (or the period you name) every session knows, along
with today's numbers against your usual. Claude still does what you ask, but it watches
for the hour and for new threads, offers to park ideas, suggests 48 hours on big moves,
and stops amplifying grand plans. "I'm ok now" ends it.

**Analysis on request.** "How have I been?" makes Claude read `persona_clinical/rhythm.md`
(baseline, last four weeks, your reports, past check-ins) and give you a plain read.

There are no notifications, reminders or prompts to log anything.

## Why it is built this way

- Sleep and circadian disruption, more activity and more communication are the signals
  most consistently associated with (hypo)mania in phone and wearable studies. Every
  model does better on a person's own baseline than on population norms. The signals are
  also noisy, and mania is harder to track than depression, which is why one signal alone
  never counts and persistence is required.
- Individual early-warning detection has a real false-alarm cost (one depression study
  flagged 42% of people who stayed well), so the bar is high and check-ins have a cooldown.
- Learning your own early signs is one of the better-evidenced self-management tools.
  Hence `persona_clinical/my-plan.md`, written by you while well, which Claude reads
  before raising anything.
- People in monitoring-app studies disliked feeling watched, repetitive prompts, and
  monitoring they had not chosen. So the module is opt-in, and you set its rules in
  advance. It never blocks anything.
- Chatbots tend to validate whatever the user believes, and reviews of psychiatric
  records have linked that to worsening mania. Pacing mode exists to switch that off.

## Settings (`.claude/lkhs.config.json`, key `rhythm`)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | false | master switch (the installer sets it true) |
| `sensitivity` | `low` | `medium` = 2 SD and 2 of the last 3 days |
| `cooldownDays` | 4 | quiet period after a check-in |
| `dayStartHour` | 5 | when one day ends and the next starts |
| `minBaselineDays` | 14 | active days needed before anything is flagged |
| `minNightMsgs` | 8 | late-night use needs at least this many messages |

`node .claude/bin/rhythm.mjs pause 14d` pauses check-ins and keeps logging.

## Files

| Path | What |
|---|---|
| `.claude/bin/rhythm-core.mjs` | features, baseline, judgement |
| `.claude/bin/rhythm.mjs` | CLI: scan, status, live, note, ack, pause |
| `.claude/bin/rhythm-hook.mjs` | the only code that speaks; called by the global SessionStart hook |
| `.claude/memory/rhythm/` | days.jsonl, state.json, self-reports.jsonl, checkins.jsonl |
| `persona_clinical/rhythm.md` | readable record, rebuilt nightly |
| `persona_clinical/my-plan.md` | your plan |
| `extras/skills/mind-companion/` | the skill plus a bundled clinical-psychology KB and its retriever (Python stdlib only) |

`persona_clinical/` and `.claude/memory/` are gitignored and never leave the machine.

It measures Claude Code use only, not Claude Desktop or claude.ai chats, and not your
phone. It is not a medical device and does not replace your prescriber or care team.
