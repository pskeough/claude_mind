/**
 * One-off migration: convert existing journal "**Entities:**" comma lists into
 * [[wikilinks]] so Obsidian's native graph and the graph builder see them as
 * nodes. Re-embeds each changed journal. Idempotent (safe to re-run).
 *
 *   npx tsx .claude/bin/link-entities.ts
 */
import * as fs from "fs";
import * as path from "path";
import { linkifyEntities } from "./capture-session";
import { processFileEmbeddings } from "./vector-engine";
import { vaultRoot } from "./config";

const JOURNAL = path.join(vaultRoot(), "journal");

async function main() {
  if (!fs.existsSync(JOURNAL)) { console.log("No journal dir."); return; }
  const files = fs.readdirSync(JOURNAL).filter(f => f.endsWith(".md"));
  let changed = 0;
  for (const f of files) {
    const p = path.join(JOURNAL, f);
    const before = fs.readFileSync(p, "utf8");
    const after = linkifyEntities(before);
    if (after !== before) {
      fs.writeFileSync(p, after, "utf8");
      await processFileEmbeddings("journal/" + f, after, true);
      changed++;
      console.log("linked", f);
    }
  }
  console.log(`\nDone. ${changed}/${files.length} journals updated.`);
}

main().catch(e => { console.error(e); process.exit(1); });
