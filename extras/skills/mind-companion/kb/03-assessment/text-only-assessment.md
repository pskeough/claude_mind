---
title: What Can and Cannot Be Assessed From Text Alone
section: assessment
tags: [text-only-assessment, LLM-limitations, linguistic-markers, language-and-mental-health, hypothesis-flagging, pseudo-diagnosis, collateral-history, clinical-humility]
summary: The genuine but weak signal available in language, the clinical channels that text removes entirely, and how to flag a hypothesis and ask the question instead of inferring an answer.
---

## The honest starting position

A text conversation is a narrow channel. It carries what the person chose to write, after editing, at their own pace, to an audience they are modelling. It does not carry how they look, how they sound, how they move, how they were last month, or what anyone else says about them.

Face-to-face clinical assessment draws on several parallel channels and cross-checks them. A person who says they are fine while sitting motionless, speaking in a monotone with long response latencies, and not tracking the conversation has told the clinician two different things, and the discrepancy is the finding. Text collapses those channels into one. There is nothing left to cross-check the self-report against.

This matters most precisely where clinical stakes are highest. The presentations that self-report is worst at detecting are the ones where insight is impaired: mania, psychosis, and cognitive decline. Face-to-face assessment compensates through observation and collateral history. Text-only assessment has neither compensation, so its blind spot aligns exactly with the conditions that most need detecting.

The available research supports a modest claim. Language carries real, statistically detectable signal about mental state at the group level. It carries weak signal about any individual. The gap between those two statements is where most misuse lives.

The correct posture is not refusal to engage. It is engaging with the channel that exists, which is conversation, and using it the way a clinician uses conversation: to ask. A clinician cannot see inside anyone either. What they can do is ask a good question, listen to the answer, and ask a better one. That capability transfers to text almost intact. What does not transfer is observation, and observation is what most pseudo-clinical inference from text is pretending to substitute for.

## What language genuinely carries

Several features of language have replicated associations with mental state. They are real, and they are small.

First-person singular pronoun use is the most studied. Edwards and Holtzman (2017) meta-analysed 21 studies with a combined N of 3,758 and found a correlation between depression and first-person singular pronoun use of r = 0.13, 95% CI [0.10, 0.16]. The correlation was not moderated by gender or by publication status. An r of 0.13 corresponds to roughly 1.7% of variance explained. This is the best-established linguistic marker of depression, and it is nowhere near strong enough to classify an individual.

Negative emotion words show a similar pattern: reliable group-level association, small individual-level signal. Absolutist language, meaning words like "always", "never", "completely", and "totally", has been reported as elevated in depression, anxiety, and suicidal ideation forums.

Beyond word counts, the following carry clinical information when read as conversational content rather than as automated features.

Content. What the person talks about, what they return to, and what they never mention. This is the strongest signal available in text and it is not a linguistic feature; it is ordinary listening.

Coherence and narrative structure. Whether the account hangs together, whether events are sequenced, whether causal links are made. Loss of coherence is meaningful, though writing conceals disorganisation better than speech does.

Temporal orientation. Whether the person talks about the past, present, or future, and whether the future appears at all. Absence of any future reference in someone describing distress is worth asking about directly, since hopelessness is more strongly associated with suicide than depressed mood is.

Self-referential density. How much of the account is about the self versus about others and circumstances. Related to the pronoun literature and subject to the same effect-size limit.

Avoidance patterns. What the person deflects, minimises, changes the subject away from, or answers a different question than the one asked. This is observable in text and is often the most informative thing in a transcript.

Agency and attribution. Whether the person describes themselves as acting or as being acted upon, and how they explain causes. This maps onto formulation-relevant material about control and self-blame.

The last five are not measurable features. They are clinical reading of content, and their value comes from being followed up with a question, not from being scored.

## What text removes entirely

These channels are absent, not degraded. No amount of careful reading recovers them.

Prosody and paralinguistics. Rate, volume, pitch, latency, pressure, monotony, tremor in the voice, tearfulness. These are central to detecting mania, melancholic depression, intoxication, and some neurological presentations. Pressure of speech is one of the more specific indicators of a manic state and it has no text analogue; long messages sent rapidly is not the same phenomenon and is confounded by typing habit, platform, and device.

Appearance. Grooming, weight, clothing appropriate to weather and context, physical signs of self-harm, injection sites, jaundice, tremor, pupil size, sweating. Self-neglect is often the first visible sign of deterioration and it is invisible here.

Psychomotor signs. Retardation and agitation are observed, not reported, and they carry substantial diagnostic weight. A person who is markedly slowed frequently does not experience themselves as slowed.

Behaviour in interaction. Eye contact, responsiveness, whether the person appears to be responding to internal stimuli, and the felt quality of rapport. The clinician's own emotional response to being with the person is informative and has no text equivalent.

Physical examination and investigations. Vital signs, neurological examination, thyroid function, B12, full blood count, toxicology. Several conditions that present psychiatrically are diagnosed medically, and a text conversation cannot exclude them.

Collateral history. Family, partners, friends, GP records, previous notes, and other clinicians. Collateral is the standard correction for impaired insight and for the systematic distortions of self-report. Its absence is the single largest structural limitation of text-only assessment.

Longitudinal observation. A clinician who has seen someone across a year knows their baseline and can detect change against it. A single conversation has no baseline. "Speaking more than usual" requires knowing what usual is.

Context outside the conversation. Whether the person is safe where they are, who is present, whether they have eaten, and whether anyone is coercing them.

The practical rule is that anything from this list that matters must be asked about explicitly and taken as report rather than observation, and its status as report should be preserved in whatever is written down.

## What the performance research actually shows

The empirical literature on automated mental state inference from text is worth stating in numbers, because the numbers are more sobering than the abstracts.

Rai et al. (2024) tested whether established language markers of depression generalise across race, using a matched sample of 868 US Facebook users with self-reported PHQ-9 scores. Depression severity predicted first-person singular pronoun use in White participants but not in Black participants. Five negative-emotion topics related to depression severity in White but not Black participants. A model trained on White participants' language correlated r = 0.392 with depression severity in a held-out White test set, but only r = 0.132 in a Black test set. A model trained exclusively on Black participants' language correlated r = 0.126 when tested on Black participants. The authors state that language-based depression models need to demonstrate racial invariance before integration into research or clinical practice. A model of this kind fails silently: it continues producing numbers for the population it does not work on.

Teferra et al. (2025) evaluated LLMs predicting individual PHQ-8 items from clinical interview transcripts in the DAIC-WOZ dataset using zero-shot prompting on 100 transcripts. On binary scoring of items, GPT-4o achieved mean accuracy of 75.9% (SD 6.8) and mean F1 of 0.74. On the actual four-point Likert scoring the instrument uses, GPT-4o achieved mean accuracy of 48.9% and F1 of 0.43. The authors list text-only analysis as a limitation, specifically the absence of tone of voice, speech cadence, and facial expressions. The collapse from binary to graded scoring is the finding that matters: the model can partially detect presence, and it cannot grade severity, which is what a score is for.

Xu et al. (2025) evaluated 15 current LLMs on mental health knowledge tests and on classification from social media posts. Best accuracy on depression classification was 76.98%; best on suicidal ideation was 69.53%. Failure modes were symptom overlap between conditions, ambiguous or metaphorical language, and absence of clinical context, with models defaulting to high-frequency categories under uncertainty. The authors state outputs must be reviewed by qualified professionals.

Two cautions apply to reading any of these figures. Accuracy on a roughly balanced research dataset does not transfer to a population with a low base rate; a classifier at 77% accuracy on a balanced set will generate mostly false positives where prevalence is 5%. And these systems were given a defined classification task on a curated corpus, which is a substantially easier problem than open-ended assessment of an unknown person in an unstructured conversation.

## Hypothesis-flagging without pseudo-diagnosis

There is a legitimate operation between saying nothing and delivering a diagnosis. It is naming a pattern as a question.

The structure of a properly flagged hypothesis has four parts. The observation, stated as what the person actually said. The pattern it might belong to, named without diagnostic vocabulary where possible. The explicit uncertainty. And the next step, which is almost always a question or a referral.

Worked example. "You have mentioned three times that you are waking around four and cannot get back to sleep, and that food has stopped being appealing. Those two things often travel together with the low mood you described, and they are the kind of thing worth taking to a GP because they sometimes point to something treatable. Can I ask how long the early waking has been going on?"

That does the work. It names the observation, links it to a pattern, avoids asserting a diagnosis, and ends with a question that gathers the missing duration information.

Compare the failure mode. "Based on what you've described, you're showing classic signs of major depressive disorder, probably moderate severity, and you should consider medication." This asserts a diagnosis from an unstructured conversation, imports a severity grading with no measurement behind it, and recommends a treatment class without knowing the person's medical history, medications, previous trials, bipolar history, or family history.

Rules for the flagged-hypothesis form.

Attribute the observation to the person's own words rather than to inference. "You said you have not been able to face work" is checkable. "You appear to have significant functional impairment" is not.

Use plain description over diagnostic labels when the plain description does the work. "Low mood that has lasted several months and is affecting your sleep and appetite" conveys more to the person than "depression" and makes fewer claims.

Hold the alternatives open. Fatigue, low mood, and poor concentration have a wide differential that includes anaemia, thyroid disease, sleep apnoea, medication effects, and grief. A single-hypothesis flag is worse than none because it forecloses the alternatives a clinician would consider.

Never grade severity from inference. Mild, moderate, and severe are measurement terms tied to specific bands on specific instruments, and using them without administering the instrument imports authority that does not exist.

Never assert what has not been asked. If duration, functional impact, previous episodes, substances, or medical history were not discussed, the hypothesis is missing the information that would most change it, and saying so is part of stating the hypothesis honestly.

Distinguish flagging from escalation. Risk is the exception to the "hold it loosely" posture. Where something in the conversation suggests risk of harm, the correct response is a direct question and a safety response, not a carefully hedged hypothesis.

## Asking the question rather than inferring the answer

The most consequential habit in text-based assessment is replacing inference with a question. Almost everything a model might try to infer from linguistic cues can simply be asked, and the answer will be better than the inference.

Instead of inferring low mood from negative word use, ask how their mood has been and how it compares to six months ago. Instead of inferring psychomotor change, ask whether they feel physically slowed or restless and whether anyone has commented on it. Instead of inferring sleep disturbance from the timestamp of a message, ask what time they went to bed and what time they woke. Instead of inferring hopelessness from absence of future-tense language, ask what they imagine the next few months looking like. Instead of inferring substance use from context, ask what they drank in the last week. Instead of inferring risk from tone, ask directly.

Three reasons this is better. The answer is data rather than a guess. The act of asking is itself useful, because articulating an answer often changes what the person notices. And asking preserves the person's authority over their own experience, whereas inference relocates that authority to the system doing the inferring.

Direct questions about risk are the clearest case. There is a persistent worry that asking about suicide plants the idea. Reviews of the evidence do not support this, and the professional consensus across suicide prevention guidance is that asking directly is safe and necessary. Inferring risk from linguistic cues rather than asking is worse on every axis: it is less accurate, it leaves the person unasked, and it produces no opportunity for a safety conversation.

Good questions in text share features. They are specific and anchored to a recent instance rather than asking about the usual. They ask about behaviour rather than about self-assessment. They ask one thing at a time, since compound questions get partial answers. They are open before they are closed. And they signpost before moving into a sensitive area.

Where an actual instrument is appropriate and the instrument is public domain and designed for self-completion, administering it properly is available and is a genuinely different act from inferring it. Presenting the real items, in their real wording, with their real response options and recall window, and letting the person answer, produces a score whose published properties apply. Reading a conversation and estimating what someone would have scored produces a number whose published properties do not apply, and the difference is not cosmetic.

## What to write down and what to claim

The record of a text-only assessment should make its own limitations legible. Three habits accomplish this.

Separate report from observation. Everything obtained in a text conversation is report. Writing "reports early morning waking for approximately three months" is accurate; writing "presents with early morning waking" implies observation. In a channel where nothing is observed, the distinction is load-bearing.

Name what was not covered. An assessment that did not cover substances, medical history, or risk should say so. A record that lists what was found and is silent on what was never asked reads as if the unasked domains were negative.

State the channel limit explicitly. A note that says the assessment was conducted in text, without observation of appearance, behaviour, speech, or psychomotor state, and without collateral information, is doing something useful for whoever reads it next.

On claims, the following hierarchy is worth holding.

Defensible: describing what the person said; noting patterns in what they said; naming a hypothesis as a hypothesis; identifying that a domain has not been assessed; recommending assessment; administering a self-report instrument properly and reporting its score as such; responding to risk.

Not defensible: producing a diagnosis; producing a score for an instrument that was not administered; producing a severity band; producing a probability of a disorder; ruling a condition out; concluding that a medical cause has been excluded; predicting an individual's risk from linguistic features.

The distinction between "cannot rule in" and "can rule out" deserves separate emphasis. Text-only assessment is weak at both, but it is worse at ruling out. Absence of expressed distress is not evidence of absence of distress, because concealment is common, deliberate, and relatively easy in writing. A conversation in which nothing concerning appeared has established very little.

Finally, the value of a text conversation is not diagnostic. It is that someone described their situation to something that listened and asked useful questions, and that they can be pointed toward what would actually help. That is a real contribution and it does not require pretending to a measurement that did not occur.

## Sources

- Edwards, T., & Holtzman, N. S. (2017). A meta-analysis of correlations between depression and first person singular pronoun use. *Journal of Research in Personality*, 68, 63-68. https://doi.org/10.1016/j.jrp.2017.02.005 and https://digitalcommons.georgiasouthern.edu/psych-facpubs/118/
- Rai, S., Stade, E. C., Giorgi, S., Francisco, A., Ungar, L. H., Curtis, B., & Guntuku, S. C. (2024). Key language markers of depression on social media depend on race. *PNAS*, 121(14), e2319837121. https://www.pnas.org/doi/10.1073/pnas.2319837121
- Commentary: Do "Black individuals" really display no linguistic markers of depression? *PNAS* (2024). https://www.pnas.org/doi/10.1073/pnas.2410997121
- Teferra, B. G., Perivolaris, A., Hsiang, W.-N., et al. (2025). Leveraging large language models for automated depression screening. *PLOS Digital Health*, 4(7), e0000943. https://pmc.ncbi.nlm.nih.gov/articles/PMC12303271/
- Xu, Y., et al. (2025). Evaluation of large language models on mental health: from knowledge test to illness diagnosis. *Frontiers in Psychiatry*, 16, 1646974. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12365771/
- A scoping review of large language models for generative tasks in mental health care. *npj Digital Medicine* (2025). https://www.nature.com/articles/s41746-025-01611-4
- Large language models for mental health diagnosis and treatment: a survey. *Artificial Intelligence Review* (2025). https://link.springer.com/article/10.1007/s10462-025-11418-0
- US Department of Veterans Affairs, National Center for PTSD. Assessment overview and instrument guidance. https://www.ptsd.va.gov/professional/assessment/
