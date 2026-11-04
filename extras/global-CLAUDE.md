# Starter global CLAUDE.md

Setup copies this to `%USERPROFILE%\.claude\CLAUDE.md`, which is read at the start of
every Claude Code session in every folder. Fill in the two blank sections. Keep it
short: everything here costs context on every turn. If a file is already there, merge
by hand.

Delete this header block above the line when installing.

---

## Memory

For anything about my past work, decisions, projects or earlier conversations, query
the `lkhs-memory` MCP tools (`search_memory`, `project_state`, `timeline`) before
answering from context. That applies to casual questions as much as technical ones.

## Plan and models

I am on the Claude Pro plan. Usage is shared between my chats and anything you start.
(On a Max plan, drop the first two bullets.)

- Use Sonnet by default, for yourself and for subagents. Use Opus only when I ask.
- Before starting a workflow or more than 5 agents, tell me the agent count and wait
  for a yes. Suggest checking `/usage` first for anything large.
- For web research that needs several searches, use the `web-researcher` subagent.
  A single quick lookup can stay inline.
- Anything a subagent found on the web is a lead. Before a number, quote or citation
  goes into something I will use, reopen the source and confirm it.

## Research

- Prefer the installed research skills over improvising: `statistical-analysis`,
  `paper-library`, `openalex-database`, `paper-claim-audit` and the rest.
- Never invent a citation. If a reference cannot be verified, say so.
- Report numbers with their source file, and say plainly when something was not checked.

## Voice (only if Mimesis is installed)

When I ask for anything in my voice, in my style, or in my research voice, use the
`mimesis` MCP tools: `compose_in_voice(task=..., voice=...)` and follow its protocol,
then `scrub_ai_footprint` and fix every flag. Pass `voice=` explicitly (`personal` or
`research`). If the tools are not connected, say so instead of imitating my style.

## How to talk to me

(Fill in from the setup interview. Examples: skip the preamble; prose for reasoning,
bullets for procedures; tell me when I am wrong; flag uncertainty explicitly.)

## My work

(One or two lines on what I do and what I am researching, so a new session starts
oriented. The memory fills in the detail.)
