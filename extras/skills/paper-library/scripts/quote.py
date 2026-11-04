#!/usr/bin/env python3
"""
Verbatim quotation tool. The enforcement mechanism for this skill's core rule:
every claim made from the library carries a direct quote from the source.

Three modes:

  search   find passages matching a query across the library's full texts
  verify   confirm a proposed quote appears VERBATIM in a given paper
  context  print the surrounding text at an offset, to check a quote in context

`verify` is the important one. Before asserting anything, run the intended quote
through it. If it returns NOT FOUND, the quote is paraphrased, misattributed, or
invented, and must not be used. This is the difference between a library that
prevents fabrication and one that merely stores PDFs.

    python quote.py search  <lib> "cross-author floor" [--ids 2604.26460] [-n 5]
    python quote.py verify  <lib> --id 2307.09288 --text "longer than 10 tokens"
    python quote.py context <lib> --id 2307.09288 --offset 128400 --window 900
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def norm(s: str) -> str:
    """Collapse whitespace only. Case and punctuation are preserved because a
    'verbatim' quote that silently drops punctuation is not verbatim."""
    return re.sub(r"\s+", " ", s or "").strip()


def load_texts(lib: Path, ids: list[str] | None):
    txt = lib / "txt"
    if not txt.is_dir():
        sys.exit(f"no txt/ directory under {lib}")
    out = {}
    for p in sorted(txt.glob("*.txt")):
        pid = p.stem
        if ids and pid not in ids:
            continue
        out[pid] = norm(p.read_text(encoding="utf-8", errors="replace"))
    if not out:
        sys.exit("no matching texts")
    return out


def approx_page(lib: Path, pid: str, offset: int, total_chars: int) -> str:
    """Rough page estimate from the verification report's page count. Rough is
    honest: PyMuPDF text order does not preserve exact page boundaries after
    whitespace collapsing, so never present this as exact."""
    v = lib / "verification.json"
    if not v.exists() or total_chars <= 0:
        return "?"
    try:
        rec = {x["arxiv_id"]: x for x in json.loads(v.read_text(encoding="utf-8"))}
        pages = rec.get(pid, {}).get("pages") or 0
        if pages:
            return f"~p{max(1, round(offset / total_chars * pages))}/{pages}"
    except Exception:  # noqa: BLE001
        pass
    return "?"


def cmd_search(a):
    lib = Path(a.library)
    texts = load_texts(lib, a.ids)
    pat = re.compile(a.query if a.regex else re.escape(a.query), re.I)
    hits = 0
    for pid, t in texts.items():
        for m in pat.finditer(t):
            s = max(0, m.start() - a.before)
            e = min(len(t), m.end() + a.after)
            print(f"\n--- {pid}  offset={m.start()}  {approx_page(lib, pid, m.start(), len(t))}")
            print(t[s:e])
            hits += 1
            if hits >= a.n:
                print(f"\n[{hits} hits shown; raise -n for more]")
                return 0
    print(f"\n[{hits} hit(s)]" if hits else "\n[NO HITS]")
    return 0


def cmd_verify(a):
    lib = Path(a.library)
    texts = load_texts(lib, [a.id] if a.id else None)
    needle = norm(a.text)
    if len(needle) < 12:
        sys.exit("quote too short to verify meaningfully (min 12 chars)")
    found = False
    for pid, t in texts.items():
        i = t.find(needle)
        if i >= 0:
            print(f"VERBATIM MATCH in {pid} at offset {i} "
                  f"({approx_page(lib, pid, i, len(t))})")
            print(f"  ...{t[max(0,i-120):i+len(needle)+120]}...")
            found = True
    if not found:
        print("NOT FOUND — this quote does not appear verbatim in "
              f"{a.id or 'any indexed paper'}.")
        # Offer the closest span so a near-miss (paraphrase, OCR artifact) is
        # visible rather than just failing.
        head = " ".join(needle.split()[:6])
        for pid, t in texts.items():
            j = t.lower().find(head.lower())
            if j >= 0:
                print(f"  closest span in {pid} at {j}:")
                print(f"    ...{t[j:j+len(needle)+160]}...")
                break
        return 1
    return 0


def cmd_context(a):
    lib = Path(a.library)
    texts = load_texts(lib, [a.id])
    t = texts[a.id]
    s = max(0, a.offset - a.window // 2)
    print(f"--- {a.id}  offset={a.offset}  {approx_page(lib, a.id, a.offset, len(t))}")
    print(t[s:s + a.window])
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search")
    s.add_argument("library"); s.add_argument("query")
    s.add_argument("--ids", nargs="*"); s.add_argument("-n", type=int, default=6)
    s.add_argument("--before", type=int, default=200)
    s.add_argument("--after", type=int, default=400)
    s.add_argument("--regex", action="store_true")
    s.set_defaults(fn=cmd_search)

    v = sub.add_parser("verify")
    v.add_argument("library"); v.add_argument("--id"); v.add_argument("--text", required=True)
    v.set_defaults(fn=cmd_verify)

    c = sub.add_parser("context")
    c.add_argument("library"); c.add_argument("--id", required=True)
    c.add_argument("--offset", type=int, required=True)
    c.add_argument("--window", type=int, default=1200)
    c.set_defaults(fn=cmd_context)

    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
