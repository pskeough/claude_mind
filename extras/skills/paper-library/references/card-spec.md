# Card specification

One card per paper at `cards/<id>.md`. Cards are the routing layer: read the whole
index, decide which two or three papers matter, open those. Cards optimise for
**deciding what to read**, never for replacing reading.

## The governing rule

**A card must never let a number be quoted without the conditions that produced it.**

A real example of the failure: a summary recorded "+14.92% RAG, +1.07% PEFT, +15.98%
combined" and concluded super-additivity. But 14.92 + 1.07 = 15.99, so the
combination was exactly *additive*. Every number was correct; the conclusion was
backwards, because the numbers travelled without the arithmetic that framed them.

Record the conditions, or omit the number and say the table must be read.

## Format

````markdown
---
id: 2409.09510
title: <exact title from the paper's own first page>
authors: <first author et al., or up to 3>
venue: <venue and year if the paper states it; else "arXiv preprint YYYY">
section: <topic tag supplied in the batch>
---

## Claim
One or two sentences. What the paper establishes, in its own terms.

## Setup
Models, datasets, sample sizes, task. Specific enough to judge transfer:
"Qwen3-32B, 50 authors, 1000 generations", not "large models on a corpus".

## Key numbers
Each bullet: the number, then the exact condition it holds under. "n/a" if the paper
is qualitative. Four precise numbers beat twelve vague ones. If a number only makes
sense inside a table, say so and cite the table rather than extracting it.

## Quotable
Two to five short verbatim quotes for the load-bearing claims — definitions,
thresholds, headline findings. These are what a future query will cite, so they must
be exact. Use `>` blockquotes. This section is what makes the library assertable
without re-reading every paper.

## Methods or protocols we could reuse
Name the procedure operationally, or "none". "Paraphrase a text, re-embed, test
whether the authorship score survives" — not "discusses style versus content".

## Cite for
Two to four specific claims this paper can support.

## Tension
Where it contradicts, complicates, or bounds the project's findings, or contradicts
another paper in the library. "none identified" if genuinely none. Do not invent
tension; do not paper over it.

## Read in full when
The trigger for opening the PDF.

## Not captured by this card
What a reader would miss by relying on this card alone: unread appendices, tables not
transcribed, caveats that would not compress. **Must be non-empty.** A card claiming
completeness is the failure mode this section exists to prevent.
````

## Rules for the extracting agent

1. **Read the full text** at `txt/<id>.txt` before writing. Long papers may need
   several reads past the tool's page cap; do that rather than truncating.
2. **Never invent.** If the text is truncated, garbled, or missing a section, say so
   in "Not captured". Extraction is PyMuPDF layout order — multi-column pages
   interleave and tables lose structure. Expect it and report it.
3. **Quote exactly** where wording is load-bearing. Verbatim, including punctuation.
4. **Do the arithmetic** when a paper reports components and a combination. State
   whether the combination exceeds the *sum* or merely each part. This is where
   summaries most reliably go wrong.
5. **Flag topic mismatches.** If the paper is not what its section tag says, state
   that at the top of the card. A wrong label is how a paper gets cited for something
   it never said.
6. **Do not editorialise** about the project's merits. Record what the paper says and
   where it touches the work. Judgement lives in the index.

## Batching

Size-balance batches by word count, not paper count — target roughly 55k words per
agent so no worker runs out of context mid-paper. Give each batch its papers plus
any **targeted extraction questions** for that batch: the specific numbers,
definitions, or procedures the project actually needs. Generic instructions produce
generic cards.
