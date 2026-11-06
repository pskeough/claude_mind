"""
Split the knowledge base into retrievable chunks.

The knowledge base was written so that every `##` section stands alone (decision
D003), which means the chunk boundary is already authored rather than inferred.
This splitter respects that boundary exactly and does no further subdivision: a
recursive character splitter would cut a safety rule in half, which is the one
failure this design exists to avoid.

Each chunk carries its file's frontmatter (title, section, tags, summary) so a
chunk retrieved alone still says what it is and where it came from.

    python rag/chunk.py            write rag/index/chunks.json
    python rag/chunk.py --stats    report size distribution and outliers
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB = os.path.join(ROOT, "kb")
INDEX_DIR = os.path.join(ROOT, "rag", "index")

# Chunks outside this band are reported by --stats. The floor catches stubs; the
# ceiling catches sections that should have been split when they were written.
MIN_WORDS, MAX_WORDS = 120, 1100

# `## Sources` is bibliography, not clinical content. It is excluded from the
# retrieval index so a source list never wins a slot over a real answer; the
# bibliography lives in _sources.jsonl and research/BIBLIOGRAPHY.md instead.
SKIP_HEADINGS = {"sources"}


def parse_frontmatter(text):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw, body = text[3:end], text[end + 4:]
    meta = {}
    for line in raw.splitlines():
        m = re.match(r"^([a-zA-Z_]+):\s*(.*)$", line.strip())
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if val.startswith("[") and val.endswith("]"):
            meta[key] = [t.strip() for t in val[1:-1].split(",") if t.strip()]
        else:
            meta[key] = val
    return meta, body


def chunk_file(path):
    rel = os.path.relpath(path, ROOT).replace("\\", "/")
    section = rel.split("/")[1]
    filename = os.path.basename(path)
    with open(path, encoding="utf-8") as fh:
        meta, body = parse_frontmatter(fh.read())

    # Split on H2 only. H3 and deeper stay inside their parent chunk.
    parts = re.split(r"^## (.+)$", body, flags=re.MULTILINE)
    out = []
    for i in range(1, len(parts), 2):
        heading = parts[i].strip()
        content = parts[i + 1].strip()
        if heading.strip().lower().rstrip(":") in SKIP_HEADINGS:
            continue
        if not content:
            continue

        # The retrievable text is prefixed with its provenance so that a chunk
        # arriving alone in a prompt announces its own section and file. This also
        # gives the embedder the file-level topic, which measurably helps short
        # chunks whose heading alone is ambiguous ("Step 4: Set priors from base
        # rates" means little without "clinical reasoning" attached).
        header = "[%s / %s] %s\n\n%s" % (section, filename, meta.get("title", ""), heading)
        out.append({
            "id": "%s::%s::%s" % (section, filename, re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")[:60]),
            "section": section,
            "file": filename,
            "path": rel,
            "doc_title": meta.get("title"),
            "doc_summary": meta.get("summary"),
            "tags": meta.get("tags", []),
            "heading": heading,
            "text": content,
            "embed_text": "%s\n\n%s" % (header, content),
            "words": len(content.split()),
        })
    return out


def main():
    chunks = []
    for section in sorted(os.listdir(KB)):
        sec_dir = os.path.join(KB, section)
        if not os.path.isdir(sec_dir):
            continue
        for name in sorted(os.listdir(sec_dir)):
            if name.endswith(".md"):
                chunks.extend(chunk_file(os.path.join(sec_dir, name)))

    os.makedirs(INDEX_DIR, exist_ok=True)
    with open(os.path.join(INDEX_DIR, "chunks.json"), "w", encoding="utf-8") as fh:
        json.dump(chunks, fh, ensure_ascii=False, indent=1)

    words = [c["words"] for c in chunks]
    print("%d chunks from %d files" % (chunks.__len__(), len({c["path"] for c in chunks})))
    print("words: min %d  median %d  mean %d  max %d  total %d" % (
        min(words), sorted(words)[len(words) // 2], sum(words) // len(words), max(words), sum(words)))

    by_section = {}
    for c in chunks:
        by_section.setdefault(c["section"], []).append(c)
    print()
    for sec in sorted(by_section):
        cs = by_section[sec]
        print("  %-24s %3d chunks  %6d words" % (sec, len(cs), sum(c["words"] for c in cs)))

    if "--stats" in sys.argv:
        outliers = [c for c in chunks if not (MIN_WORDS <= c["words"] <= MAX_WORDS)]
        print("\n%d chunks outside the %d-%d word band:" % (len(outliers), MIN_WORDS, MAX_WORDS))
        for c in sorted(outliers, key=lambda c: c["words"]):
            print("  %5d  %s :: %s" % (c["words"], c["file"], c["heading"][:64]))

    print("\n-> %s" % os.path.join(INDEX_DIR, "chunks.json"))


if __name__ == "__main__":
    main()
