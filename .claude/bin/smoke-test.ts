/**
 * End-to-end smoke test for the LKHS vector engine.
 *
 * Embeds a throwaway document, queries it back, asserts it ranks first, then
 * removes the test record so the real store is untouched. Exits non-zero on
 * any failure so it can gate CI / the watcher boot.
 *
 *   npm run smoke
 */
import { processFileEmbeddings } from "./vector-engine";
import { queryVectorStore } from "./vector-query";
import { deleteFile } from "./store";

const TEST_KEY = "__smoke__/lkhs-smoke-test.md";
const MARKER = "quokkas are small marsupials native to southwestern Australia";

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

function removeTestRecord(): void {
  try { deleteFile(TEST_KEY); } catch { /* nothing to remove */ }
}

async function main() {
  console.log("1/4 embedding test document...");
  const r1 = await processFileEmbeddings(TEST_KEY, `${MARKER}.\n\nThey are known for appearing to smile.`, true);
  if (r1 !== "indexed") fail(`expected 'indexed', got '${r1}'`);

  console.log("2/4 verifying hash-skip on re-embed...");
  const r2 = await processFileEmbeddings(TEST_KEY, `${MARKER}.\n\nThey are known for appearing to smile.`, false);
  if (r2 !== "skipped") fail(`expected 'skipped' on unchanged re-embed, got '${r2}'`);

  console.log("3/4 querying it back...");
  const hits = await queryVectorStore("smiling Australian marsupial", 5);
  if (hits.length === 0) fail("query returned no hits");
  if (hits[0]!.filePath !== TEST_KEY) {
    fail(`expected top hit ${TEST_KEY}, got ${hits[0]!.filePath} (score ${hits[0]!.score.toFixed(3)})`);
  }
  console.log(`     top hit score: ${hits[0]!.score.toFixed(4)}`);

  console.log("4/4 cleaning up test record...");
  removeTestRecord();

  console.log("\nSMOKE PASS: embed -> hash-skip -> query round-trip OK.");
}

main().catch(err => { removeTestRecord(); fail(err.message ?? String(err)); });
