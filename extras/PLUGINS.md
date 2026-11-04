# Plugins and settings worth knowing about

None of this is required. Install plugins from an interactive Claude Code session with
`/plugin`.

## Official marketplace (`claude-plugins-official`)

| Plugin | What it gives you |
|---|---|
| `code-review` | `/code-review` on a diff, a branch or a PR, useful for analysis scripts |
| `pr-review-toolkit` | review agents for tests, comments, silent failures |
| `claude-code-setup` | walks through hooks, permissions and settings |

## Other marketplaces

Add under `extraKnownMarketplaces` in `%USERPROFILE%\.claude\settings.json`, then
install from `/plugin`:

```json
"extraKnownMarketplaces": {
  "anthropic-agent-skills": { "source": { "source": "github", "repo": "anthropics/skills" } },
  "planning-with-files":    { "source": { "source": "github", "repo": "OthmanAdi/planning-with-files" } }
}
```

- **anthropic-agent-skills**: `docx`, `pdf`, `xlsx`, `pptx`. Real Word, PDF, Excel and
  PowerPoint files when you ask for them.
- **planning-with-files**: keeps a plan, findings and progress on disk so long tasks
  survive a context reset.

## Settings

- **Model.** Leave the default model on Sonnet for a Pro plan (`/model` in a session).
- **Permissions.** `permissions.deny` in `settings.json` lists tools that can never run.
  Put outbound actions there (sending email, posting) if you connect such tools.

## Commands to remember

- `/usage`: how much of your plan window and weekly limit is used.
- `/model`: switch model for this session.
- `/doctor`: diagnoses Claude Code itself. Different from Claude Mind's `npm run doctor`.
