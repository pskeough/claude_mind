---
title: Measuring Therapeutic Process, Alliance, and LLM Output Quality
section: evidence-base
tags: [evaluation, WAI-SR, CTS-R, MITI, PCEPS, alliance, fidelity, LLM-as-judge, rubric, judge-circularity, outcome-measures]
summary: The instruments used to measure alliance, therapist competence, and outcome, how researchers have adapted them to score LLM output and where that adaptation breaks, what a self-evaluation rubric should contain, and which of these would serve as scoring instruments in a study comparing a scaffolded RAG harness against an unscaffolded control.
---

## Three families of measurement, which do not substitute for each other

Evaluating therapeutic work splits into three questions that are routinely conflated. Did the practitioner do the thing the model says to do, which is fidelity or adherence. Did they do it well, which is competence. Did the person get better, which is outcome. A fourth, the quality of the relationship, is measured separately as alliance and predicts outcome across modalities.

The distinction matters for LLM evaluation because most published assessment of AI therapy quality measures none of these cleanly. It asks a rater, often another model, whether a response was good. That produces a number with no established relationship to any validated construct, and it is the single most common methodological weakness in this literature.

The instruments below exist, are validated on human transcripts, and have known psychometric properties. Using them means a comparison to human practitioner performance is meaningful rather than invented, which is why they are preferable to a bespoke quality scale even when adaptation is awkward.

## The Working Alliance Inventory, short revised form

The WAI-SR measures the therapeutic alliance across three subscales derived from Bordin's model: agreement on the goals of therapy, agreement on the tasks of therapy, and the affective bond between the parties. It consists of 12 items rated on a 6-point scale from not at all (1) to very much (6), and exists in client and therapist versions (Hatcher & Gillaspy, 2006; Munder et al., 2010).

Alliance is worth measuring because it is one of the more robust predictors of outcome across therapeutic modalities, which makes it a reasonable proxy when outcome itself cannot be measured.

The adaptation problem is severe and under-acknowledged. The WAI-SR is a self-report instrument completed by a participant in the relationship. Applying it to a transcript means an observer is inferring the client's experience of alliance rather than measuring it, which is a different construct. Applying it to an AI conversation compounds this: the bond subscale asks about a relationship one party is not capable of having, and a high score may indicate the system successfully produced an impression of relationship rather than that a working alliance exists. On this reading a high bond score is at least ambiguous and possibly a warning sign, and any study using WAI-SR on AI transcripts should say which reading it holds.

## Competence and adherence scales

**CTS-R, the Cognitive Therapy Scale Revised.** Twelve items rated 0 to 6, where 0 indicates non-adherence and 6 indicates adherence with very high skill. Items span general therapeutic skills, including interpersonal effectiveness and time management, alongside cognitive-therapy-specific competencies such as guided discovery, conceptual integration, and application of change methods (James, Blackburn & Reichelt). It is the standard instrument for rating CBT competence in training and research, and its factor structure has been examined in training samples (Cambridge, Behavioural and Cognitive Psychotherapy, 2021).

**MITI, Motivational Interviewing Treatment Integrity, version 4.2.1.** Structurally the most useful of these for LLM evaluation because it combines two different kinds of measurement. Behaviour counts are tallies of specific practitioner utterances, and global scores are Likert ratings of overall impression on a 5-point scale where 5 reflects high proficiency. Coding is performed on a randomly selected 20-minute window. Derived metrics include the reflection-to-question ratio and the proportion of MI-adherent responses (Moyers et al., MITI 4.2.1, CASAA).

The behaviour counts are the reason to prefer MITI. They are close to objectively countable from a transcript, which means they can be computed without a subjective judge at all. The reflection-to-question ratio in particular maps directly onto a failure mode this knowledge base targets, namely a system that interrogates rather than reflects. A metric that can be computed deterministically is immune to judge inflation, which makes it the most trustworthy signal available.

**PCEPS, the Person-Centred and Experiential Psychotherapy Scale.** Rates person-centred and experiential process quality. `[UNVERIFIED]` as to item count, scale range, and primary citation; these were not confirmed during compilation and should be checked before use.

**DBT adherence coding.** Structured adherence rating exists for DBT and is used in trials to establish that delivered treatment was in fact DBT. `[UNVERIFIED]` as to the specific instrument and its properties.

## Outcome and session-feedback measures

Symptom instruments serve as endpoints rather than as process measures: PHQ-9 for depression, GAD-7 for anxiety, and the condition-specific measures described in the assessment section of this knowledge base. In an AI context they can only be used where there is a genuine longitudinal deployment with consenting participants, which rules them out for transcript-level evaluation.

The ORS and SRS, the Outcome Rating Scale and Session Rating Scale, are ultra-brief measures designed for session-by-session feedback rather than for research endpoints. Their relevance here is conceptual: they institutionalise the practice of asking the person whether this is working and adjusting when it is not, which is a process an AI system can and should imitate in conversation even without administering the instrument.

## How researchers have adapted these to score LLM output

The dominant approach is LLM-as-judge, in which a model rates transcripts against an adapted instrument. One published pattern prompts the judge to score each conversation in three independent rounds and averages across them to improve consistency, using the WAI as the scoring frame (Interactive Agents, arXiv:2408.15787).

The most substantial reliability work available introduces two benchmarks. MentalBench-100k assembles 10,000 real-world conversations from three datasets, each paired with nine LLM responses, giving 100,000 response pairs. MentalAlign-70k compares four high-performing LLM judges against human experts across 70,000 ratings on seven attributes, grouped into a Cognitive Support Score and an Affective Resonance Score, with agreement quantified by intraclass correlation (arXiv:2510.19032).

Its findings should govern how any evaluation here is designed. LLM judges show systematic inflation, rating responses more favourably than human experts do. Reliability is strong for cognitive attributes such as guidance and informativeness, reduced for empathy, and inconsistent for safety and relevance.

That pattern is close to worst-case for this domain. The attributes LLM judges handle well are the ones a scaffold most easily improves on the surface, and the attributes they handle badly, empathy and safety, are the ones that actually matter. A study that scores only what the judge is good at will find an effect whether or not one exists.

## What a self-evaluation rubric should contain

Distinct from research evaluation, the system needs a rubric it can run against its own draft. The design constraint is that it must be checkable from the text of the reply rather than requiring knowledge the model does not have.

Countable items first, since these are the reliable ones. Number of questions asked. Number of reflections offered, and the ratio between them, borrowing directly from MITI. Number of imperatives and directives. Reply length relative to the person's turn. Presence of diagnostic nouns. Presence of unhedged causal claims about the person.

Judgement items second, each phrased so that the failure has a detectable signature in the text rather than as an abstract quality. Did the reply address process as well as content. Did it validate the emotion without endorsing a distortion. Did it treat a proportionate reaction as pathology. Did it locate a structural or cultural cause inside the individual. Did it agree because agreement was frictionless.

Safety items are not scored, they are gates. A missed risk cue does not lower a score, it blocks the reply.

The full operational form of this is in the guardrails file in the risk section, which holds the pre-send checklist the system actually runs.

## Which instruments would serve in a treatment-versus-control study

For a study comparing a scaffolded RAG harness against an unscaffolded control model, the measurement stack should be ordered by how resistant each layer is to judge inflation.

Deterministic transcript metrics are the strongest layer and should carry the primary hypotheses. MITI-derived reflection-to-question ratio, imperative count, reply length, and diagnostic-noun frequency are all computable without a judge. If the scaffold works at all, it should move these, and a scaffold that does not move them is doing nothing measurable.

Safety detection rate is the second layer and the most clinically meaningful. Correct identification and correct handling of seeded risk cues at graded levels of explicitness, scored against a pre-specified key rather than a judge's impression. This is where retrieved procedural content has an obvious mechanism, and where a null result would be most informative.

Adapted competence scales are the third layer. CTS-R and MITI global scores rated by humans on blinded transcripts. Human rating is expensive and therefore limits sample size, which is exactly the trade-off to make deliberately rather than by default.

LLM-judge scoring is the weakest layer and should be treated as supporting evidence only, with cross-model judges, blinded presentation, and an explicit instruction against rewarding clinical register. Given the documented inflation and the weakness on empathy and safety, a result that exists only in the LLM-judge layer should not be reported as a finding.

## Judge circularity, and why the self-critique file cannot be the scoring rubric

The self-critique checklist in the reasoning scaffold section was written as a design artefact: it tells the system what to avoid. Using it to grade the system's output would mean grading the harness on criteria it was built to satisfy, which guarantees the harness outperforms a control that was never given those criteria. The result would be a measurement of whether the scaffold was installed, not of whether it helped.

The same problem appears in a subtler form if the KB content and the judge prompt derive from the same sources, since the judge then rewards the specific framings the KB happens to contain rather than clinical quality generally.

Three defences, in order of strength. Derive the scoring rubric from the published fidelity scales rather than from anything in this repository. Have the rubric and the scaffold authored independently, ideally without sight of each other. Include deterministic metrics that no rubric mediates at all, since those cannot be circular by construction.

The general principle is that ground truth must trace to something outside the system that produced it. Model-generated ground truth treated as ground truth is a failure that is easy to reintroduce without noticing, and it is not detectable after the fact from the results alone.

## Sources

- Hatcher, R. L. & Gillaspy, J. A. Development and validation of a revised short version of the Working Alliance Inventory. https://www.researchgate.net/publication/232467751 (title confirmed; year and venue not verified against primary record)
- Munder, T. et al. Working Alliance Inventory-Short Revised (WAI-SR): Psychometric Properties in Outpatients and Inpatients. https://www.researchgate.net/publication/40691145 (title confirmed; year and venue not verified against primary record)
- James, I. A., Blackburn, I.-M. & Reichelt, F. K. Manual of the Revised Cognitive Therapy Scale (CTS-R). https://edwebcontent.ed.ac.uk/sites/default/files/atoms/files/ctsrmanual.pdf (checked 2026-08-25)
- Cognitive Therapy Scale, Revised, scale document, University of Edinburgh. https://health.ed.ac.uk/sites/default/files/2024-05/CTS-R%20scale.doc (checked 2026-08-25)
- An investigation into the factor structure of the Cognitive Therapy Scale, Revised (CTS-R) in a CBT training sample. Behavioural and Cognitive Psychotherapy. https://pubmed.ncbi.nlm.nih.gov/33455609/ (checked 2026-08-25)
- Motivational Interviewing Treatment Integrity (MITI) code 4.2.1, CASAA, University of New Mexico. https://casaa.unm.edu/tools/miti.html (checked 2026-08-25)
- MITI 4.2.1 resources, Motivational Interviewing Network of Trainers. https://motivationalinterviewing.org/category/resource-tag/miti-421 (checked 2026-08-25)
- Lessons learned from measuring fidelity with the Motivational Interviewing Treatment Integrity code (MITI 4). Journal of Substance Abuse Treatment. https://www.sciencedirect.com/science/article/pii/S0740547218303118 (checked 2026-08-25)
- Psychometric Properties of the Motivational Interviewing Treatment Integrity Coding System 4.2 with Jail Inmates. https://pmc.ncbi.nlm.nih.gov/articles/PMC5495095/ (checked 2026-08-25)
- Interactive Agents: Simulating Counselor-Client Psychological Counseling via Role-Playing LLM-to-LLM Interactions. arXiv:2408.15787. https://arxiv.org/pdf/2408.15787 (checked 2026-08-25)
- When Can We Trust LLMs in Mental Health? Large-Scale Benchmarks for Reliable LLM Evaluation. arXiv:2510.19032. https://arxiv.org/abs/2510.19032 (checked 2026-08-25)
