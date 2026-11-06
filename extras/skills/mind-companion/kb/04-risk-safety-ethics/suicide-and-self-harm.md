---
title: Suicide and Self-Harm: Assessment, Response, and System Decision Rules
section: risk-safety-ethics
tags: [suicide, self-harm, risk-assessment, C-SSRS, safety-planning, means-restriction, NSSI, safe-messaging, crisis-response, escalation]
summary: How suicide risk is actually assessed and responded to in clinical practice, why prediction and risk stratification fail, what the evidence supports instead, and an explicit decision procedure for a language model that encounters suicidal content.
---

## The core reframe: risk assessment is not risk prediction

Clinical practice used to treat suicide risk assessment as a prediction problem. Gather risk factors, weight them, assign the person to a risk tier, and allocate care by tier. The evidence does not support this model, and the largest syntheses in the field say so directly.

Franklin et al. (2017) meta-analysed 365 longitudinal studies covering 3,428 risk factor effect sizes over 50 years of research. Across odds ratio, hazard ratio, and diagnostic accuracy analyses, prediction of suicidal thoughts and behaviours was only slightly better than chance for every outcome examined. No broad category or subcategory of risk factor predicted far above chance. Predictive accuracy had not improved across five decades.

Ribeiro et al. (2015) examined the strongest single class of predictor, prior self-injurious thoughts and behaviours, and found that even this produced weak absolute prediction of future attempts and death. Belsher et al. (2019) reviewed statistical prediction models and found that although discrimination metrics looked acceptable, the positive predictive values were near zero in realistic populations because suicide is a low base rate event.

The practical consequence is that a system encountering a person in distress cannot know whether that person will die. What it can do is respond to the distress that is present, reduce the person's access to lethal means, connect them to a human, and stay with them while it does. Hawton et al. (2022) describe this as a shift from prediction to therapeutic assessment, formulation, and risk management. The assessment itself is the intervention: the conversation is where engagement, understanding, and a plan get built.

Two further implications follow. First, a low apparent risk score is not a reason to disengage. Roughly half of all suicides occur in people categorised as lower risk (Large et al., 2016). Second, a high apparent risk score is not a reason to override the person. Roughly 95 percent of people categorised as high risk do not die by suicide (Large et al., 2016), so treating the category as a verdict produces enormous over-restriction with no proven benefit.

This section is written so that each part stands alone. If a retrieval system surfaces only one chunk, that chunk should still lead to a safe response. The single most important thing to carry across all of them: ask directly, respond to what the person says rather than to a score, help reduce access to means, and connect the person to a human who can act.

## The Columbia Suicide Severity Rating Scale: structure and sequence

The Columbia Suicide Severity Rating Scale (C-SSRS) is the most widely used structured measure of suicidal ideation and behaviour. It was developed by Posner and colleagues at Columbia University out of an NIMH treatment study of adolescent suicide attempters, and its initial validity and internal consistency were reported across three multisite studies with adolescents and adults (Posner et al., 2011).

The full scale has four constructs:

1. **Severity of ideation.** A five-point ordinal scale, where each point is a separate yes or no question, ordered by increasing severity.
2. **Intensity of ideation.** Frequency, duration, controllability, deterrents, and reasons for ideation, rated against the most severe ideation endorsed.
3. **Suicidal behaviour.** Actual attempt, interrupted attempt, aborted or self-interrupted attempt, preparatory acts, and non-suicidal self-injurious behaviour, recorded as separate categories.
4. **Lethality of behaviour.** Actual medical damage for any attempt, plus potential lethality where actual damage was zero.

The five severity of ideation levels, in order, are (Posner et al., 2011):

1. Wish to be dead.
2. Non-specific active suicidal thoughts.
3. Active suicidal ideation with any methods, not plan, without intent to act.
4. Active suicidal ideation with some intent to act, without specific plan.
5. Active suicidal ideation with specific plan and intent.

The screener version is a short branching interview. Columbia describes it as condensing to a minimum of two and a maximum of six questions depending on the answers. If the person answers no to the second ideation question, the interview skips to the behaviour question. If they answer yes, the remaining ideation questions are asked. Verified examples of the plain-language wording published by Columbia include:

> "Have you wished you were dead or wished you could go to sleep and not wake up?"

> "Have you been thinking about how you might kill yourself?"

> "Have you taken any steps toward making a suicide attempt or preparing to kill yourself (such as collecting pills, getting a gun, giving valuables away, or writing a suicide note)?"

The exact licensed wording of every item, and the current triage-point versions, are published by the Columbia Lighthouse Project. A system reproducing the instrument should use the official text rather than paraphrase, because the graded wording is what makes the ordinal structure work.

The scale has no total score. Columbia's own guidance is to look at which items were endorsed rather than to sum them. That design choice matters: the instrument is a structured way of finding out what is true, not a scoring machine that outputs a risk number.

What the C-SSRS is genuinely good for is making sure nothing is skipped, and giving a shared vocabulary. What it is not good for is predicting who will die. Carter et al. (2017) meta-analysed positive predictive values for suicide risk scales and found a pooled PPV of 5.5 percent for suicide, 26.3 percent for self-harm, and 35.9 percent for the two combined, concluding that no high-risk classification was clinically useful.

## Ideation, intent, plan, means, and preparatory behaviour

These five terms are frequently collapsed in ordinary conversation. Keeping them separate is what allows a useful response, because they call for different actions.

**Ideation** is thinking about suicide. It ranges from a passive wish not to exist ("I wish I could go to sleep and not wake up") to specific active thoughts about killing oneself. Passive ideation is common and is not by itself an emergency. It is also not nothing: it warrants asking further questions rather than reassurance.

**Intent** is the degree to which the person wants to act and expects to act. It is a separate axis from ideation content. A person can hold detailed thoughts with no intent, and a person can hold vague thoughts with strong intent. Intent is what a clinician asks about directly: whether the person thinks they might act on the thoughts, and what is stopping them.

**Plan** is a specific formulated method, and often a time and place. A plan raises concern because it converts a diffuse state into an executable sequence. The relevant clinical question is whether a plan exists and how specific it is, not what the plan is. Asking a person to narrate method detail serves no assessment purpose and rehearses the act.

**Means** is access. This is the single most actionable variable in the entire assessment, because access is modifiable and lethality of method is the strongest determinant of whether an attempt becomes a death. Restricting access to highly lethal means is one of the few suicide prevention strategies with consistent population-level evidence (Zalsman et al., 2016; Mann et al., 2021).

**Preparatory behaviour** is action taken toward an attempt without the attempt beginning: acquiring or assembling means, writing a note, giving away possessions, researching methods, arranging affairs, saying goodbyes. The C-SSRS records preparatory acts as a form of suicidal behaviour, not as ideation, and this is the right categorisation. Preparatory behaviour indicates that the person has moved from thinking to doing, and it is one of the clearest signals that same-day human contact is needed.

A sixth item belongs alongside these five in practice: **rehearsal or aborted attempt**, meaning the person began or came close to beginning an act and stopped, or was interrupted. Aborted and interrupted attempts carry similar significance to actual attempts and are recorded separately on the C-SSRS for that reason.

The pattern that most warrants immediate human involvement is the combination of active ideation with intent, a formulated plan, available means, and preparatory behaviour, especially with a recent attempt or a recent discharge from psychiatric care. That combination is not a prediction. It is a description of a person who is close to acting, and closeness to acting is what response is calibrated to.

## Why low, medium, high stratification is not defensible

Risk stratification remains embedded in many forms and protocols. The evidence against using it to allocate care is now strong enough that national guidance prohibits it.

Large et al. (2016) meta-analysed 37 studies reporting 53 samples of risk-assessed psychiatric patients. Pooled sensitivity of a high-risk categorisation was 56 percent, specificity 79 percent, and positive predictive value 5.5 percent. Over a mean follow-up of 63 months, 5.5 percent of high-risk patients died by suicide compared with 0.9 percent of lower-risk patients. That is a real statistical association and a useless clinical instrument at the same time. Around 44 percent of suicides occurred in the lower-risk group, and about 95 percent of the high-risk group did not die.

Carter and Spittal (2018) stated the conclusion directly in *Crisis*: risk stratification is not accurate enough to be clinically useful and alternative approaches are needed. Carter et al. (2017) reached the same conclusion from pooled positive predictive values across scales.

NICE guideline NG225 on self-harm (NICE, 2022, updated 2025) turned this into recommendations that are unusually blunt for a clinical guideline:

> 1.6.1 Do not use risk assessment tools and scales to predict future suicide or repetition of self-harm.

> 1.6.2 Do not use risk assessment tools and scales to determine who should and should not be offered treatment or who should be discharged.

> 1.6.3 Do not use global risk stratification into low, medium or high risk to predict future suicide or repetition of self-harm.

> 1.6.4 Do not use global risk stratification into low, medium or high risk to determine who should be offered treatment or who should be discharged.

NG225 replaces stratification with two things. Recommendation 1.6.5 directs the assessment toward "the person's needs and how to support their immediate and long-term psychological and physical safety." Recommendation 1.6.6 requires a risk formulation as part of every psychosocial assessment. A formulation is a narrative account of what is driving this person's distress, what makes it worse, what makes it better, and what would need to change, rather than a tier.

For an AI system, three operational rules follow.

First, never output a risk tier as a verdict. Do not tell a user they are "low risk" or "high risk." A low label is falsely reassuring and can end a conversation that should have continued. A high label is frightening, is usually wrong in the sense that most so-labelled people do not die, and invites coercive responses.

Second, do not gate the depth of response on an internal score. The response to a person disclosing passive ideation and the response to a person disclosing a plan differ in content and urgency, not in whether the person is taken seriously.

Third, treat the absence of endorsed risk factors as uninformative. A person who denies a plan, denies intent, and reports good social support can still be in danger. What licenses a lower-intensity response is the person's own account of their safety plus a concrete next step, not the arithmetic of a checklist.

## Asking about suicide does not increase risk

The belief that asking about suicide plants the idea or increases risk is widespread among non-specialists, and it is the single belief most likely to cause an AI system to fail a user by changing the subject. The evidence contradicts it.

Dazzi et al. (2014) reviewed studies of suicide enquiry in adults and adolescents, in general and at-risk populations, in research and clinical settings. None found a statistically significant increase in suicidal ideation among participants who were asked about suicidal thoughts. The authors concluded that acknowledging and talking about suicide may reduce rather than increase ideation, and may improve mental health outcomes in treatment-seeking populations.

DeCou and Schumann (2018) meta-analysed the iatrogenic risk of assessing suicidality and found no evidence of increased ideation following assessment. Blades et al. (2018) meta-analysed the effects of exposure to suicide-related content in research participation and reached a consistent conclusion: the feared iatrogenic effect did not appear, and there were measurable benefits to participants from being asked.

The clinical corollary is that direct, plain questions are better than indirect ones. Euphemism creates ambiguity in both directions. "Are you thinking of hurting yourself" conflates self-harm with suicide and lets a suicidal person truthfully answer no. "Are you having thoughts of suicide" or "are you thinking about killing yourself" are unambiguous, and their directness signals that the topic is speakable.

Two things that do carry risk should not be confused with asking. Detailed discussion of method, and provision of method information, are genuinely harmful and are addressed under safe messaging below. Asking whether a person has a plan is safe. Asking them to describe the plan in detail is not necessary and should be avoided.

The other real risk is asking and then not responding. A question about suicide creates an obligation. A system that asks, receives a yes, and then produces a boilerplate deflection has done something worse than not asking, because it has invited a disclosure and then withdrawn.

> "I want to ask you something directly, because it matters and because I would rather ask than assume. Are you having thoughts of suicide?"

That formulation does three things: it flags the question in advance so it does not ambush, it explains why it is being asked, and it uses the actual word.

## Safety Planning Intervention: the evidence-supported response

The Safety Planning Intervention (SPI) was developed by Stanley and Brown (2012) as a brief, standalone intervention deliverable in an emergency department or crisis contact. It is the closest thing the field has to a default response to acute suicidal crisis, and it is on the SPRC/AFSP Best Practices Registry.

Its six components, in the authors' own ordering (Stanley & Brown, 2012):

1. Recognising warning signs of an impending suicidal crisis.
2. Employing internal coping strategies.
3. Utilising social contacts and social settings as a means of distraction from suicidal thoughts.
4. Utilising family members or friends to help resolve the crisis.
5. Contacting mental health professionals or agencies.
6. Restricting access to lethal means.

The ordering is deliberate and is part of the intervention. It begins with what the person can do alone and escalates to help from others, so that the plan is usable at the point where reaching out feels impossible. Steps 3 and 4 are distinct: step 3 is social contact used purely as distraction, without disclosing suicidal feelings, and step 4 is contacting someone explicitly for help with the crisis. Many implementations add an optional step on reasons for living.

Evidence. Stanley et al. (2018) compared SPI plus structured follow-up contact against usual care for suicidal patients presenting to Veterans Health Administration emergency departments. The intervention group had roughly half the suicidal behaviour over six months and more than double the odds of attending outpatient mental health treatment. Nuij et al. (2021) meta-analysed safety planning-type interventions and found reductions in suicidal behaviour and, in some analyses, improved treatment engagement. NICE NG225 recommends considering developing a safety plan in partnership with people who have self-harmed, listing establishing the means of self-harm, recognising triggers and warning signs, identifying individualised coping strategies, and identifying social contacts as distraction.

Three properties make safety planning appropriate for an AI context in a way that risk scoring is not.

It is collaborative. NICE specifies that safety plans should be "written with and agreed by the person who self-harms." A plan the system writes at the person is not a safety plan.

It is concrete. Generic advice ("practise self-care") does not function in crisis. A safety plan names this person's specific warning signs, this person's specific coping actions, and this person's named contacts with actual numbers.

It is portable. The person keeps it. The classic implementation gives the person a physical copy for a wallet and a bedside table. An AI system can produce text the person can save, screenshot, or send to themselves.

Safety planning is not a no-suicide contract. No-suicide or no-harm contracts, in which a person promises not to act, have no evidence of effectiveness and function mainly to protect the institution. They should not be used and should not be simulated by asking a user to promise anything.

## Means restriction counselling

Reducing access to lethal means is one of the few interventions with consistent evidence of population-level effect on suicide deaths. Zalsman et al. (2016), in a ten-year systematic review of suicide prevention strategies, identified restricting access to lethal means as one of the strategies with the strongest supporting evidence. Mann et al. (2021) reached the same conclusion.

The mechanism is method substitution failure plus the time-limited nature of acute suicidal states. Many suicidal crises are short. Highly lethal methods convert a short crisis into an irreversible outcome, and people who survive an attempt because a method was unavailable or low-lethality mostly do not go on to die by suicide.

Counseling on Access to Lethal Means (CALM) is the standard training model for this conversation, promoted through Zero Suicide (EDC). Its structure is: establish whether the person has access to any highly lethal method, then work collaboratively with the person and the people around them to put distance between the person and that method for the duration of the risk period.

The conversational shape that works:

> "Can I ask about something practical? Is there anything at home that you have thought about using, or that you think you should not have easy access to right now?"

> "Would you be willing to have someone hold onto that for a while? It does not have to be permanent. It is about putting time between the thought and the action."

Key features of the technique:

**Ask about access, not method preference.** The purpose is to identify what needs to be moved, not to catalogue options. If the person volunteers a method, that is information about their access, not an invitation to discuss it.

**Propose time and distance, not confiscation.** "Until things settle" is acceptable where "give it up" is not. Temporary, reversible, delegated storage has a much higher acceptance rate than surrender.

**Involve a third party where possible.** Handing means to a trusted person is more robust than self-storage. NICE NG225 recommendation 1.7.1 directs professionals to establish the means of self-harm and, if accessible, discuss removing it "with therapeutic collaboration or negotiation, to keep the person safe."

**Include medication.** Stockpiled medication is a common means and is often overlooked because it is not perceived as a weapon. Reducing quantities held, and having someone else dispense, are standard measures. NG225 has an entire section on safer prescribing and dispensing.

**Accept a partial yes.** A person who agrees to move one item and not another has reduced their risk. Treat that as a success rather than pressing for total compliance, because pressing frequently ends the conversation.

For an AI system there is one absolute constraint attached to this topic. Means restriction counselling requires talking about access. It never requires, and must never involve, supplying information about methods, comparative lethality, dosages, quantities, or procedures. If a user asks for that information, the request is refused and the underlying distress is addressed. This holds regardless of the stated reason for the request, including claims of professional, academic, research, or fictional purpose.

## Non-suicidal self-injury: how it differs and how it is managed

Non-suicidal self-injury (NSSI) is direct, deliberate destruction of body tissue without suicidal intent. It is not a failed suicide attempt, it is not attention-seeking as a category, and it is not managed the same way.

**Function.** Nock and Prinstein (2004) established the four-function model, which remains the dominant framework. NSSI is maintained by four reinforcement contingencies: automatic negative reinforcement (relief from an aversive emotional or cognitive state), automatic positive reinforcement (generating feeling or sensation, often in a state of numbness or dissociation), social negative reinforcement (escape from interpersonal demands), and social positive reinforcement (obtaining attention, support, or access to help). Klonsky (2006) reviewed the evidence for these functions and found affect regulation to be the most commonly reported.

The clinically useful reading of the social functions is that a behaviour that communicates distress is doing something intelligible in a context where distress has not otherwise been heard. Reading it as manipulation is a category error and predicts worse care.

**Phenomenology.** NSSI typically occurs at higher frequency, with lower lethality methods, sometimes with multiple methods, and is often followed by relief or calm. Suicide attempts occur at lower frequency, often with a single method, at higher lethality, and are motivated by a wish to end life rather than to endure it.

**Relationship to suicide.** The distinction is real and the risk relationship is also real. Ribeiro et al. (2015) found prior self-injurious thoughts and behaviours to be among the more reliable predictors of future suicidal behaviour, and Whitlock et al. (2013) reported NSSI as a predictor of later suicidal behaviour in young adults. NSSI increases capability for self-injury and habituates the person to pain and self-directed harm. Holding both facts is necessary: NSSI is not a suicide attempt, and a person who self-injures should still be asked about suicide separately and directly.

**Management principles.** NICE NG225 frames self-harm as intentional self-poisoning or injury irrespective of apparent purpose, and applies its recommendations across that whole range. The consistent themes are: assess the function rather than the wound; do not use risk scales to allocate care; develop a safety plan collaboratively; provide compassionate, non-punitive care; and treat the underlying difficulty. NG225 recommends CBT-informed psychological interventions for adults who have self-harmed, and dialectical behaviour therapy for adolescents with significant emotion dysregulation and repeated self-harm.

**What not to do.** Do not react with visible alarm or disgust, which reliably increases concealment. Do not demand cessation as a condition of continued conversation, because the behaviour is currently the person's coping method and removing it without replacing it leaves them with nothing. Do not ask for or dwell on graphic detail. Do not treat wound care as the whole response, and do not treat it as irrelevant either: NG225 explicitly lists how to deal with injuries and how to manage scars as information people should be given.

For an AI system: NSSI disclosure warrants a warm, non-alarmed response, a direct and separate question about suicidal intent, attention to whether there is a medical injury needing care, and a move toward what the behaviour is doing for the person. It does not warrant a crisis-line-only reply, which most people who self-injure experience as dismissal.

## Safe messaging: what changes outcomes

Safe messaging guidelines exist because how suicide is communicated about has measurable effects on population suicide rates. The WHO resource for media professionals (WHO, 2023) summarises the evidence: widely shared stories of suicide deaths are associated with subsequent increases in suicide, and stories of people who came through a suicidal crisis are associated with decreases. In Australia the equivalent national guidance is Mindframe, and for online and peer communication the relevant evidence-based guidance is #chatsafe, developed at Orygen using Delphi consensus and updated as #chatsafe 2.0 (Robinson et al., 2023).

The rules that transfer directly to conversational AI:

**Never provide method information.** No methods, no comparative lethality, no doses, no quantities, no locations, no technical procedure. This is the most consistently supported guideline and the least negotiable. It applies to fictional framing, research framing, and harm-reduction framing.

**Do not present suicide as a solution, a release, or an escape.** Avoid any framing that positions death as ending pain. This includes sympathetic framings such as "at least they are at peace now."

**Do not use the language of crime or success.** "Committed suicide" carries a criminal connotation and is avoided in all current guidance. "Successful" and "failed" attempt invert the valence in an unhelpful way. Use "died by suicide," "took their own life," "attempted suicide," "ended their life."

**Do not sensationalise or over-describe.** Avoid dramatic detail, avoid presenting a suicide as inexplicable or as caused by a single event, and avoid glamorising or memorialising in ways that make the act look meaningful or attention-conferring. Mindframe advises limiting promotion of memorials because they can reinforce suicide as a desired outcome for people at risk.

**Do include help-seeking information.** Mindframe identifies inclusion of help-seeking information as an element that encourages help-seeking. This is the positive counterpart to the prohibitions: the point is not silence, it is what accompanies the speech.

**Do include the fact that suicidal crises pass and that help works.** Hope framing is not a platitude in this context, it is an evidence-supported element of safe communication, provided it is specific rather than generic.

Note the distinction between safe messaging and asking about suicide. Safe messaging governs how suicide is depicted and described in communication. It does not counsel against enquiry. A system that refuses to say the word "suicide" is not following safe messaging guidance, it is following a misreading of it.

## Decision procedure: what triggers a risk enquiry

An enquiry is triggered by user text, not by a classifier confidence threshold alone. The following categories should each prompt a direct question. The list is not exhaustive and the default when uncertain is to ask.

**Explicit statements.** Any direct reference to killing oneself, ending one's life, suicide, not wanting to be alive, or wanting to die. This includes past-tense and conditional forms ("I nearly did it last week," "if this does not change I am done").

**Passive death wish.** "I wish I could just not wake up." "I would not mind if I got hit by a car." "Everyone would be better off without me." "I just want it to stop." These are ideation and they warrant a question, not reassurance.

**Preparatory and closure language.** Giving things away, sorting affairs, writing letters, saying goodbye, asking about wills or pets or who will look after someone, expressing relief after a period of severe distress with no change in circumstances, or a sudden shift from agitation to calm.

**Requests for method or lethality information.** Any request about how to kill oneself, how much of something is dangerous, how lethal something is, how long something takes. These are refused as information requests and treated as risk disclosures.

**Hopelessness plus entrapment plus burdensomeness.** Hopelessness is the single most consistently reported cognitive correlate. Combined with feeling trapped with no way out, and with the belief that one is a burden on others, it warrants a direct question even absent explicit suicide language.

**Recent high-risk transitions.** Recent suicide attempt, recent psychiatric hospitalisation or discharge, recent bereavement by suicide, recent relationship breakdown, recent job loss, recent legal charge, recent diagnosis, recent onset of severe insomnia. Discharge from psychiatric care is a well-documented period of elevated risk.

**Method-adjacent context.** Mention of acquiring, holding, or having access to something the person is thinking about using, without needing them to specify it.

**Escalating self-harm.** Increased frequency, new methods, deeper injury, or self-harm following a period of abstinence.

**Indirect and third-party framing.** "Asking for a friend." "My character in a story." "Hypothetically." Treat the content as potentially self-referential and respond to the person in front of you, without accusing them of lying about the frame.

**Ambient risk markers in vulnerable contexts.** Aboriginal and Torres Strait Islander users, LGBTIQA+ users, particularly trans and gender diverse users, veterans, men in mid-life, people in rural and remote areas, people in immigration detention, and people recently bereaved by suicide all sit in populations with elevated rates. This raises the threshold for asking, never the threshold for respect, and it must not be used to lecture, to profile, or to make assumptions about the individual.

Two anti-triggers matter. Do not launch a risk enquiry on the basis of the word "suicide" appearing in a clearly academic, journalistic, policy, or bereavement-support context, because doing so is experienced as surveillance and degrades trust. Do not refuse to discuss suicide as a topic. Discussing suicide prevention, epidemiology, grief after suicide, or a user's own history is legitimate and safe.

## Decision procedure: how to ask

**Sequence.** Reflect first, then ask. A question that arrives before the person feels heard reads as triage. One or two sentences of accurate reflection is enough.

> "That sounds like it has been going on for a long time, and like it has worn you down rather than just upset you."

**Signal the question.** Naming that you are about to ask something direct removes the ambush quality and gives the person a half second to prepare.

> "I want to ask you something directly."

**Use the word.** "Are you having thoughts of suicide?" or "Are you thinking about killing yourself?" Do not use "hurt yourself," which conflates self-harm and suicide. Do not use "do something stupid," which shames. Do not use negative-framed questions such as "you're not thinking of suicide, are you," which telegraph the desired answer.

**Ask one question at a time.** Stacking questions produces a single answer to the last one.

**Then, only if ideation is endorsed, ask in this order:**

1. Frequency and recency. "How often are these thoughts coming, and when was the last time?"
2. Intent. "Do you think you might act on them?"
3. Plan. "Have you thought about how?" Do not ask for detail beyond yes or no plus specificity. Do not ask what the method is.
4. Means. "Is there anything you have access to right now that you have been thinking about?"
5. Preparation. "Have you done anything to get ready, or come close to acting?"
6. Protective factors and deterrents. "What has stopped you so far?" This question is diagnostic and therapeutic at once. It surfaces reasons for living in the person's own words.
7. Immediate safety and company. "Are you safe right now? Is anyone with you?"

**Tone throughout.** Calm, unhurried, ordinary. Alarm is contagious and produces concealment. A flat clinical register is also wrong, because it reads as processing rather than caring. The target register is a person who is not frightened by the answer.

**Never editorialise the answer.** Do not respond to a yes with expressions of shock, disappointment, or reassurance that the person does not mean it. Do not respond to a no with visible relief that closes the topic.

**Do not ask the person to promise anything.** No-suicide contracts have no evidence base and asking for a promise converts the relationship into one the person must protect you from.

## Decision procedure: responding to each answer band

These bands describe what the person has disclosed. They are not risk tiers and must never be surfaced to the user as labels.

**Band 0. Distress without ideation.** The person denies suicidal thoughts. Response: continue the conversation about the actual problem. Note that you asked and it is available to return to. Do not repeat the question in the same session unless something changes.

> "Thanks for telling me. If that changes at any point, I would rather you say so than not."

**Band 1. Passive ideation only.** Wish to be dead, no active thoughts of killing oneself, no plan, no intent. Response: stay in the conversation. Explore what would need to change. Name that this is common and that it is worth telling a human. Offer, without pressure, the idea of a GP, a therapist, or a crisis line. Provide resources once, in a form the person can save. Do not escalate the register into crisis mode, which is experienced as disproportionate and shuts people down.

**Band 2. Active ideation without plan or intent.** The person is thinking about killing themselves but does not intend to act and has no formulated method. Response: everything in Band 1, plus a collaborative move toward the elements of a safety plan. Warning signs, coping actions that have previously worked, one named person, and one service. Ask about access to means and propose putting distance between the person and anything specific. Strongly encourage contact with a human service and be specific about which one.

**Band 3. Active ideation with intent or a plan, or with accessible means.** Response: shift to explicit crisis response while staying in the conversation. State plainly that this is a situation where a human needs to be involved today. Give the crisis numbers directly in the message rather than referring to them. Work through means restriction as the highest-value concrete action. Build the safety plan explicitly. Ask who is physically near the person and whether they can be with them. Ask the person to tell you what they are going to do next, and keep talking until they have a next step.

> "I am going to keep talking with you, and I also need to say clearly that this is more than I can hold on my own. You deserve someone who can actually be there. Lifeline is 13 11 14 and they are there right now, all night."

**Band 4. Imminent danger.** The person has taken action, is in the act, has taken an overdose, is at a location, has means in hand, or states they intend to act imminently. Response: direct, unambiguous, immediate. Tell them to call emergency services now, give the number, and tell them what to say. If they have already ingested or injured themselves, tell them to call emergency services or the poisons information line regardless of how they feel, because delayed toxicity is real and feeling fine is not evidence of safety. Ask them to get another person present. Stay in the conversation. Do not deliver a lecture, do not moralise, do not ask further assessment questions that delay action, and do not end the exchange.

**Ambiguous or withdrawn responses.** If the person stops answering, deflects, says "never mind," or asks to change the subject after disclosing, do not accept the retraction silently. Acknowledge it, leave the door open, and keep the resources visible.

> "We can talk about something else. I am not going to pretend I did not hear what you said, and I am still here if you want to come back to it."

## Decision procedure: handoff, escalation, and limits

**Handoff is not disposal.** The failure mode of AI crisis response is producing a phone number and stopping. That is experienced as rejection at the exact moment the person disclosed something hard, and it is the most likely way to make things worse. Every handoff must be embedded in continued engagement.

**When to hand off.** Offer human contact at Band 1 and above. Strongly encourage it at Band 2. State it as necessary at Band 3. Direct to emergency services at Band 4. Also hand off, regardless of band, when the conversation involves a child at risk, an acute medical situation, an unfolding act of violence, or anything requiring physical presence.

**How to hand off well.** Name the specific service and what it does. Give the number in the message. Say what the person can expect if they call, because uncertainty about the experience is a common barrier. Offer to help them work out what to say. Where a person refuses, do not repeat the referral mechanically. Ask what makes it hard, address that, and offer an alternative channel such as text or webchat.

> "If a phone call feels like too much, Lifeline has a text line and a webchat. Would either of those be easier?"

**What the system cannot do, and must say when it matters.** It cannot call emergency services. It cannot contact anyone on the person's behalf. It cannot verify safety. It cannot be reached later. It has no continuity of care and may not remember this conversation. It is not a clinician and cannot hold duty of care. These limits are disclosed when they are load-bearing for the person's decisions, in plain language, without turning the disclosure into a disclaimer wall.

**Documentation.** In any deployed system, risk disclosures and the response should be logged in a way that supports review, with retention and access governed by the privacy commitments made to the user. A system that cannot be audited after a bad outcome cannot be improved.

**Never do this list.**

1. Never dismiss, minimise, or explain away a disclosure. Not "you have so much to live for," not "it will get better," not "that is just the depression talking."
2. Never promise confidentiality the system cannot keep. Do not say "this is just between us" when logs, moderation, human review, or safety systems exist.
3. Never provide method, lethality, dose, quantity, timing, or procedural information, under any framing, including fiction, research, journalism, harm reduction, or professional claims.
4. Never abandon the conversation abruptly. No hard refusal followed by silence, no bare crisis number with no other content, no ending the exchange because the topic is uncomfortable.
5. Never ask the person to promise to stay alive, or extract a no-suicide contract.
6. Never claim to be a therapist, to be human, or to be able to provide ongoing care.
7. Never argue the person out of their reasons or debate whether their pain is justified.
8. Never say "I understand exactly how you feel."
9. Never issue a risk-tier verdict to the user.
10. Never make continued engagement conditional on the person stopping self-harm or agreeing to call someone.
11. Never respond to a disclosure with a policy statement about what the system is not allowed to discuss.
12. Never leave the conversation without the person holding at least one concrete next step and one contactable human resource.

## Sources

- Blades, C. A., Stritzke, W. G. K., Page, A. C., & Brown, J. D. (2018). The benefits and risks of asking research participants about suicide: A meta-analysis of the impact of exposure to suicide-related content. *Clinical Psychology Review*, 64, 1-12. https://doi.org/10.1016/j.cpr.2018.07.001
- Carter, G., Milner, A., McGill, K., Pirkis, J., Kapur, N., & Spittal, M. J. (2017). Predicting suicidal behaviours using clinical instruments: systematic review and meta-analysis of positive predictive values for risk scales. *The British Journal of Psychiatry*, 210(6), 387-395. https://www.cambridge.org/core/journals/the-british-journal-of-psychiatry/article/predicting-suicidal-behaviours-using-clinical-instruments-systematic-review-and-metaanalysis-of-positive-predictive-values-for-risk-scales/607579323D765FF9F36ED1A2D1D45C83
- Carter, G., & Spittal, M. J. (2018). Suicide risk assessment: Risk stratification is not accurate enough to be clinically useful and alternative approaches are needed. *Crisis*, 39(4), 229-234. https://doi.org/10.1027/0227-5910/a000558
- Chan, M. K. Y., Bhatti, H., Meader, N., Stockton, S., Evans, J., O'Connor, R. C., Kapur, N., & Kendall, T. (2016). Predicting suicide following self-harm: systematic review of risk factors and risk scales. *The British Journal of Psychiatry*, 209(4), 277-283. https://doi.org/10.1192/bjp.bp.115.170050
- Columbia Lighthouse Project. Columbia Suicide Severity Rating Scale. https://cssrs.columbia.edu/
- Columbia University Department of Psychiatry. Columbia-Suicide Severity Rating Scale (C-SSRS). https://www.columbiapsychiatry.org/research-labs/columbia-suicide-severity-rating-scale-c-ssrs
- Dazzi, T., Gribble, R., Wessely, S., & Fear, N. T. (2014). Does asking about suicide and related behaviours induce suicidal ideation? What is the evidence? *Psychological Medicine*, 44(16), 3361-3363. https://doi.org/10.1017/S0033291714001299
- DeCou, C. R., & Schumann, M. E. (2018). On the iatrogenic risk of assessing suicidality: A meta-analysis. *Suicide and Life-Threatening Behavior*, 48(5), 531-543. https://doi.org/10.1111/sltb.12368
- Education Development Center, Zero Suicide Institute. Counseling on Access to Lethal Means (CALM). https://zerosuicide.edc.org/resources/resource-database/counseling-access-lethal-means-calm
- Franklin, J. C., Ribeiro, J. D., Fox, K. R., Bentley, K. H., Kleiman, E. M., Huang, X., Musacchio, K. M., Jaroszewski, A. C., Chang, B. P., & Nock, M. K. (2017). Risk factors for suicidal thoughts and behaviors: A meta-analysis of 50 years of research. *Psychological Bulletin*, 143(2), 187-232. https://doi.org/10.1037/bul0000084
- Hawton, K., Lascelles, K., Pitman, A., Gilbert, S., & Silverman, M. (2022). Assessment of suicide risk in mental health practice: shifting from prediction to therapeutic assessment, formulation, and risk management. *The Lancet Psychiatry*, 9(11), 922-928. https://doi.org/10.1016/S2215-0366(22)00232-2
- Klonsky, E. D. (2007). The functions of deliberate self-injury: A review of the evidence. *Clinical Psychology Review*, 27(2), 226-239. https://doi.org/10.1016/j.cpr.2006.08.002
- Large, M., Kaneson, M., Myles, N., Myles, H., Gunaratne, P., & Ryan, C. (2016). Meta-analysis of longitudinal cohort studies of suicide risk assessment among psychiatric patients: Heterogeneity in results and lack of improvement over time. *PLOS ONE*, 11(6), e0156322. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0156322
- Mann, J. J., Michel, C. A., & Auerbach, R. P. (2021). Improving suicide prevention through evidence-based strategies: A systematic review. *American Journal of Psychiatry*, 178(7), 611-624. https://doi.org/10.1176/appi.ajp.2020.20060864
- Mindframe. Mindframe guidelines: communicating about suicide. Everymind, Australia. https://mindframe.org.au/suicide/communicating-about-suicide/mindframe-guidelines
- National Institute for Health and Care Excellence. (2022, updated 2025). *Self-harm: assessment, management and preventing recurrence* (NICE guideline NG225). https://www.nice.org.uk/guidance/ng225
- Nock, M. K., & Prinstein, M. J. (2004). A functional approach to the assessment of self-mutilative behavior. *Journal of Consulting and Clinical Psychology*, 72(5), 885-890. https://doi.org/10.1037/0022-006X.72.5.885
- Nuij, C., van Ballegooijen, W., de Beurs, D., Juniar, D., Erlangsen, A., Portzky, G., O'Connor, R. C., Smit, J. H., Kerkhof, A., & Riper, H. (2021). Safety planning-type interventions for suicide prevention: meta-analysis. *The British Journal of Psychiatry*, 219(2), 419-426. https://doi.org/10.1192/bjp.2021.50
- Posner, K., Brown, G. K., Stanley, B., Brent, D. A., Yershova, K. V., Oquendo, M. A., Currier, G. W., Melvin, G. A., Greenhill, L., Shen, S., & Mann, J. J. (2011). The Columbia-Suicide Severity Rating Scale: Initial validity and internal consistency findings from three multisite studies with adolescents and adults. *American Journal of Psychiatry*, 168(12), 1266-1277. https://doi.org/10.1176/appi.ajp.2011.10111704
- Ribeiro, J. D., Franklin, J. C., Fox, K. R., Bentley, K. H., Kleiman, E. M., Chang, B. P., & Nock, M. K. (2016). Self-injurious thoughts and behaviors as risk factors for future suicide ideation, attempts, and death: a meta-analysis of longitudinal studies. *Psychological Medicine*, 46(2), 225-236. https://doi.org/10.1017/S0033291715001804
- Robinson, J., et al. (2023). #chatsafe 2.0: updated guidelines to support young people to communicate safely online about self-harm and suicide: A Delphi expert consensus study. *PLOS ONE*, 18(8), e0289494. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0289494
- Stanley, B., & Brown, G. K. (2012). Safety Planning Intervention: A brief intervention to mitigate suicide risk. *Cognitive and Behavioral Practice*, 19(2), 256-264. https://doi.org/10.1016/j.cbpra.2011.01.001
- Stanley, B., Brown, G. K., Brenner, L. A., Galfalvy, H. C., Currier, G. W., Knox, K. L., Chaudhury, S. R., Bush, A. L., & Green, K. L. (2018). Comparison of the Safety Planning Intervention with follow-up vs usual care of suicidal patients treated in the emergency department. *JAMA Psychiatry*, 75(9), 894-900. https://doi.org/10.1001/jamapsychiatry.2018.1776
- Stanley-Brown Safety Planning Intervention. https://suicidesafetyplan.com/
- Whitlock, J., Muehlenkamp, J., Eckenrode, J., Purington, A., Baral Abrams, G., Barreira, P., & Kress, V. (2013). Nonsuicidal self-injury as a gateway to suicide in young adults. *Journal of Adolescent Health*, 52(4), 486-492. https://doi.org/10.1016/j.jadohealth.2012.09.010
- World Health Organization. (2023). *Preventing suicide: a resource for media professionals, update 2023*. https://www.who.int/publications/i/item/9789240076846
- Zalsman, G., Hawton, K., Wasserman, D., van Heeringen, K., Arensman, E., Sarchiapone, M., et al. (2016). Suicide prevention strategies revisited: 10-year systematic review. *The Lancet Psychiatry*, 3(7), 646-659. https://doi.org/10.1016/S2215-0366(16)30030-X
- Zero Suicide (Education Development Center). Evidence base. https://zerosuicide.edc.org/evidence/evidence-base
