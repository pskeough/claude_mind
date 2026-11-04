#!/usr/bin/env python3
"""
Download papers, extract text, and VERIFY each is the paper it claims to be.

Verification is the reason this skill exists. Citation lists — whether produced by
agents, parsed from a bibliography, or resolved by title search — contain IDs that
resolve to a *different real paper*. That failure survives casual checking, because
the download succeeds and the file is a valid PDF of something. So every download
is title-matched against the expected title, and mismatches are reported loudly.

    python fetch_library.py <library_dir> --citations citations.json
    python fetch_library.py <library_dir> --ids 2409.09510 2402.04401
    python fetch_library.py <library_dir> --verify-only
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path

ARXIV_ID = re.compile(r"^(\d{4}\.\d{4,5}|[a-z][a-z\-]*(\.[A-Z]{2})?/\d{7})(v\d+)?$")

UA = "Mozilla/5.0 (research literature collection; arXiv ToS)"
DELAY = 3.0


def norm(s: str) -> str:
    s = re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())
    return re.sub(r"\s+", " ", s).strip()


def fetch(aid: str, dest: Path) -> str | None:
    req = urllib.request.Request(f"https://arxiv.org/pdf/{aid}",
                                 headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = r.read()
        if not data.startswith(b"%PDF"):
            return "not a PDF (likely an HTML error page)"
        dest.write_bytes(data)
        return None
    except Exception as e:  # noqa: BLE001
        return f"{type(e).__name__}: {e}"


def extract(pdf: Path, txt: Path):
    try:
        import fitz
        d = fitz.open(pdf)
        pages = [d[i].get_text() for i in range(d.page_count)]
        n = d.page_count
        d.close()
        txt.write_text("\n\n".join(pages), encoding="utf-8", errors="replace")
        return None, (pages[0] if pages else ""), n
    except Exception as e:  # noqa: BLE001
        return f"{type(e).__name__}: {e}", "", 0


def guess_title(first_page: str) -> str:
    out, started = [], False
    for l in [x.strip() for x in first_page.splitlines()][:40]:
        if not l:
            if started:
                break
            continue
        if re.match(r"^(arxiv:|preprint|under review|published|proceedings|\d+$)", l.lower()):
            continue
        if len(l) < 3:
            continue
        out.append(l); started = True
        if len(" ".join(out)) > 160:
            break
    return " ".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("library")
    ap.add_argument("--citations", help="citations.json from extract_citations.py")
    ap.add_argument("--ids", nargs="*", help="bare arXiv IDs")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--threshold", type=float, default=0.60)
    a = ap.parse_args()

    lib = Path(a.library)
    pdf_d, txt_d = lib / "pdf", lib / "txt"
    pdf_d.mkdir(parents=True, exist_ok=True)
    txt_d.mkdir(parents=True, exist_ok=True)

    papers = []
    if a.citations:
        for e in json.loads(Path(a.citations).read_text(encoding="utf-8")):
            if e.get("arxiv_id"):
                papers.append((e["arxiv_id"], e.get("api_title") or e.get("title", ""),
                               e.get("resolved", "?")))
    for i in (a.ids or []):
        papers.append((i, "", "manual"))
    if not papers:
        sys.exit("nothing to fetch: pass --citations or --ids")

    results = []
    for n, (aid, expected, how) in enumerate(papers, 1):
        # The id comes from a remote API response and becomes a filename, so it must
        # look like an arXiv id. Old-style ids ("hep-th/9901001") keep their slash in
        # the URL but not in the filename.
        if not ARXIV_ID.match(aid):
            print(f"[{n:>3}/{len(papers)}] skipped: not an arXiv id: {aid[:60]!r}")
            continue
        stem = aid.replace("/", "_")
        pdf, txt = pdf_d / f"{stem}.pdf", txt_d / f"{stem}.txt"
        rec = {"arxiv_id": aid, "expected_title": expected, "resolved_by": how}

        if not pdf.exists() and not a.verify_only:
            err = fetch(aid, pdf)
            time.sleep(DELAY)
            if err:
                rec.update(status="DOWNLOAD_FAILED", detail=err)
                results.append(rec)
                print(f"[{n:>3}/{len(papers)}] {aid:<12} DOWNLOAD FAILED  {err}")
                continue
        if not pdf.exists():
            rec.update(status="MISSING"); results.append(rec); continue

        err, page1, pages = extract(pdf, txt)
        if err:
            rec.update(status="EXTRACT_FAILED", detail=err)
            results.append(rec)
            print(f"[{n:>3}/{len(papers)}] {aid:<12} EXTRACT FAILED  {err}")
            continue

        found = guess_title(page1)
        sim = SequenceMatcher(None, norm(expected), norm(found)).ratio() if expected else 0.0
        contained = bool(expected) and norm(expected)[:70] in norm(page1)[:1200]
        ok = (not expected) or sim >= a.threshold or contained
        rec.update(status="VERIFIED" if ok else "TITLE_MISMATCH",
                   similarity=round(sim, 3), contained=contained,
                   found_title=found[:180], pages=pages,
                   pdf_kb=round(pdf.stat().st_size / 1024))
        results.append(rec)
        flag = "" if ok else "   <<< CHECK"
        note = " (no expected title — UNVERIFIED)" if not expected else ""
        print(f"[{n:>3}/{len(papers)}] {aid:<12} {rec['status']:<15} "
              f"sim={sim:.2f} {pages}p{flag}{note}")

    (lib / "verification.json").write_text(json.dumps(results, indent=2),
                                           encoding="utf-8")
    v = sum(1 for r in results if r["status"] == "VERIFIED")
    mism = [r for r in results if r["status"] == "TITLE_MISMATCH"]
    fail = [r for r in results if "FAILED" in r["status"] or r["status"] == "MISSING"]
    print(f"\nVERIFIED {v}/{len(papers)}   mismatches {len(mism)}   failures {len(fail)}")
    for r in mism:
        print(f"  MISMATCH {r['arxiv_id']}\n     expected: {r['expected_title'][:95]}"
              f"\n     found:    {r.get('found_title','')[:95]}")
    for r in fail:
        print(f"  FAILED   {r['arxiv_id']}  {r.get('detail','')[:90]}")
    if mism:
        print("\nInspect every mismatch before writing cards. Most are PDF "
              "line-hyphenation artifacts (LAN- GUAGE), but a genuine mismatch "
              "means the citation points at the wrong paper.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
