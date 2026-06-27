/**
 * One-shot ingestor for an external corpus in chunks.jsonl format.
 * Reads chunks grouped by filename, embeds each file as a unit into the SQLite store
 * (via processFileEmbeddings, which is itself content-hash skipped, so re-running is cheap).
 *
 * Usage:
 *   npx tsx .claude/bin/ingest-corpus.ts <path-to-chunks.jsonl> [--prefix "writing/"]
 */
import * as fs from "fs";
import * as readline from "readline";
import { processFileEmbeddings } from "./vector-engine";

async function main() {
  const args = process.argv.slice(2);
  const jsonlPath = args[0];
  const prefixIdx = args.indexOf("--prefix");
  const prefix = prefixIdx >= 0 ? args[prefixIdx + 1] : "";

  if (!jsonlPath || !fs.existsSync(jsonlPath)) {
    console.error("Usage: npx tsx ingest-corpus.ts <chunks.jsonl> [--prefix writing/]");
    process.exit(1);
  }

  // Read all chunks, group by filename
  const grouped: Record<string, string[]> = {};
  const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const key = prefix + (obj.filename || obj.id?.split("::")[0] || "unknown");
      if (!grouped[key]) grouped[key] = [];
      if (obj.text) grouped[key].push(obj.text);
    } catch { /* skip malformed lines */ }
  }

  const files = Object.entries(grouped);
  const skipped: string[] = [];
  const indexed: string[] = [];

  for (const [filename, chunks] of files) {
    const combined = chunks.join("\n\n");
    if (combined.trim().length < 20) { skipped.push(filename); continue; }
    await processFileEmbeddings(filename, combined);
    indexed.push(filename);
  }

  console.log(`\nDone. Indexed: ${indexed.length} | Skipped (already indexed): ${skipped.length}`);
  if (indexed.length > 0) {
    console.log("Newly indexed:", indexed.slice(0, 20).join(", ") + (indexed.length > 20 ? `... +${indexed.length - 20} more` : ""));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
