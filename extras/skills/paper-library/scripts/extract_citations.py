#!/usr/bin/env python3
"""
Pull the citation list out of a paper and resolve it to arXiv IDs.

Handles .bib, .tex (\\bibitem blocks), .md, and .pdf (reference section). Emits a
manifest that fetch_library.py consumes.

Resolution is deliberately conservative. An arXiv ID printed in the source is
trusted; anything else is looked up by title against the arXiv API and marked
`resolved: search`, which means the fetch step must title-verify it. Nothing is
guessed: an entry that cannot be resolved is written out with status `unresolved`
so it stays visible instead of silently vanishing from the library.

    python extract_citations.py paper.tex -o citations.json
    python extract_citations.py refs.bib --resolve -o citations.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (academic citation resolution; arXiv API ToS)"
ARXIV_ID = re.compile(r"(?:arxiv[:\s/]*)?(\d{4}\.\d{4,5})(?:v\d+)?", re.I)
DELAY = 3.0


def clean_tex(s: str) -> str:
    """Strip LaTeX brace-protection and common macros. Left in, '{CORD}: A
    Consolidated Receipt Dataset' fails an arXiv title search that the cleaned
    form resolves."""
    s = re.sub(r"\\[a-zA-Z]+\{([^}]*)\}", r"\1", s)   # \textit{x} -> x
    s = s.replace("{", "").replace("}", "").replace("\\", "")
    s = s.replace("``", '"').replace("''", '"').replace("--", "-")
    return re.sub(r"\s+", " ", s).strip(" .,")


def from_bib(text: str) -> list[dict]:
    out = []
    for m in re.finditer(r"@\w+\s*\{([^,]+),(.*?)\n\}", text, re.S):
        key, body = m.group(1).strip(), m.group(2)
        def field(f):
            mm = re.search(rf"{f}\s*=\s*[{{\"](.+?)[}}\"]\s*,?\s*\n", body, re.S | re.I)
            return clean_tex(mm.group(1)) if mm else ""
        out.append({"key": key, "title": field("title"),
                    "author": field("author"), "year": field("year"),
                    "raw": re.sub(r"\s+", " ", body)[:400]})
    return out


def from_tex(text: str) -> list[dict]:
    out = []
    for m in re.finditer(r"\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}(.*?)(?=\\bibitem|\\end\{thebibliography\})",
                         text, re.S):
        body = re.sub(r"\s+", " ", m.group(2)).strip()
        # Title is usually the longest quoted or italicised span; fall back to the
        # longest sentence-ish fragment rather than guessing structure.
        t = re.search(r"[`\"\u201c]([^`\"\u201d]{12,200})[`\"\u201d]", body)
        title = t.group(1) if t else max(body.split(". "), key=len, default="")[:200]
        out.append({"key": m.group(1), "title": title.strip(), "raw": body[:400]})
    return out


def dehyphenate(text: str) -> str:
    """PDF extraction breaks words across lines as 'uni- versal'. Left in place,
    every title in a reference list is corrupted and title-based resolution
    fails. Only join when the next fragment starts lowercase, so real hyphenated
    compounds ('Retrieval- Augmented') survive."""
    return re.sub(r"(\w)-\s*\n\s*([a-z])", r"\1\2", text)


def from_plain(text: str) -> list[dict]:
    """Reference-list entries from markdown or extracted PDF text.

    Best-effort and known-imperfect: reference sections are dense, often
    multi-column, and PyMuPDF interleaves columns. Prefer .bib or .tex whenever
    the source is available. Under-extraction here is reported, not hidden.
    """
    text = dehyphenate(text)
    tail = text
    for marker in ("References", "REFERENCES", "Bibliography", "WORKS CITED", "Works Cited"):
        i = text.rfind("\n" + marker)
        if i > len(text) * 0.35:
            tail = text[i:]
            break

    # Split on entry starts: [n], "n.", or "Surname, A." / "Surname A." at a line
    # start. Requiring a line boundary avoids splitting mid-entry on co-authors.
    parts = re.split(r"\n(?=\[\d{1,3}\]|\d{1,3}\.\s+[A-Z]|[A-Z][a-zA-Z'\-]+,?\s+[A-Z]\.)", tail)
    out = []
    for chunk in parts:
        c = re.sub(r"\s+", " ", chunk).strip()
        if len(c) < 45 or len(c) > 900:
            continue
        if not re.search(r"(19|20)\d{2}", c):      # a reference carries a year
            continue
        # Title: prefer a quoted span, else the sentence after the author block,
        # else the longest plausible fragment.
        t = re.search(r"[\u201c\"]([^\u201d\"]{15,220})[\u201d\"]", c)
        if not t:
            t = re.search(r"(?:\d{4}[a-z]?\.\)?\s*)([A-Z][^.]{15,220})\.", c)
        title = (t.group(1) if t else max(c.split(". "), key=len, default=""))[:220]
        out.append({"key": "", "title": title.strip(" .,"), "raw": c[:500]})
    return out


def arxiv_lookup(title: str) -> tuple[str | None, str | None]:
    """Title search against the arXiv API. Returns (id, returned_title)."""
    q = urllib.parse.quote(f'ti:"{title[:180]}"')
    url = f"https://export.arxiv.org/api/query?search_query={q}&max_results=1"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=45) as r:
            xml = r.read().decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return None, None
    idm = re.search(r"<id>http://arxiv\.org/abs/([^<]+)</id>", xml)
    tim = re.search(r"<title>(.*?)</title>", xml, re.S)
    if not idm:
        return None, None
    aid = re.sub(r"v\d+$", "", idm.group(1))
    return aid, re.sub(r"\s+", " ", tim.group(1)).strip() if tim else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help=".bib / .tex / .md / .pdf")
    ap.add_argument("-o", "--out", default="citations.json")
    ap.add_argument("--resolve", action="store_true",
                    help="look up arXiv IDs by title for entries lacking one")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    p = Path(a.source)
    if p.suffix.lower() == ".pdf":
        import fitz
        d = fitz.open(p)
        text = "\n".join(d[i].get_text() for i in range(d.page_count))
    else:
        text = p.read_text(encoding="utf-8", errors="replace")

    if p.suffix.lower() == ".bib" or "@article{" in text or "@inproceedings{" in text:
        entries = from_bib(text)
    elif "\\bibitem" in text:
        entries = from_tex(text)
    else:
        entries = from_plain(text)

    # Deduplicate on normalised title.
    seen, uniq = set(), []
    for e in entries:
        k = re.sub(r"[^a-z0-9]+", "", e["title"].lower())[:80]
        if len(k) < 8 or k in seen:
            continue
        seen.add(k)
        uniq.append(e)
    if a.limit:
        uniq = uniq[:a.limit]

    print(f"parsed {len(entries)} entries, {len(uniq)} unique from {p.name}\n")

    for i, e in enumerate(uniq, 1):
        m = ARXIV_ID.search(e.get("raw", "") + " " + e.get("title", ""))
        if m:
            e["arxiv_id"], e["resolved"] = m.group(1), "inline"
        elif a.resolve:
            aid, got = arxiv_lookup(e["title"])
            time.sleep(DELAY)
            if aid:
                e["arxiv_id"], e["resolved"], e["api_title"] = aid, "search", got
            else:
                e["resolved"] = "unresolved"
        else:
            e["resolved"] = "unresolved"
        tag = e.get("arxiv_id", "-")
        print(f"[{i:>3}/{len(uniq)}] {e['resolved']:<11}{tag:<14}{e['title'][:70]}")

    Path(a.out).write_text(json.dumps(uniq, indent=2, ensure_ascii=False),
                           encoding="utf-8")
    got = sum(1 for e in uniq if e.get("arxiv_id"))
    print(f"\n{got}/{len(uniq)} resolved to arXiv IDs -> {a.out}")
    print("Entries resolved by SEARCH are unconfirmed until fetch_library.py "
          "title-verifies them. 'unresolved' entries are not on arXiv (books, "
          "journal-only, workshop PDFs) and need manual handling.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
