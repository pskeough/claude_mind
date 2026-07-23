# Claude Mind

A private memory brain for Claude Code that runs entirely on your computer. It quietly
remembers your Claude Code sessions, reads your files and projects, and feeds the
relevant bits back to Claude whenever you work, so you don't have to re-explain
yourself. Nothing leaves your computer, and it runs on your Claude subscription (no
API keys, no extra cost).

## What it does

- **Remembers your sessions.** Every Claude Code conversation is captured, summarized,
  and indexed, so "what did we do on X?" or "where did I leave that?" just works.
- **Knows your work.** It ingests the folders you point it at and builds a searchable,
  linked map of your projects.
- **Knows you.** It synthesizes a deep, longitudinal user model from your exported
  chat history — Claude, ChatGPT, Gemini, or any transcript folder, via a universal
  importer (`npm run import:chats`) — so Claude works the way you prefer from the
  first message. Facts are bi-temporal: the system knows when something stopped
  being true and answers from the current state, not the loudest old mention.
- **Thinks about its own memory.** Nightly control loops grade yesterday's memory
  injections against what actually helped (hindsight), reconcile facts against new
  sessions and flag contradictions for your call instead of silently overwriting,
  retire distilled episodes to a cold tier, fire when-X-then-Y prospective
  intentions, and write you a three-things morning brief.
- **Stays live.** Background jobs keep it running and growing on their own.
- **Controls what it reveals.** Every memory carries an audience scope (private,
  personal, professional, public); sessions can run under a `work` or `public`
  profile that structurally cannot retrieve more private memory, and an
  adversarial leak harness (`npm run eval:scope`) proves it on your own data —
  a content-audit mode even checks the retrieved text itself, not just labels.
- **Learns your voice preferences** (optional, with a Mimesis-style voice
  system): when you iterate on drafts written in your voice, the nightly miner
  turns your in-chat feedback into recalibration signal — stylistic corrections
  only, never factual ones — and the voice measurably converges on what you
  actually keep.
- **Watches its own health.** A weekly hygiene pass tracks retrieval quality as
  a trend and alarms in your daily digest when it drifts, when indexed files go
  missing on disk, or when the store loses internal consistency. A weekly
  report summarizes your week from ledgers, never from vibes.
- **A local console.** A web dashboard to explore the graph, timeline, your projects,
  and to chat with your own memory: http://127.0.0.1:7099

## Install (one time)

Runs on **macOS, Windows, and Linux**, Apple Silicon/ARM and x64 alike — the native
pieces (SQLite, the embedding runtime) compile for your machine during `npm install`.
You need [Node 18+](https://nodejs.org) and [Claude Code](https://claude.ai/code)
installed and signed in (subscription — no API key anywhere). On macOS you'll also
want the Xcode Command Line Tools (`xcode-select --install`); on Windows, the usual
build tools that ship with recent Node installers are enough.

**Non-technical, on a Mac? Read [`HER-QUICKSTART.md`](HER-QUICKSTART.md)** — the same
install in 4 plain steps with no jargon.

```bash
git clone https://github.com/pskeough/claude_mind.git
cd claude_mind
bash setup.sh        # macOS/Linux (on Windows: npm install, then npm run preflight)
```

Then open Claude Code in this folder and tell it: **run setup**. It reads `SETUP.md`
and walks you through the rest (your profile, your folders, your chat history from
any provider, and turning on the background jobs — launchd on macOS, Task Scheduler
on Windows). That's it.

## Day to day

You don't have to do anything — it works in the background while you use Claude Code
normally. When you want to look inside it:

- **Open the console:** double-click `launch.command` (or run `npm run web`), then go
  to http://127.0.0.1:7099
- **Add a note to the wiki:** drop a markdown file into `raw/`; it gets filed automatically.
- **Search your memory:** `npm run query "whatever you're looking for"`
- **Check it's healthy (with fixes):** `npm run doctor` — or just open Claude Code in
  the folder and say "check Claude Mind is healthy and fix it."

## Good to know

- Everything personal stays on your machine. Your profile, chat-derived persona, and
  any sensitive health material are never tracked by git and never uploaded. The
  clinical tier is quarantined even from your own retrieval unless you ask directly.
- It updates itself: a watcher re-indexes changed files, an hourly sweep captures
  recent sessions, and a nightly pass runs the full consolidation: hindsight grading,
  fact reconciliation, preference mining, rebuilds, a privacy-leak smoke test, and a
  daemon recycle. Sundays add an eval point, a store-hygiene check, and your weekly
  report.
- It is measured, not vibes: the repo ships the same evaluation harnesses the system
  was tuned with (offline recall/temporal/abstention, live-gate restraint, and the
  adversarial scope-leak harness), and the weekly hygiene pass alarms you if quality
  drifts.
- To remove the parts installed outside this folder (background jobs, hooks, the memory
  tool): `npm run uninstall`. To remove it entirely, also delete this folder.

For the technical details, see `CLAUDE.md`. For the persona-building step, see
`docs/persona-synthesis.md`.
