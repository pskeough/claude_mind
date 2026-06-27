/**
 * Bulk recontextualize: re-embed every stored chunk with its document context
 * prepended (contextual retrieval), in place, from the store's own chunk text.
 *
 * No document re-extraction and no re-ingestion: it reads each chunk's stored text,
 * recomputes "<doc context>\n\n<chunk>", re-embeds, and replaces the file's rows
 * via the normal transactional upsert (so readers always see a consistent file).
 * Title comes from the live file when it still exists on disk, else from the path,
 * matching what the index-time path does.
 *
 *   tsx recontextualize.ts            # all files
 *   tsx recontextualize.ts --limit n  # first n files (testing)
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { allFiles, fileChunks, storedFileHash, upsertFile, type UpsertItem } from "./store";
import { docContext, embedPassages } from "./vector-engine";
import { vaultRoot } from "./config";

const VAULT = vaultRoot();
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf-8").digest("hex");

async function main() {
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  const files = allFiles().slice(0, limit);
  console.log(`Recontextualizing ${files.length} files...`);

  let done = 0, chunks = 0, t0 = Date.now();
  for (const file of files) {
    const stored = fileChunks(file);
    if (stored.length === 0) { done++; continue; }
    let content: string | undefined;
    try { content = fs.readFileSync(path.join(VAULT, file), "utf-8"); } catch { content = undefined; } // gone from disk -> path-derived ctx
    const ctx = docContext(file, content);

    const texts = stored.map(c => ctx ? `${ctx}\n\n${c.text}` : c.text);
    const vectors = await embedPassages(texts);
    const items: UpsertItem[] = stored.map((c, i) => ({ text: c.text, hash: sha256(ctx + " " + c.text), chunkIndex: c.chunkIndex ?? i, vector: vectors[i] }));
    // keep the file's existing file_hash (content unchanged) so index-time skip still works
    upsertFile(file, storedFileHash(file) || sha256(stored.map(c => c.text).join("\n")), items);

    done++; chunks += items.length;
    if (done % 100 === 0) {
      const rate = Math.round(chunks / ((Date.now() - t0) / 1000));
      console.log(`  ${done}/${files.length} files, ${chunks} chunks (${rate}/s)`);
    }
  }
  console.log(`\nRecontextualize complete. ${done} files, ${chunks} chunks re-embedded with context.`);
}

main().catch(e => { console.error(e); process.exit(1); });
