/**
 * Shared text normalization for LKHS.
 *
 * canonKey produces a MERGE KEY for entities/concepts so that separator-style
 * variants collapse to one node and one gate-match target:
 *   "Llama-3.1-8B"  "Llama 3.1 8B"  "llama_3_1_8b"  ->  "llama 3.1 8b"
 *
 * It is deliberately lossy: lowercase, unify _ - / separators to spaces, drop
 * other punctuation, collapse whitespace. Version dots (3.1) and the symbols
 * + and # (c++, c#, f#) are preserved because they carry identity. This is a
 * KEY only; nice display labels are kept separately (graph-build.bestLabel).
 *
 * Used by graph-build (node ids) and lkhs-daemon (entity gate) so both sides of
 * the brain agree on what counts as "the same thing".
 */
export function canonKey(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[_\-/\\]+/g, " ")        // unify separators
    .replace(/[^a-z0-9.+#\s]/g, " ")    // drop other punctuation, keep version dots and + #
    .replace(/\s+/g, " ")
    .trim();
}
