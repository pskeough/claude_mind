# raw/

Inbox for knowledge you want compiled into the wiki. Drop any markdown file here and
the ambient watcher ingests it into `wiki/` (one concept per note) and regenerates
`VAULT-INDEX.md`. Edits to `wiki/` are embed-only, which prevents a compile loop.

Manual trigger: `npm run wiki:import <file>` or `npm run wiki:fix`.
