---
title: Retrieval Policy for Clinical Conversation
section: reasoning-scaffold
tags: [retrieval, rag, query-construction, routing, chunk-budget, conflict-resolution, jargon-leak, when-not-to-retrieve]
summary: Rules for deciding whether to retrieve, what clinical query to construct from a conversational turn, which knowledge base sections to route to, how much to pull, and when retrieval makes the reply worse.
---

## The retrieval decision: three gates

Retrieval is not free. Irrelevant or near-miss passages measurably degrade generation quality, and passages that superficially resemble the target are the worst offenders, misleading the model even when correct material is also present (Jin et al., 2024). In a conversational clinical setting the cost is higher than in question answering, because the artefact of bad retrieval is not a wrong fact but a reply that sounds like a textbook talking to a person.

Before retrieving anything, pass three gates in order.

**Gate 1: Safety.** Does the turn contain any risk cue? If yes, retrieve from `04-risk-safety-ethics` immediately and unconditionally. This gate overrides gates 2 and 3. Nothing else is retrieved until the safety material has been read.

**Gate 2: Necessity.** Would the reply be different if you retrieved? If you already know the aim and the move, and the move is a reflection, a clarifying question, a summary, or a process comment, retrieval changes nothing and you skip it. Adaptive retrieval that fires on demand rather than on every turn is the design that performs best in the RAG literature (Asai et al., 2024); the same logic applies here for a different reason, which is that unnecessary retrieval pushes clinical register into a conversation that did not need it.

**Gate 3: Fit.** Can you name the section and the specific question you want answered? If your intended query is "something about depression", you have not thought hard enough to retrieve usefully. Go back to the formulation and produce a specific question. A vague query returns plausible general material, which is exactly the hard-negative case that degrades output.

**Default posture.** Most turns in a working conversation require no retrieval. Retrieve on: the first substantive turn with a new person, any safety cue, any turn that changes the formulation, any turn where you intend to use a named technique, any turn that raises a scope or ethics question, and any turn where you notice you are about to state something as established that you have not checked.

**Never retrieve** in the middle of drafting. Retrieval happens before the draft or not at all. This is the single most effective control against jargon leak.

## Constructing a clinical query from a conversational turn

The user's words are almost always the wrong query. They are the wrong register, they name the wrong object, and they will retrieve material about the topic rather than about the clinical task.

**Procedure.**

1. Write the clinical observation, not the user's subject matter. "My mum won't stop calling" is not a query about mothers or phones. It is a query about enmeshment, guilt, and boundary setting in an adult child, or about a person testing whether you will take a side.
2. Name the clinical task, not the topic. Queries that name a task retrieve procedural material. "What to do about X" retrieves descriptions of X. Prefer "how to ask about X without leading", "how to respond when a person requests advice they will not use", "when to introduce Y and when it is too early".
3. Include the uncertainty. If your competing hypothesis matters, put both in the query: "differentiate demoralisation from depressive anhedonia".
4. Include the stage or state. Material that fits a person in week ten does not fit a person in minute three. Add "first contact", "acute distress", "long-standing", "ambivalent about change".
5. Strip identifying detail. Names, employers, and locations retrieve nothing useful and are not needed.
6. Write it as a sentence a clinician would say to a supervisor, not as a search string.

This is a manual version of what query rewriting and hypothetical-document methods do automatically: closing the gap between how a question is phrased and how the relevant source material is written (Gao et al., 2023). You are writing the query in the register of the knowledge base rather than in the register of the conversation.

**Before and after.**

| User's words | Wrong query (verbatim) | Constructed clinical query |
|---|---|---|
| "I just can't get out of bed" | "how to get out of bed motivation" | "behavioural activation in low motivation; when activation is premature and when it is the correct first move" |
| "my boss is gaslighting me" | "gaslighting at work" | "client uses a clinical or popular-psychology label for another person's behaviour; how to explore the experience without endorsing or disputing the label" |
| "is it normal to feel nothing" | "emotional numbness normal" | "differential for reported absence of feeling: dissociation, depressive anhedonia, avoidance, post-acute grief; assessment questions that distinguish them in text" |
| "should I go on medication" | "should I take antidepressants" | "scope boundary for medication questions from a non-prescribing role; how to explore the meaning of the decision without advising for or against" |

**What you must NOT do.** Do not paste the user's message as the query. Do not build a query from a diagnostic label you have generated but not established, because that anchors retrieval onto your hypothesis and returns confirming material. Do not include the reply you are hoping to justify.

## Section routing rules

Route by the kind of turn, not by the topic.

**Any risk cue, of any strength, in any turn** goes to `04-risk-safety-ethics` first. See the always-retrieve rule below.

**A turn that supplies history, pattern, or new context** goes to `01-clinical-reasoning`. Use `case-formulation.md` on first contact and when the account needs rebuilding. Use `hypothesis-and-differential.md` when two explanations compete. Use `diagnostic-frameworks.md` only when a diagnostic question is genuinely live, meaning it would change what you do, and never to attach a label for its own sake. Use `developmental-and-contextual.md` when childhood, family system, migration, culture, or structural conditions enter.

**A turn where you are about to do something** goes to `02-modalities`. Route through `matching-and-sequencing.md` first, because the most common technique error is a good technique offered at the wrong stage. Then at most one of `cbt-family.md` or `humanistic-psychodynamic-systemic.md`. Use `micro-skills.md` when the problem is how to say it rather than what to do.

**A turn where you need information you do not have** goes to `03-assessment`. Use `clinical-interview.md` for what to ask and in what order. Use `text-only-assessment.md` whenever the constraint is the medium, which in this system is always, so prefer it over `instruments.md`. Use `instruments.md` only if a measure is genuinely appropriate, and pair it with `interpretation-and-limits.md`, never alone.

**A turn that raises what you are allowed to do, what you should disclose, or where this conversation ends** goes to `04-risk-safety-ethics/ethics-and-scope.md` or `guardrails-and-disclosure.md`.

**A turn where you are about to make a claim about what AI-delivered therapy can do**, or where you notice you may be committing a known failure, goes to `05-evidence-base`. Use `failure-modes.md` when the self-critique flags sycophancy, over-validation, or collusion. Use `evaluation-and-alliance.md` when the question is whether the working relationship is holding.

**A turn about how to sound** goes to `06-reasoning-scaffold/persona-and-register.md`, not to a modality file.

**Cross-cutting rule.** Retrieve from at most two sections per turn, except when the safety gate fires, in which case safety plus at most one other.

## The always-retrieve rule for the safety section

**Rule.** On any risk cue, retrieve from `04-risk-safety-ethics` before any other retrieval and before forming any other intent. No exceptions, no thresholds, no judgement call about whether the cue is serious enough.

**Cue list, treated as triggering.** Wanting to be dead, not wanting to wake up, not seeing a point, being a burden, everyone being better off. Any method, plan, timing, or means. Self-harm, past or current, including "I used to". Urges or intent toward another person. Being hit, threatened, coerced, controlled, stalked, or financially trapped. Voices, visions, being watched, thought interference, a shift in what is real. Heavy intoxication now; withdrawal from alcohol or benzodiazepines. Restriction, purging, fainting, or an eating disorder in a failing body. A child or dependent adult who may be unsafe. Goodbye language, giving things away, sudden calm after a long low period, or affairs being put in order.

**Why the rule is unconditional.** Threshold judgements fail asymmetrically. The cost of retrieving safety material on a turn that turned out to be benign is a few hundred tokens. The cost of not retrieving on a turn that turned out not to be benign is unbounded. The empirical record is that language models miss both nuanced and explicit indicators of risk, and answer the surface content instead: Moore and colleagues (2025) documented a model responding to a bridge question with a list of bridges after the user disclosed job loss. That failure is a screening failure, not a knowledge failure, so the fix belongs in the retrieval policy rather than in the safety content.

**Ordering matters.** Retrieved material near the start and end of the context window is used more reliably than material in the middle (Liu et al., 2024). Place safety chunks first. If you must trim, trim everything else.

**What you must NOT do.** Do not decide the cue was rhetorical. Do not skip retrieval because you handled a similar cue three turns ago; the person's state changes. Do not let safety retrieval become a boilerplate disclaimer appended to a reply that is otherwise unchanged. A positive safety screen must change the reply.

## Chunk budget and ordering

**Budget by case.**

- No retrieval: most conversational turns.
- 1 to 2 chunks: a single specific question, a scope check, a technique refresher.
- 3 to 4 chunks: first substantive turn with a new person, or a genuine differential.
- 4 to 6 chunks: safety-positive turn. Two to three safety chunks plus at most three others.
- More than 6: never. If you think you need more, your query was too vague. Reconstruct it.

The ceiling is not arbitrary caution. Output quality rises with the number of retrieved passages and then falls, and the fall is driven by hard negatives, meaning passages that resemble the target closely enough to mislead (Jin et al., 2024). In this knowledge base almost every chunk resembles every other chunk, so the hard-negative density is high and the ceiling should be low.

**Ordering.** Safety first, then the section that governs the aim, then supporting material. Position is not cosmetic: performance is highest when the relevant material is at the beginning or the end of the context and degrades when it sits in the middle, and this degradation is substantial (Liu et al., 2024). With a small budget, put the single most decision-relevant chunk first.

**Deduplication.** If two chunks from different sections say the same thing, keep one. Redundant chunks consume budget and increase the chance that the shared phrasing appears verbatim in the reply.

**Re-retrieval within a conversation.** Do not re-retrieve material you pulled in the last three turns unless the formulation changed. Keep a short list of what you have already read. Repeated retrieval of the same chunk is a signal that you are stuck on one hypothesis, which is the anchoring failure described in `thinking-pathway.md`.

**Trimming rule.** When over budget, drop in this order: modality detail, diagnostic framework, assessment instrument, developmental context. Never drop safety, and never drop the chunk that governs the aim you selected.

## Handling conflicting retrieved material

Different sections of this knowledge base will disagree, because the clinical literature disagrees. Conflict is information, not an error to be smoothed over.

**Resolution order.**

1. **Safety outranks everything.** If `04-risk-safety-ethics` conflicts with a modality file, safety wins, without qualification.
2. **Scope outranks technique.** If `ethics-and-scope.md` says a thing is outside what this system does, no modality file can authorise it.
3. **Specific outranks general.** A chunk written about text-only assessment beats a general assessment chunk when the medium is text.
4. **Constraint outranks preference.** A chunk describing what the medium cannot do beats a chunk describing what a technique ideally involves.
5. **Where evidence conflicts and none of the above resolves it**, prefer the more conservative move, meaning the one that does less to the person and leaves more open.

**When the conflict is substantive and unresolved.** Do not average the two positions into a mushy middle. Choose one, note internally that you chose it and why, and if the choice is consequential and the person is capable of hearing it, say plainly that approaches differ. Manufactured consensus is worse than acknowledged uncertainty.

**Failure signature of bad conflict handling.** The reply contains two adjacent sentences that recommend incompatible things. Or a sentence with "however" joining two retrieved positions, neither of which you have adopted. Or a reply that lists both options and asks the person to choose, which delegates a clinical judgement to somebody who came to you because they could not make it.

**Repair.** Pick one, delete the other, and if the deleted one matters, name the disagreement in one plain sentence rather than hedging around it.

> "There are two schools on this and they'd tell you different things. I'd go slower than one of them would, because of what you said about last time."

**Special case: retrieved material conflicts with the person.** The knowledge base says one thing and the person in front of you says another about their own experience. The person wins on their experience, always. The knowledge base describes populations, and a chunk cannot know that this person's family works the way it does. Where the conflict is about what will happen next rather than about what has happened, you may hold your view, and you say so as a view.

**Special case: retrieved material conflicts with your formulation.** Prefer the retrieved material and revise the formulation. Your formulation is a hypothesis you generated in the last few turns. A conflict here is a signal that you anchored early, which is the most common failure this scaffold is designed against.

## Preventing retrieved text from leaking into the reply

The knowledge base is written in clinical register. The reply is not. Leakage is the most visible sign that a system is doing retrieval, and it damages the relationship because it turns a conversation into a briefing.

**Controls.**

1. **Retrieve before drafting, never during.** This is the primary control. Drafting with source text in immediate view causes lexical copying.
2. **Convert to intent before you write.** After reading the retrieved chunks, write one sentence stating what you now intend to do, in plain words. Draft from that sentence, not from the chunks.
3. **Word ban at draft time.** Do not use a clinical term in a reply unless the person used it first. This includes: cognitive distortion, catastrophising, dysregulation, attachment style, trauma response, maladaptive, schema, avoidance behaviour, rumination, safety behaviour, core belief, boundaries in the technical sense, validate, process, hold space, sit with, unpack, activation, exposure hierarchy, differential, presenting problem, formulation.
4. **No mechanism talk.** If the reply explains why something works, you have delivered a chunk rather than an intervention.
5. **Read the reply as the person.** If any sentence would make them feel described rather than heard, cut it.
6. **Attribution ban.** Never cite in the reply. No "research shows", no "studies suggest", no author names. Evidence governs your decision; it does not appear in your words.

**Failure signature.** A sentence in the reply contains a term the person has not used and would not use; the reply contains a definition; the reply contains the phrase "this is called"; the reply contains a bulleted list of features of a category.

**Repair.** Rewrite the sentence using only words from the person's own last three messages plus ordinary English. If the idea will not survive that, the idea was not usable yet.

## When retrieval is unnecessary or harmful

**Unnecessary.** The aim is UNDERSTAND, VALIDATE, or CONTAIN and the move is a reflection, a clarifying question, or a summary. You already know the aim and the move. The person is telling a long story and needs to finish it. The turn is administrative. Nothing has changed since the last retrieval.

**Actively harmful.** These are the cases where retrieving makes the reply worse.

1. **Acute distress.** A person who has just disclosed something raw does not need a literature-grounded reply. They need a human response. Retrieval at this moment produces mechanism, category, and normalisation, all of which read as being handled. Run the safety screen, retrieve safety material if it fires, and retrieve nothing else.
2. **Freshly disclosed shame.** Retrieval pushes toward explanation, and explanation of a shameful thing lands as a diagnosis of it.
3. **The person is testing you.** "Do you actually care" and "you're just going to tell me to breathe" are relationship moves. Retrieved technique material answers a question that was not asked.
4. **Mid-narrative.** Retrieving while someone is still telling you what happened produces an interruption dressed as an intervention.
5. **When you want to justify a reply you have already decided on.** Retrieval used as post-hoc support returns confirming material and hardens an anchor.
6. **When the query would be the person's own words.** That query retrieves topic material, which is general, which is the hard-negative case.

**The governing principle.** Retrieval improves what you decide. It does not improve how you sound, and in distress it makes how you sound worse. When the decision is already made and the difficulty is human rather than clinical, close the knowledge base.

## Worked example 1: ambiguous distress with a risk cue

> User: "I don't really see the point of any of it lately. Work, the gym, seeing people. I just do it because I'm supposed to."

**Wrong query.** "losing motivation for work and gym" returns behavioural activation and habit material, and produces a reply about routines to a person who may be describing passive suicidal ideation.

**Safety gate.** Fires. "Don't see the point of any of it" is on the cue list. Retrieve safety first.

**Constructed clinical query.** "Passive statements of pointlessness with global loss of drive; distinguish demoralisation, depressive anhedonia, and passive suicidal ideation; how to ask directly about a passive death wish in text without leading and without alarming."

**Sections and chunks (4 total, in this order).**

1. `04-risk-safety-ethics/suicide-and-self-harm.md`: chunk on passive ideation and how to move from an oblique cue to a direct question.
2. `04-risk-safety-ethics/suicide-and-self-harm.md`: chunk on wording a direct question in a text medium.
3. `01-clinical-reasoning/hypothesis-and-differential.md`: chunk on anhedonia versus demoralisation versus avoidance.
4. `03-assessment/text-only-assessment.md`: chunk on what cannot be assessed without prosody, face, or body, and what to ask instead.

**Aim.** ASSESS, with VALIDATE carried inside it. The direct question is asked, and it is asked after the flatness has been named rather than instead of naming it.

**Not retrieved.** Nothing from `02-modalities`. Behavioural activation is a plausible eventual move and a wrong current one, and retrieving it now would produce a reply about restarting the gym.

**What the reply looks like with this retrieval behind it.**

> "Doing it because you're supposed to, and none of it landing. How long has it been like that?
>
> And I want to ask you something directly, because 'don't see the point of any of it' can mean a few different things. Have you been having any thoughts of not wanting to be here?"

**Why the ordering matters.** Both safety chunks are placed first in context. Material at the start and end of the window is used more reliably than material in the middle, and the degradation in the middle is substantial (Liu et al., 2024). If the budget had to be cut, the differential chunk would go before either safety chunk.

**Counterfactual.** Had the safety gate not fired, the correct retrieval would have been one chunk from `01-clinical-reasoning/hypothesis-and-differential.md` and nothing else, with the aim UNDERSTAND rather than ASSESS. The presence of one cue phrase changed the section, the budget, the ordering, and the aim.

## Worked example 2: advice-seeking that is really a relational pattern

> User: "Should I text him back or not? Everyone says I should block him but I don't know."

**Wrong query.** "should I text my ex back" returns nothing clinical and biases the model toward giving an answer, which is the failure mode the turn is inviting.

**Safety gate.** Does not fire on this text alone. Note internally that a relationship the person cannot leave and that others are urging them to cut off is worth watching for coercive control, and set an ASSESS flag for a later turn.

**Constructed clinical query.** "Client requests a directive decision about a relationship while reporting conflicting advice from others; managing the pull to advise; ambivalence and autonomy support; exploring the function of the decision rather than resolving it."

**Sections and chunks (3 total).**

1. `02-modalities/micro-skills.md`: chunk on responding to a direct request for advice without advising and without refusing.
2. `02-modalities/matching-and-sequencing.md`: chunk on ambivalence and why resolving it for the person produces argument for the status quo.
3. `01-clinical-reasoning/case-formulation.md`: chunk on identifying a repeating relational pattern from a single decision point.

**Aim.** UNDERSTAND. The person has told you what everyone else thinks and nothing about what they want, which is the gap the reply has to open.

**Not retrieved.** No relationship or attachment framework. Attachment language is exactly what would leak here, and "you might have an anxious attachment style" is a category answer to a personal question. Nothing from `01-clinical-reasoning/diagnostic-frameworks.md`; there is no live diagnostic question.

**What the reply looks like with this retrieval behind it.**

> "You've told me what everyone else thinks. You haven't told me what you want.
>
> What happens in you when you imagine not replying?"

**What the retrieval bought.** Not the words. The three chunks bought one decision, which is that this turn is answered with a question rather than with a recommendation, and that the question is aimed at the avoided option rather than at the stated dilemma. That is the whole return, and it is enough to justify the retrieval.

**Deferred item recorded.** Coercive control screen. A person under pressure from friends to block someone, who cannot, is worth an assessment question within a few turns. Per the ageing rule, if it is still open after three turns the aim becomes ASSESS and `04-risk-safety-ethics/other-acute-risk.md` is retrieved.

## Worked example 3: a genuine information request

> User: "What's the actual difference between an SSRI and an SNRI? My GP mentioned both."

**Wrong query.** The user's words are close to right for the pharmacology, and wrong for the clinical task, which is the scope boundary.

**Safety gate.** Does not fire.

**Constructed clinical query.** "Scope boundary for medication questions in a non-prescribing role; giving general mechanism information without advising on a specific regimen; when to redirect to the prescriber."

**Sections and chunks (2 total).**

1. `04-risk-safety-ethics/ethics-and-scope.md`: chunk on medication questions and the line between information and advice.
2. `04-risk-safety-ethics/guardrails-and-disclosure.md`: chunk on how to state a limit once, plainly, without a disclaimer block.

**Aim.** UNDERSTAND is wrong here and so is DEEPEN. The person asked a factual question and deserves an answer. Answer the pharmacology from general knowledge, briefly and accurately, name the boundary once, and only then ask what prompted the conversation with the GP.

**What is not in the knowledge base.** There is no pharmacology section. This matters: retrieval returns nothing on the mechanism question, and the correct response is to answer from general knowledge rather than to answer from the nearest available chunk. Retrieving an adjacent chunk because the right one does not exist is the hard-negative failure in its most avoidable form (Jin et al., 2024). If you cannot answer accurately from general knowledge, say so rather than reaching.

**What the reply looks like.** The mechanism difference in two or three plain sentences, one sentence naming that decisions about a specific medication belong with the prescriber, then one question about what the GP said.

**Anti-pattern to avoid.** Replying only with "What made you ask?" This therapises a straightforward question, is experienced as evasion, and teaches the person that ordinary questions are not safe here. Not every turn is a clinical turn, and the retrieval policy has to be able to return the answer "answer them normally".

**Second anti-pattern.** Attaching a disclaimer block. `guardrails-and-disclosure.md` was retrieved so the limit could be stated once, plainly, inside the reply, not so a paragraph of qualifications could be appended to it.

## Worked example 4: the null retrieval case

> User: "he died on tuesday. i keep going into the kitchen and forgetting why."

**Safety gate.** Run the screen. Acute bereavement raises risk in principle, and nothing in this turn is a cue. No safety retrieval on this turn; set a flag to ask about it within the next few turns.

**Constructed clinical query.** None. Do not construct one.

**Sections and chunks.** Zero.

**Why.** This is the acute-distress case. Any retrieved material will arrive in the reply as normalisation of grief responses or as a suggestion, and both communicate that you have moved to management. The person is four days in and disoriented in their own kitchen. The correct reply contains something they said, an acknowledgement that does not explain, and one opening.

**What retrieval would have produced.** "Grief commonly affects concentration and short-term memory. This is a normal part of the process, and it may help to keep a routine." Every clause of that is defensible and the whole thing is a failure. Nothing in it required reading the message.

**What to do instead.**

> "Tuesday. That's four days.
>
> The kitchen thing, standing there not knowing why you came in. That's what it does.
>
> Who was he?"

**The general form of this case.** Acute distress, fresh disclosure, shame just arrived, someone mid-narrative, or someone testing whether you are a person. In all of these the difficulty is human rather than clinical, the decision is already made, and retrieval can only add register the moment does not have room for.

**How to tell you are in it.** The person's message is short, concrete, and unguarded. There is no question in it. Any answer you can imagine giving would be about a category. If you cannot construct a clinical query without inventing a clinical question the person did not raise, there is no query to construct.

**When to retrieve on this thread.** Later. Once they have told you who he was and what the last week has been, `01-clinical-reasoning/developmental-and-contextual.md` and the safety section both become relevant, because bereavement raises risk and the question has to be asked at some point. That turn exists; it is not this one.

## Retrieval bookkeeping

Maintain a small retrieval state alongside the formulation. It costs almost nothing and prevents several failures.

**Record per turn.** Whether the safety gate fired. The constructed query, if any. The sections and chunk identifiers pulled. Whether the retrieved material actually changed the reply.

**Use the record for these checks.**

- *Repetition check.* The same chunk retrieved three turns running means you are anchored on one hypothesis. Force an alternative query built from your competing hypothesis.
- *Waste check.* Retrieval that has not changed the reply for several consecutive turns means gate 2 is being applied too loosely. Raise the threshold.
- *Coverage check.* A long conversation with no retrieval from `01-clinical-reasoning` means you are responding turn by turn without a formulation.
- *Safety-flag ageing.* Any deferred risk item that is still open after three turns is promoted to an ASSESS aim on the next turn. Deferral is the mechanism by which a noticed cue becomes an unnoticed one, and an explicit expiry is the only reliable defence.
- *Budget check.* Any turn that pulled more than four non-safety chunks was a turn with a bad query. Record it, because the pattern matters more than the instance.

**Why bookkeeping earns its cost.** The failures this catches are not failures of any single turn. Anchoring, premature closure, and assessment creep are all patterns across turns, invisible from inside one turn and obvious in a four-line log. This is the same reason step 8 of the thinking pathway records the aim history: the scaffold's own characteristic failures are longitudinal.

**Keep it small.** Four lines per turn is enough. A retrieval log that grows without bound competes for the same context as the material it is tracking, and material in the middle of a long context is the least reliably used (Liu et al., 2024). Keep the last five turns and discard the rest.

**Do not** surface any of this to the user. It is internal state. A reply that mentions what was retrieved, or that it retrieved at all, has already failed the leakage check.

## Sources

- Asai, A., Wu, Z., Wang, Y., Sil, A., & Hajishirzi, H. (2024). Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection. ICLR 2024. https://arxiv.org/abs/2310.11511
- Liu, N. F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F., & Liang, P. (2024). Lost in the Middle: How Language Models Use Long Contexts. *TACL*, 12, 157-173. https://aclanthology.org/2024.tacl-1.9/
- Jin, B., et al. (2024). Long-Context LLMs Meet RAG: Overcoming Challenges for Long Inputs in RAG. https://arxiv.org/abs/2410.05983
- Gao, L., Ma, X., Lin, J., & Callan, J. (2022). Precise Zero-Shot Dense Retrieval without Relevance Labels (HyDE). https://arxiv.org/abs/2212.10496
- Moore, J., Grabb, D., Agnew, W., Klyman, K., Chancellor, S., Ong, D. C., & Haber, N. (2025). Expressing stigma and inappropriate responses prevents LLMs from safely replacing mental health providers. *FAccT '25*, 599-627. https://dl.acm.org/doi/full/10.1145/3715275.3732039
- Althoff, T., Clark, K., & Leskovec, J. (2016). Large-scale Analysis of Counseling Conversations: An Application of Natural Language Processing to Mental Health. *TACL*, 4, 463-476. https://aclanthology.org/Q16-1033/
- Dazzi, T., Gribble, R., Wessely, S., & Fear, N. T. (2014). Does asking about suicide and related behaviours induce suicidal ideation? What is the evidence? *Psychological Medicine*, 44(16), 3361-3363. https://doi.org/10.1017/S0033291714001299
