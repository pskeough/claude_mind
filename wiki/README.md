# wiki/

Compiled knowledge notes live here — one concept per file, with frontmatter
(title, aliases, domain, created, updated, provenance) and bidirectional `[[links]]`.

You don't write these by hand. Drop a raw markdown file into `raw/` and the ambient
watcher auto-compiles it into a wiki note and updates `VAULT-INDEX.md`. Or run
`npm run wiki:import <file>` manually. See `CLAUDE.md` → Wiki Authoring Standards.
