---
name: paper-library
description: Build and query a verified, quotation-backed literature library from a set of papers or citations. Use when the user says "build a paper library", "ingest these citations", "pull the works cited from this paper", "download and verify these references", "check my bibliography is real", "what does the literature say about X", "find me a quote for this claim", "which paper supports this", or points at a .tex/.bib/.pdf and asks to collect, verify, or interrogate its references. Downloads every paper, TITLE-VERIFIES each against its claimed citation (catching hallucinated or misresolved IDs), extracts structured cards via parallel Sonnet workers, and synthesizes a routing INDEX.md. Every later answer from the library must carry a verified verbatim quotation from the source. NOT for reading a single paper you already have (just read it) or for web literature search (use WebSearch, then bring the citations here).
---

# paper-library: verified literature, quotable on demand

Three tiers, and the reason for each:

| tier | file | answers |
|---|---|---|
| router | `INDEX.md` | *which* papers matter for this question |
| cards | `cards/<id>.md` | what each paper claims, with conditions attached |
| source | `txt/`, `pdf/` | the exact words |

Working one tier too shallow is what this skill exists to prevent. A summary once
turned an additive result into a super-additive one; a positioning argument was built
on an unread paper; a threshold was cited from a description of an appendix. All
three were caught by dropping a tier.

**The rule that makes it an instrument rather than a folder: every claim drawn from
the library carries a verified verbatim quotation.** See `references/query-protocol.md`
— read it before answering anything from a library.

---

## Mode 1 — BUILD

### 1. Collect citations

From one of your papers, or any bibliography:

```bash
python scripts/extract_citations.py paper.tex --resolve -o citations.json
```

Handles `.bib`, `.tex` (`\bibitem`), `.md`, and `.pdf` reference sections. IDs printed
in the source are trusted (`resolved: inline`); everything else is looked up by title
against the arXiv API (`resolved: search`) and stays unconfirmed until step 2.
Entries marked `unresolved` are not on arXiv — books, journal-only, workshop PDFs.
**Report these to the user rather than dropping them.** A library that silently
excludes a third of a bibliography is worse than no library.

### 2. Download and VERIFY

```bash
python scripts/fetch_library.py <lib> --citations citations.json
```

This is the step that justifies the whole skill. Every PDF's page-1 title is matched
against the claimed citation. **An arXiv ID that resolves to a different real paper
is the failure that survives casual checking** — the download succeeds, the file is a
valid PDF of *something*.

Inspect every `TITLE_MISMATCH`. Most are PDF line-hyphenation (`LAN- GUAGE`,
`INSTRUC- TION`) or a citation with a word dropped from the title. A genuine mismatch
means the citation points at the wrong paper — tell the user, do not quietly fix it.

Report the verified count explicitly. "82/82 verified, 3 flagged and all false
alarms" is a result worth stating.

### 3. Extract cards — parallel Sonnet, size-balanced

Batch by **word count, not paper count**: target ~55k words per worker so nobody runs
out of context mid-paper. A 40k-word paper gets its own batch.

```python
# balance batches greedily by word count, then launch one Sonnet agent per batch
```

Each agent gets: `references/card-spec.md`, its paper list, and — this matters —
**targeted extraction questions for its specific papers**. Ask for the numbers,
definitions, and procedures the project actually needs. Generic instructions produce
generic cards. Examples that earned their keep:

- "Extract the individual and combined gains and state explicitly whether the
  combination exceeds *the sum* or merely each part. Show the arithmetic."
- "Determine whether this paper tests any weight-based method or only inference-time
  ones, and say so plainly."
- "Describe the procedure operationally, in enough detail to reimplement."
- "Capture the exact definition verbatim in a blockquote."

Use `subagent_type: general-purpose`, `model: sonnet`. Opus synthesizes; Sonnet
extracts.

### 4. Synthesize the index — Opus, not delegated

`INDEX.md` is judgement, and judgement is the layer that should not be batched out.
Organise by **what a paper is for**, not by topic — topical buckets assigned before
reading are routinely wrong, and the extracting agents will flag it. Include:

- a table mapping **each claim the project holds** to the papers that support and
  threaten it
- positioning: which papers constrain what can be claimed as novel
- instruments: published protocols that could resolve open questions
- reclassifications, with what each paper is still legitimately good for
- directions the library supports that nobody is pursuing yet

---

## Mode 2 — QUERY

Read `references/query-protocol.md`. In short:

1. `INDEX.md` to route
2. `cards/<id>.md` to orient
3. `scripts/quote.py search <lib> "phrase" --ids <id>` to find the words
4. `scripts/quote.py verify <lib> --id <id> --text "exact words"` **before emitting**
5. Answer with the quote inline, plus its conditions

`verify` returning NOT FOUND means the quote is paraphrased, misremembered, or from
another paper. Do not use it. The tool prints the closest span so near-misses are
visible.

**Cards are enough** for orientation, scope, and relevance. **Cards are not enough**
for any number you will state, any definition, any threshold, any method you will
reimplement, or anything the card's "Not captured" section disclaims.

**Numbers that live only in tables must be read from the PDF.** Extraction is layout
order; tables lose structure and a number can land beside the wrong row label.

---

## Layout

```
<library>/
  INDEX.md              router (Opus)
  cards/<id>.md         one per paper (Sonnet)
  txt/<id>.txt          extracted full text
  pdf/<id>.pdf          source
  verification.json     per-paper title match, pages, size
  citations.json        parsed bibliography with resolution status
```

## When NOT to use this

- One paper you already have: read it.
- Finding papers that exist: `WebSearch` first, then bring citations here.
- A corpus past ~300 papers, or weekly cross-corpus semantic queries: the
  paper-level design starts to strain and chunk-level retrieval earns its keep. Below
  that it does not — the whole library fits in a handful of context windows, and
  chunk retrieval actively harms accuracy by stripping numbers from their conditions.

## Honest limits

- Cards are lossy by construction. The mandatory "Not captured" section is the
  mitigation, not a cure.
- Title verification catches wrong papers, not wrong *claims about* right papers.
  Only quoting does that.
- arXiv-only. Journal-only and book citations need manual handling and should be
  reported as gaps, not omitted.
- `quote.py`'s page numbers are estimates from character offsets; never present them
  as exact locations.
