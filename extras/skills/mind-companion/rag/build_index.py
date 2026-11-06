"""
Build the retrieval index: dense embeddings plus a BM25 term index.

At 282 chunks a vector database is the wrong tool. The entire embedding matrix is
about 0.4 MB, so an exhaustive numpy matmul scores every chunk in well under a
millisecond, which is faster than any approximate index and carries no service to
run, no schema to migrate, and no extra dependency.

The embedding model is the quantised bge-small already present in the fastembed
cache, which is the same model the LKHS vault uses. Reusing it avoids a download
and keeps one embedding space across the machine.

The cache directory is pinned explicitly because symlink creation is broken on
this machine, and fastembed's default resolution path assumes it works.

    python rag/build_index.py
    python rag/build_index.py --model BAAI/bge-base-en-v1.5
"""
import json
import math
import os
import re
import sys
import time
from collections import Counter

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_DIR = os.path.join(ROOT, "rag", "index")

# Pinned: symlinks are broken on this machine, so fastembed's default cache
# resolution can fail in ways that look like a network error.
CACHE_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "fastembed_cache")

DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"

STOPWORDS = set("""a an and are as at be but by for from has have he her his i if in into is it its of on or
that the their then there these they this to was were what when where which who will with you your not no
do does did can could should would may might must been being had having about above after again against all
am any because before below between both during each few further here how him himself more most other our
over own same she some such than too under until up very we while why with""".split())


def tokenise(text):
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2 and t not in STOPWORDS]


def build_bm25(chunks, k1=1.5, b=0.75):
    """Classic BM25. Precomputes per-chunk term frequencies and the IDF table so
    scoring at query time is a dict lookup per term rather than a corpus scan."""
    docs = [tokenise(c["embed_text"]) for c in chunks]
    lengths = [len(d) for d in docs]
    avgdl = sum(lengths) / len(lengths)
    df = Counter()
    for d in docs:
        df.update(set(d))
    n = len(docs)
    idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}

    postings = []
    for d, dl in zip(docs, lengths):
        tf = Counter(d)
        scored = {}
        for term, f in tf.items():
            scored[term] = (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avgdl))
        postings.append(scored)
    return {"idf": idf, "postings": postings, "avgdl": avgdl}


def main():
    model_name = DEFAULT_MODEL
    if "--model" in sys.argv:
        model_name = sys.argv[sys.argv.index("--model") + 1]

    with open(os.path.join(INDEX_DIR, "chunks.json"), encoding="utf-8") as fh:
        chunks = json.load(fh)
    print("%d chunks loaded" % len(chunks))

    from fastembed import TextEmbedding
    print("loading %s (cache: %s)" % (model_name, CACHE_DIR))
    t0 = time.time()
    embedder = TextEmbedding(model_name=model_name, cache_dir=CACHE_DIR)
    print("model ready in %.1fs" % (time.time() - t0))

    t0 = time.time()
    vectors = np.array(list(embedder.embed([c["embed_text"] for c in chunks])), dtype=np.float32)
    elapsed = time.time() - t0
    # Normalise once at build time so query-time similarity is a plain dot product.
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    vectors = vectors / np.clip(norms, 1e-8, None)

    print("embedded %d chunks in %.1fs (%.0f chunks/s), dim=%d, matrix=%.2f MB" % (
        len(chunks), elapsed, len(chunks) / elapsed, vectors.shape[1], vectors.nbytes / 1e6))

    np.save(os.path.join(INDEX_DIR, "vectors.npy"), vectors)

    print("building BM25 term index")
    bm25 = build_bm25(chunks)
    with open(os.path.join(INDEX_DIR, "bm25.json"), "w", encoding="utf-8") as fh:
        json.dump(bm25, fh)

    meta = {
        "model": model_name,
        "dim": int(vectors.shape[1]),
        "chunks": len(chunks),
        "vocabulary": len(bm25["idf"]),
        "built": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with open(os.path.join(INDEX_DIR, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)

    print("\n%s" % json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
