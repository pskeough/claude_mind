/**
 * Obsidian Map-of-Content generator.
 *
 * Makes the vault a navigable Obsidian space:
 *   1. Writes HOME.md, a hub note linking every theme card, every project (state
 *      card + session journal), and the graph report. Opening HOME in Obsidian
 *      gives a one-click map of the whole Claude Mind.
 *   2. Cross-links each theme card's "Projects:" line to the project cards, so
 *      Obsidian's graph view renders the theme -> project -> concept structure
 *      (journals already link concepts), not a pile of disconnected notes.
 *
 * Path-qualified wikilinks ([[cards/X|X]]) are used so cards/X and journal/X never
 * collide. Idempotent.
 *
 *   tsx build-moc.ts
 */
import * as fs from "fs";
import * as path from "path";
import { canonKey } from "./text-normalize";
import { vaultRoot } from "./config";

const VAULT = vaultRoot();
const dirFiles = (d: string) => { try { return fs.readdirSync(path.join(VAULT, d)).filter(f => f.endsWith(".md") && !f.startsWith("_")); } catch { return []; } };
const read = (p: string) => { try { return fs.readFileSync(path.join(VAULT, p), "utf-8"); } catch { return ""; } };

function frontTitle(content: string, fallback: string): string {
  return content.match(/^---\n[\s\S]*?\btitle:\s*(.+)$/m)?.[1]?.trim() || fallback;
}
function firstBodyLine(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^#.*\n/m, "").trim();
  return (body.split("\n").find(l => l.trim()) || "").replace(/[*_`]/g, "").slice(0, 140);
}

function main() {
  const themes = dirFiles("themes").sort();
  const cards = dirFiles("cards").sort();
  const journals = new Set(dirFiles("journal").map(f => f.replace(/\.md$/, "")));
  const cardByCanon = new Map(cards.map(f => [canonKey(f.replace(/\.md$/, "")), f.replace(/\.md$/, "")]));

  // 1. Cross-link theme cards' Projects line -> project cards.
  let linked = 0;
  for (const tf of themes) {
    const p = path.join("themes", tf);
    let content = read(p);
    const updated = content.replace(/^(\*\*Projects:\*\*[ \t]*)(.+)$/m, (_m, pre: string, list: string) => {
      const items = list.split(/\s*,\s*/).map(raw => {
        const name = raw.replace(/\[\[|\]\]/g, "").trim();
        const card = cardByCanon.get(canonKey(name));
        return card ? `[[cards/${card}|${name}]]` : name;
      });
      return pre + items.join(", ");
    });
    if (updated !== content) { fs.writeFileSync(path.join(VAULT, p), updated, "utf-8"); linked++; }
  }

  // 2. HOME.md hub.
  const themeLines = themes.map(tf => {
    const c = read(path.join("themes", tf));
    const name = frontTitle(c, tf.replace(/\.md$/, "")).replace(/^theme\s*-\s*/i, "");
    return `- [[themes/${tf.replace(/\.md$/, "")}|${name}]] - ${firstBodyLine(c)}`;
  });

  // Projects, grouped: those with session history first (active), then ingested-only.
  const cardNames = cards.map(f => f.replace(/\.md$/, ""));
  const active = cardNames.filter(n => journals.has(n)).sort();
  const archived = cardNames.filter(n => !journals.has(n)).sort();
  const projLine = (n: string) => `- [[cards/${n}|${n}]]` + (journals.has(n) ? ` &middot; [[journal/${n}|sessions]]` : "");

  const home = [
    "---", "title: Claude Mind - Home", "type: moc", "---", "",
    "# Claude Mind", "",
    "Map of the knowledge base. Themes are cross-project through-lines; each project has a state card (where it stands) and, if worked on in Claude Code, a session journal. The interactive graph is `graph/graph.html`; the analysis is [[GRAPH_REPORT]].", "",
    `## Themes (${themes.length})`, ...themeLines, "",
    `## Active projects (${active.length})`, "Worked on in Claude Code (state card + sessions).", ...active.map(projLine), "",
    `## Ingested projects (${archived.length})`, "Directory-ingested (state card only).", ...archived.map(projLine), "",
    "## Explore", "- Interactive graph: open `graph/graph.html` in a browser", "- [[GRAPH_REPORT]] - god nodes, communities, bridges, surprising connections", "- [[VAULT-INDEX]] - namespace map", "",
  ].join("\n");
  fs.writeFileSync(path.join(VAULT, "HOME.md"), home + "\n", "utf-8");

  console.log(`MOC written: HOME.md (${themes.length} themes, ${active.length} active + ${archived.length} ingested projects). Cross-linked ${linked} theme cards.`);
}

main();
