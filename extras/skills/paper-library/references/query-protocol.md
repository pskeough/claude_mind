# Query protocol — the quotation rule

This is the part of the skill that matters. A library that stores PDFs is a folder.
A library that cannot assert anything without producing the source text is an
instrument.

## The rule

**Every factual claim drawn from the library carries a direct quotation from the
source, and every quotation is verified before it is emitted.**

Not "cite the paper." Not "according to Smith et al." A quotation, in quote marks,
that a reader can find in `txt/<id>.txt`.

## Why it is enforced mechanically rather than by instruction

Because summarising is where the errors happen, and they are not obvious errors:

- A summary reported "+14.92% RAG, +1.07% PEFT, +15.98% combined" as evidence of
  *super-additivity*. 14.92 + 1.07 = 15.99. The combination was exactly additive. The
  numbers were right and the conclusion was inverted.
- A positioning document was written against a paper nobody had read, from a
  second-hand description. Several details were wrong.
- A threshold was cited from a description of an appendix rather than the appendix.

In each case the fix was reading the source. `quote.py verify` makes reading the
source the cheapest option rather than the most expensive.

## Answering a question from the library

1. **Route.** Read `INDEX.md`. It maps claims and topics to papers. Do not grep first
   and route later; the index exists so you open two papers instead of twelve.
2. **Read the card** for each candidate (`cards/<id>.md`). The card tells you the
   claim, the numbers with their conditions, and — critically — its own
   "Not captured" section.
3. **Decide whether the card is enough.** It is enough for orientation, scope, and
   whether a paper is relevant. It is **not** enough for: any number you intend to
   state, any definition, any threshold, any methodological detail you intend to
   reimplement, or anything the card's "Not captured" section disclaims.
4. **Get the quote.**
   ```
   python scripts/quote.py search <lib> "the phrase you expect" --ids <id>
   ```
5. **Verify it before using it.**
   ```
   python scripts/quote.py verify <lib> --id <id> --text "the exact words"
   ```
   `NOT FOUND` means the quote is paraphrased, misremembered, or from a different
   paper. Do not use it. The tool prints the closest span so a near-miss is visible.
6. **Answer**, with the quote and its source inline.

## Format

> **Claim.** Llama 2 defines contamination at a 10-token threshold.
>
> **Source.** arXiv:2307.09288, Appendix A.6, verified verbatim:
> > "We consider a token to be contaminated if it appears in any token n-gram longer
> > than 10 tokens in both the evaluation sample and the training set"
>
> **Caveat.** They match on *tokenized* input with a 4-token skipgram budget. A
> word-level strict check is more conservative.

The caveat line is not optional when one exists. A quote stripped of its conditions
is the failure this skill was built to prevent.

## When there is no quote

Say so. Acceptable answers include:

- "The card asserts this but I could not verify it in the text — the paper may state
  it in a table, which extraction flattens."
- "This is in the 'Not captured' section of the card; the PDF needs reading directly."
- "No paper in this library addresses that."

**Never** substitute a plausible paraphrase for a verified quote. An unverifiable
claim reported as unverifiable is useful. An unverifiable claim reported as fact is
the thing that makes the whole library worthless.

## Tables, numbers, and extraction limits

Text comes from PyMuPDF in layout order. Multi-column pages interleave, and tables
lose their structure — a number can end up adjacent to the wrong row label. So:

- A number found in running prose can be quoted.
- A number that only exists inside a table must be read from the **PDF**, not the
  text dump. Quote the table and figure number, and say you read the PDF.
- If a quote looks garbled or a sentence runs into unrelated text, that is a column
  boundary. Do not repair it silently; either quote the PDF or say the extraction is
  unreliable there.

## Multi-paper synthesis

When several papers bear on one question, quote **each** of them. A synthesis
sentence with one quote attached implies the other papers said something they may
not have. If two sources disagree, quote both and say they disagree — the
disagreement is usually the finding.
