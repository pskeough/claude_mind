# Claude Desktop

Claude Mind started as a memory for Claude Code. Many people talk to Claude mostly in the
Claude Desktop app, and those chats never reach the session capture: Desktop Chat
conversations are stored on Anthropic's servers, not on disk, and Desktop has no hooks.
Four pieces close that gap.

## 1. Desktop can read your memory

The normal install (`node scripts/finalize-setup.mjs`, step 3) registers the `lkhs-memory`
MCP server in Claude Desktop as well as in Claude Code. To do only the Desktop part, or
to redo it after moving the folder:

```bash
npm run install:desktop                      # Desktop only
node scripts/register-mcp.mjs --off          # take it out of Desktop again
```

It writes `mcpServers.lkhs-memory` into every Desktop config it finds, keeping whatever
else is there and saving a `.bak-claudemind` copy first:

| OS | Config folder |
|---|---|
| macOS | `~/Library/Application Support/Claude` |
| Linux | `~/.config/Claude` |
| Windows, classic installer | `%APPDATA%\Claude` |
| Windows, Microsoft Store build | `%LOCALAPPDATA%\Claude-Data\claude_<id>` (the Store build reads only this one) |

The entry uses absolute paths (the node binary, tsx's loader, the server script) because
Desktop starts servers with a bare PATH and an unrelated working directory.
`node scripts/desktop-config.mjs` lists the config files found and the servers in each.

Quit Desktop fully and reopen it afterwards; it reads servers only at launch.

## 2. Desktop chats are saved as they happen

The server has a `save_session` tool. Claude calls it with a chat id it makes up for the
conversation, a title, a summary and optional lists of key points, decisions and open
threads. The entry goes into `journal/Claude-Desktop.md` (or a named project's journal)
through the same code path as a captured Claude Code session, with ledger id
`desktop-<chat id>` and source `claude-desktop`. Saving again with the same chat id
replaces that entry, so one chat stays one session however often it is saved. Nothing is
written to `persona_clinical/`.

Claude only calls it if asked to. Paste the paragraph in `extras/desktop-preferences.txt`
into Desktop > Settings > Profile > personal preferences. The installer prints it too.
If the wellbeing module is also on, both installers print one merged paragraph instead
(Desktop has a single preferences box), sharing one chat id and keeping mood details out
of saved summaries.

## 3. Past chats come in from an export

claude.ai > Settings > Privacy > Export data sends a zip with every conversation, from
desktop, web and phone. Unzip it, then:

```bash
npm run import:chats -- ~/Downloads/<export folder> --dry-run     # what would come in
npm run import:chats -- ~/Downloads/<export folder>               # import
npm run import:chats -- <folder> --limit 50                       # newest 50 only
npm run import:chats -- <folder> --no-summary                     # no model calls
```

Each conversation becomes one session in `journal/Claude-Chats.md` with id
`claudeai-<uuid>`, summarised by the same archivist prompt as captured sessions. One-line
chats are skipped. The ledger records each conversation's `updated_at`, so a rerun on a
newer export imports only new chats and replaces the entry of a chat that continued. With
the wellbeing module on, the same command also runs the rhythm import, and the
`wellbeing_import_export` tool in Desktop starts this journal import in the background
(log: `.claude/logs/import-chats.log`).

A chat saved live with `save_session` and later imported from an export appears twice,
once per id: Desktop does not tell Claude the conversation's real id. The live entry is
the one with Claude's own summary.

ChatGPT and generic exports import the same way. To feed exports to the persona pipeline
instead, use `npm run normalize:chats` (see SETUP.md).

## 4. Cowork sessions are swept

Desktop's Cowork mode runs a Claude Code agent and keeps its transcripts on disk under
`local-agent-mode-sessions` in the Desktop data folder. The hourly capture sweep reads
those alongside `~/.claude/projects` and files them in `journal/Cowork.md` (source
`claude-cowork`). Nothing to set up.
