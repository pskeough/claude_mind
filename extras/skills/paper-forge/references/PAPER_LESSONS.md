# Paper lessons: the gate every paper passes

Living note. forge_setup.py copies it into each run as `input/PAPER_LESSONS.md`, and the workflows cite its rules by number. Keep the numbering stable. To keep your own copy with your own evidence rows, save it in your project or notes folder and point `lessonsFile` in the args at it.

## Evidence base (append your own rows)

Add a row each time a review, desk decision or mentor read comes back.

| Date | Paper | Source | What they said |
|---|---|---|---|
| | | | |

The rules below came from one researcher's run of reviews: a mentor read, a desk reject on formatting, an internal AI-tell sweep, and a two-reviewer reject. The common thread was that the work was not lost on the science. It was lost on whether a stranger could read it and trust it in the first ten minutes. Neither reviewer in the reject found an error in the analysis. One said they could not review it fully because they could not follow it.

## The failure behind that reject

A pre-submission audit had already written down four of the reviewers' seven points. It had also caught errors the reviewers missed: an impossible F/p pair, a false claim in the abstract, and percentages computed on a 1-5 scale. The corrected statistic and a self-preference test were already in a newer manuscript version. None of it reached the submitted PDF. There was no list of which findings were closed, and no check that the submitted PDF matched that list.

The fix is procedural, and it is Rule 1.

## The gate: rules for every paper

### 1. Close the audit before submitting
- Every audit finding gets a status in the ledger: FIXED (with the line it changed), or WONTFIX with a one-sentence reason the author agrees with.
- No submission with an open BLOCKER.
- After the final build, re-check each FIXED item against the compiled PDF, not the source. A fix in the .tex that never compiled does not count.
- If the ledger cannot close before the deadline, submit to the next venue instead. A paper with known errors under your name on a public review site is a cost, even at a non-archival venue.

### 2. Check every internal promise
- Every "see Appendix X", "full tables in", "Table N shows" must point at content that exists. Grep the PDF text for "Appendix", "Table" and "Figure", and open each target.
- Every figure and table must be called out by number in the body at the point of the claim.
- The abstract's headline number must be in the main text, with the equation that produces it. It must not live only in the last appendix.

### 3. Recompute the statistics by hand
- F, df and p must agree. Recompute p from F and df yourself.
- Do not quote percentage change on a scale with a floor above zero (Likert 1-5). Report raw points plus an effect size.
- State the denominator for every rate once and use it everywhere.
- Design cells must multiply to N. If they do not, say why.
- If a sample is stratified on the variable being analysed, weight it or say why not.

### 4. Carry fixes forward across versions
Before building a paper from an older manuscript, diff it against the newest version of the same analysis and pull every correction forward. The reject above was built from older text while a newer version had the fixes.

### 5. Prove the problem exists outside your pipeline
- If the object of study is a metric or protocol, cite three or more published papers or audits that use it, with quotes. "Common practice" with no citation is what a reviewer will attack.
- If the object is something your own pipeline built, show the same thing in at least one public benchmark or dataset that is not yours. Reviewers may name the benchmark they expect.

### 6. Never let one model family judge itself unaddressed
- If a model family both generates and judges, the headline numbers must come from a cross-family judge, or a self-preference test must be in the main text.
- Cite the self-preference literature (for example Panickssery et al. on LLM self-recognition and self-preference, and Spiliopoulou et al., "Play Favorites").

### 7. Name everything a reader needs to replicate
- Every model with its exact version string and access dates.
- The model that wrote the prompts.
- The judge, its temperature and the number of votes.
- The counts per cell.
- Put all of this in one setup table in the main text. Reviewers treat a missing list as a sign of carelessness everywhere else.

### 8. Write for someone reading cold
- Abstract: at most three claims, one number per sentence.
- Give a concrete example on page 1 before any statistic, ideally with a picture.
- Figure 1 shows the method or the core contrast, not a secondary result.
- Define each term once and use only that term. Do not coin names unless you need them.
- Cut every section that is not the contribution.
- **Cold-reader test before submitting.** Someone who has not seen the paper reads only the abstract, intro and Figure 1, then says the claim back in one sentence. If they cannot, the paper is not ready. Use a colleague who has not read the draft, or a fresh Claude session with no project context told to write a reviewer summary. Compare that summary with the intended claim.

### 9. Keep the drafting process honest and visible
- The author writes the claim sentences: the one-sentence contribution, each section's point, the Discussion's interpretations. AI drafts connective text and does verification.
- AI drafts can pass a word-level scrub while carrying structural tells. Run the structural sweep too: paragraph openers, closer formulas, repeated skeletons, announce-a-count openers, one modesty formula reused.
- **The generative-AI disclosure must describe what actually happened.** If more of the prose was machine-drafted than "copy-editing", a disclosure that says copy-editing understates it. Venues are starting to check. An accurate disclosure is safer than a flattering one, and most venues accept substantial AI assistance when it is stated.

### 10. Formatting is a gate, not polish
- Before any build, read the venue's CFP and template and write a format checklist: page limit and what counts, anonymity, template options, required sections (limitations, ethics, checklist), reference style.
- Run the checklist against the compiled PDF. A desk reject on format means the paper never reaches a reviewer.

### 11. Freeze early
The ledger closes and the PDF freezes 72 hours before the deadline. The last three days are for the cold-reader test and the promise and format checks, not for new analysis.
