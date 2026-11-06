---
title: Empirical Evidence for LLM and Chatbot Delivery of Psychotherapy
section: evidence-base
tags: [rct, chatbot-therapy, therabot, woebot, meta-analysis, effect-size, attrition, waitlist-control, digital-therapeutics]
summary: Controlled evidence that conversational agents reduce depression and anxiety symptoms is real but small, short, mostly waitlist-controlled, and drawn from populations screened to exclude the highest-risk patients.
---

## Scope and how to read this evidence base

This file covers controlled empirical work on chatbot and LLM delivery of psychotherapy and counselling. It separates two generations of system that are often conflated. The first generation is rule-based or decision-tree conversational agents that deliver scripted cognitive behavioural therapy content, exemplified by Woebot (Fitzpatrick et al., 2017, JMIR Mental Health, doi:10.2196/mental.7785). The second is generative agents whose turns are produced by a language model, exemplified by Therabot (Heinz et al., 2025, NEJM AI, doi:10.1056/AIoa2400802). Almost all of the meta-analytic evidence pools the first generation. Only one randomised controlled trial of a purpose-built generative agent for clinical-level symptoms had been published at the time of writing.

Three structural features of this literature constrain what any claim from it can support. First, the dominant comparator is a waitlist or assessment-only control, which measures the effect of receiving something rather than the effect of receiving therapy specifically. Second, follow-up periods are short, typically two to eight weeks, so durability is largely unmeasured. Third, trials screen out the patients whose mismanagement would be most dangerous, which means the safety evidence and the efficacy evidence come from different populations than the one a deployed system will meet.

A system builder should treat the efficacy literature as evidence that structured, evidence-based content delivered conversationally produces small to moderate short-term symptom change in help-seeking adults with mild to moderate presentations. It is not evidence that a language model can safely occupy the role of a therapist, and it is not evidence about acute risk, psychosis, mania, or complex presentations. Those questions are addressed in `failure-modes.md`, and the measurement instruments referenced here are described in `evaluation-and-alliance.md`.

## The first chatbot RCT: Woebot, 2017

Fitzpatrick, Darcy and Vierhile (2017, JMIR Mental Health 4(2):e19, doi:10.2196/mental.7785) ran the first randomised controlled trial of a therapy chatbot. Seventy participants aged 18 to 28, recruited from a university community social media site, were randomised to two weeks of Woebot (n=34) or to an information-only control that received the National Institute of Mental Health ebook on depression in college students (n=36).

The depression result was positive and modest. Participants in the Woebot condition significantly reduced PHQ-9 scores while the information control did not, F(1,48)=6.03, p=.017, with a between-groups effect size of d=0.44 (Fitzpatrick et al., 2017). The anxiety result is the more instructive one. Both groups significantly reduced GAD-7 scores, F(1,54)=9.24, p=.004, with no significant between-group difference (Fitzpatrick et al., 2017). The authors state directly that the control group's improvement supports the literature suggesting minimal passive psychoeducation alone can reduce psychological distress.

That second finding is the single most useful piece of calibration in the early literature. A static ebook produced anxiety reduction equal to a conversational agent. Any claim that conversational delivery is the active ingredient has to survive that comparison, and in this trial it did not for anxiety.

Attrition was 17 percent overall and was not equal between arms (Fitzpatrick et al., 2017). The authors list the limitations plainly: a small feasibility sample, a short two-week dose, no follow-up data to assess whether gains were sustained, no capacity for mediation analysis, no engagement data for the control arm, and a single New York area university community population with no assessment of socioeconomic or digital-divide factors. They also note that because the control contained no CBT-specific material, the trial cannot separate the effect of conversational delivery from the effect of the CBT content itself.

The trial ran for two weeks with no follow-up. Nothing in it speaks to whether effects persist.

## The Therabot RCT: design and results

Heinz et al. (2025, NEJM AI, doi:10.1056/AIoa2400802) reported the first randomised controlled trial of a fine-tuned generative AI chatbot for clinical-level mental health symptoms. Therabot was developed at Dartmouth from 2019 and trained on professionally written therapist-patient dialogues grounded in third-wave cognitive behavioural therapy.

Two hundred and ten adults were randomised to a four-week Therabot intervention (n=106) or a waitlist control (n=104), with outcomes assessed at four weeks post-intervention and at eight weeks follow-up. Participants could belong to more than one diagnostic cohort: 142 met criteria for major depressive disorder, 116 for generalised anxiety disorder, and 89 were at clinically high risk for feeding and eating disorders (Heinz et al., 2025). Analysis used cumulative-link mixed models with complete-case analysis.

| Outcome | Measure | Mean change at 4 wk (Therabot vs control) | Mean change at 8 wk | Cohen's d range |
|---|---|---|---|---|
| Depression | PHQ-9 | −6.13 vs +2.63 | −7.93 vs −4.22 | 0.845 to 0.903 |
| Anxiety | GAD-Q-IV | −2.32 vs −0.13 | −3.18 vs −1.11 | 0.794 to 0.840 |
| Eating disorder risk | Weight Concerns Scale | reported as favouring Therabot | −10.23 vs −3.70 | 0.627 to 0.819 |

Reported odds ratios were 0.216 (p<.001, d=−0.845) for PHQ-9 change at post-intervention and 0.194 (p<.001, d=−0.903) at follow-up; 0.218 (p<.001, d=−0.840) and 0.237 (p=.001, d=−0.794) for GAD-Q-IV; and 0.227 (p=.004, d=−0.819) and 0.321 (p=.027, d=−0.627) for the Weight Concerns Scale (Heinz et al., 2025).

Engagement was high by digital therapeutic standards. Of those assigned to Therabot, 101 of 106 (95 percent) interacted with it. The mean number of messages sent was 260, ranging from 1 to 1557. Participants interacted on a mean of 24 days, ranging from 1 to 60, for a mean total of 6.18 hours across the study (Heinz et al., 2025).

Working alliance was measured with the WAI-SR in 96 treatment-group participants. The overall mean was 3.59 (SD 1.27), with Bond 3.71 (SD 1.28), Task 3.47 (SD 1.30) and Goal 3.59 (SD 1.35). The authors describe this as comparable to norms reported in an outpatient psychotherapy sample (Heinz et al., 2025).

The claim that alliance matched human therapy is widely repeated and deserves the actual comparison. The outpatient norms the paper benchmarks against are Munder et al. (2010, Clinical Psychology and Psychotherapy 17:231-239, doi:10.1002/cpp.658), reported in the paper's own figure as Bond 4.0 (SD 0.78), Task 3.4 (SD 0.77), Goal 4.0 (SD 0.68) and average 3.8 (SD 0.63). Therabot scored below the outpatient norm on Bond (3.71 against 4.0), below on Goal (3.59 against 4.0), marginally above on Task (3.47 against 3.4), and below on the overall average (3.59 against 3.8). The differences are small relative to the standard deviations, so "comparable" is defensible, but the pattern is informative. The chatbot performed relatively best on the task component of alliance, which is agreement about what to do, and relatively worst on bond and goal, which are the relational and directional components. That is the profile you would expect from a system that is good at supplying structured technique and weaker at relationship.

On a seven-point satisfaction scale, users rated Therabot as similar to a real therapist at 4.90 (SD 2.21), the lowest-scoring satisfaction item in the set.

## What the Therabot trial excluded, and why it matters

The most important number in Heinz et al. (2025, NEJM AI, doi:10.1056/AIoa2400802) is not an effect size. It is the exclusion count. Of 1707 people screened, 743 were ineligible by inclusion criteria and 754 were excluded by exclusion criteria. Those 754 break down as 480 at high risk for a clinical eating disorder, 215 at high risk for suicide, 58 at high risk for mania, and 1 at high risk for psychosis.

The trial therefore establishes efficacy in a population from which everyone at acute suicide risk, everyone at high mania risk, and everyone at psychosis risk had been removed in advance. Those are precisely the presentations on which language models have been shown to fail most severely (Moore et al., 2025, FAccT, doi:10.1145/3715275.3732039). The efficacy evidence and the danger zone do not overlap.

The trial also ran with active human supervision that a deployed product would not have. Study staff intervened after transmission 15 times for participant safety concerns such as expressions of suicidal ideation, and 13 times to correct inappropriate responses produced by Therabot, including instances of the chatbot providing medical advice (Heinz et al., 2025). Twenty-eight staff interventions across 106 participants over eight weeks is roughly one intervention per four participants. The reported outcomes are outcomes of a supervised system, not an autonomous one.

The authors' own stated limitations are selection bias toward younger, more technologically minded participants open to AI, possible selection effects from up-front disclosure of a monetary incentive, potential differential contact between arms inherent to waitlist-controlled designs, and a follow-up period limited to four weeks post-intervention. They state that longer studies are needed to assess durability (Heinz et al., 2025).

The design implication for a retrieval-grounded psychology system is direct. Any capability claim inherited from this trial applies only to non-acute presentations under human oversight. Screening and escalation cannot be treated as an add-on to the therapeutic function, because the evidence for the therapeutic function was generated only after screening had already removed the high-risk cases.

## Meta-analytic estimates across conversational agents

Two large syntheses give the pooled picture, and they agree closely on magnitude.

He et al. (2023, Journal of Medical Internet Research 25:e43862, doi:10.2196/43862) pooled 32 randomised controlled trials with 6089 participants. Short-term post-intervention effects were g=0.29 (95% CI 0.20 to 0.38, k=27) for depressive symptoms, g=0.29 (95% CI 0.21 to 0.36, k=18) for generalised anxiety, g=0.47 (95% CI 0.07 to 0.86, k=18) for specific anxiety, g=0.33 (95% CI 0.20 to 0.45) for general distress, g=0.27 (95% CI 0.16 to 0.39) for quality of life, and g=0.24 (95% CI 0.08 to 0.41) for stress. Risk of bias was rated low in 8 studies, of some concern in 11, and high in 13. The authors identify personalisation and empathic response as the two critical facilitators of efficacy.

Sohn et al. (2026, npj Digital Medicine 9:377, doi:10.1038/s41746-026-02566-w) pooled 39 randomised controlled trials, with 38 studies (N=7401) contributing to the depression analysis and 34 studies (N=7621) to anxiety. Pooled effects were g=0.31 (95% CI 0.17 to 0.46) for depression and g=0.28 (95% CI 0.05 to 0.51) for anxiety. Heterogeneity was high, I²=85.34 percent for depression and I²=94.32 percent for anxiety. Thirty-five of 39 studies carried a high overall risk of bias, primarily because participants cannot be blinded.

Two moderator findings from Sohn et al. (2026) matter for design. Effects scaled with baseline severity: g=0.64 in clinical populations, g=0.34 in subclinical samples, and g=0.07 in non-clinical samples (p=0.001). And no significant difference emerged between generative-AI-based and retrieval-based chatbots on either outcome, though the authors note the generative comparison was underpowered. As of that synthesis, there is no meta-analytic evidence that generative architecture outperforms rule-based delivery.

The consistent picture across both syntheses is a pooled effect around g=0.28 to 0.31, which is small. Individual trials reporting large effects, including Therabot's d values approaching 0.9, sit well above the pooled estimate and should be read as single-trial results awaiting replication.

## Durability: effects shrink or vanish at follow-up

The follow-up data in He et al. (2023, Journal of Medical Internet Research 25:e43862, doi:10.2196/43862) are the most sobering part of the conversational agent literature, and they are routinely omitted from summaries.

| Outcome | Short-term g (95% CI) | Follow-up g (95% CI) |
|---|---|---|
| Depressive symptoms | 0.29 (0.20 to 0.38) | 0.16 (0.06 to 0.26) |
| Generalised anxiety | 0.29 (0.21 to 0.36) | 0.08 (−0.04 to 0.20) |
| Specific anxiety | 0.47 (0.07 to 0.86) | 0.11 (−0.32 to 0.55) |
| Quality of life | 0.27 (0.16 to 0.39) | −0.04 (−0.19 to 0.11) |
| Stress | 0.24 (0.08 to 0.41) | 0.09 (−0.12 to 0.29) |

At follow-up, generalised anxiety, specific anxiety, quality of life and stress all lost statistical significance. Depression retained a significant but roughly halved effect. The authors conclude that long-term effects for most mental health outcomes were not statistically significant, and that long-term impacts were less than ideal.

The Therabot trial does not resolve this. Its follow-up ran only four weeks past the end of the intervention, and the authors identify this as a limitation (Heinz et al., 2025, NEJM AI, doi:10.1056/AIoa2400802). Notably, in the Therabot follow-up window the waitlist control also improved substantially on PHQ-9, from +2.63 at four weeks to −4.22 at eight weeks, which narrows the between-group gap even as the reported effect size for depression rose. Read the mean changes alongside the effect sizes rather than either alone.

For a builder, the implication is that whatever a conversational system achieves, it achieves while the person is actively using it, and the literature provides little support for lasting change after use stops. Systems designed around consolidation, skills transfer, and handoff to durable supports are working with the grain of the evidence. Systems designed around indefinite engagement are not, and engagement-maximising design carries the separate risks documented in `failure-modes.md`.

## Attrition, engagement, and the comparator problem

Three methodological problems recur across this literature and jointly limit how strongly any result can be read.

Attrition is high and often differential. The Woebot trial lost 17 percent by two weeks, and attrition was not equal between arms (Fitzpatrick et al., 2017, JMIR Mental Health, doi:10.2196/mental.7785). The Therabot trial retained better, with 6 of 106 discontinuing the intervention and small losses to follow-up, but ran only eight weeks total with paid participants under active study contact (Heinz et al., 2025, NEJM AI, doi:10.1056/AIoa2400802). Trial-grade retention should not be assumed to transfer to unpaid, unmonitored real-world use.

Blinding is impossible. Sohn et al. (2026, npj Digital Medicine 9:377, doi:10.1038/s41746-026-02566-w) rated 35 of 39 trials at high overall risk of bias primarily on this ground. Participants know whether they have been given an app, self-report the outcome measures, and have expectations about what the app should do. Every pooled effect in this literature is measured through that channel.

The comparator is usually inactive. Waitlist and assessment-only controls inflate apparent effects relative to active comparators in psychotherapy research generally. Sohn et al. (2026) tested this directly and found no statistically significant difference between waitlist or assessment-only conditions and active controls, which is a point in favour of the chatbot effects being real. That finding sits against the Woebot result, where a static psychoeducation ebook matched the chatbot on anxiety reduction (Fitzpatrick et al., 2017). The honest reading is that the comparator question is unresolved, and that some portion of the observed effect is attributable to receiving attention, structure, and a place to write things down rather than to the specific intervention.

No trial retrieved for this review compared an LLM-delivered therapy against a human therapist in a head-to-head randomised design. Claims that chatbot therapy matches human therapy are not currently supported by direct comparison. The available comparisons are indirect and process-level. On working alliance, Therabot users' WAI-SR mean of 3.59 was described as comparable to outpatient psychotherapy norms (Heinz et al., 2025). On response appropriateness to acute clinical stimuli, 16 human therapists responded appropriately 93 percent of the time, significantly more than every model tested (Moore et al., 2025, FAccT, doi:10.1145/3715275.3732039). Alliance and safety diverge, and a system can score well on the first while failing the second.

## Deployment and vendor evidence outside randomised trials

A large share of the publicly cited evidence for commercial mental health chatbots comes from uncontrolled deployment data, service evaluations, and vendor-published case studies rather than randomised trials. This material is useful for questions about access and workflow and weak for questions about clinical efficacy.

The clearest example is triage and self-referral rather than therapy. Limbic Access, a conversational AI self-referral tool deployed in NHS Talking Therapies services, has been associated with increased referral volume in services using it relative to services that were not, alongside reductions in assessment time (MIT Technology Review, 2024, reporting on the deployment). Vendor-published figures for diagnostic reliability, dropout reduction and treatment-allocation stability circulate widely (limbic.ai research and case-study pages). Those specific vendor-reported percentages were not verified against a peer-reviewed primary source for this file and should be treated as `[UNVERIFIED]` until checked.

Wysa is frequently cited as evidence-backed. Its published record includes protocols and prospective cohort work on chronic pain populations, and a controlled trial in the NHS referral pathway was registered (NCT05533190). The specific effect sizes commonly attributed to Wysa were not verified against primary sources for this file and are marked `[UNVERIFIED]`.

The Tessa case shows how quickly deployment evidence and product identity separate. Tessa was a rule-based chatbot associated with the National Eating Disorders Association. After a vendor added generative capability, the deployed system gave users advice on counting calories, restricting diet, and losing one to two pounds per week, which is contraindicated for the eating disorder population it served, and NEDA took it offline in mid-2023 (CNN Business, 2023; NPR, 2023). The evidence supporting the original rule-based program did not transfer to the modified system, and the organisation had received screenshots flagging problems months before public reporting.

The general rule this supports: evidence attaches to a specific system version, corpus, and guardrail configuration, not to a product name. A retrieval-grounded system changes its own evidence base every time its corpus or model changes.

## What the evidence base does not yet contain

Stating the gaps precisely is more useful than restating the findings. As of the sources retrieved for this file, the following do not exist in the published controlled literature.

There is no randomised head-to-head trial of an LLM therapist against a human therapist. There is no trial in populations at acute suicide risk, in active psychosis, or in mania, because those groups are systematically excluded at screening (Heinz et al., 2025, NEJM AI, doi:10.1056/AIoa2400802). There is no trial of an unsupervised generative agent; the one positive generative trial ran with clinician monitoring and 28 recorded staff interventions. There is no follow-up beyond a few weeks for generative agents, and the rule-based follow-up data show most effects becoming non-significant (He et al., 2023, JMIR 25:e43862, doi:10.2196/43862). There is no meta-analytic evidence that generative agents outperform rule-based ones (Sohn et al., 2026, npj Digital Medicine 9:377, doi:10.1038/s41746-026-02566-w). There is no adequately powered evidence on differential efficacy across demographic groups, which sits uncomfortably beside the documented demographic biases discussed in `failure-modes.md`.

There is also no evidence base at all for the specific configuration this knowledge base supports, which is a retrieval-augmented model reasoning with clinical knowledge. The RAG literature summarised in `rag-for-clinical-reasoning.md` is drawn from medical question answering rather than from therapy delivery, and the transfer is an assumption rather than a finding.

The defensible position a builder can hold is narrow. Conversational delivery of structured, evidence-based psychological content produces small to moderate short-term symptom reduction in screened, non-acute, help-seeking adults, with effects that attenuate after use ends, measured almost entirely against inactive comparators in unblinded designs. Everything beyond that sentence is extrapolation.

## Sources

- Fitzpatrick KK, Darcy A, Vierhile M. Delivering Cognitive Behavior Therapy to Young Adults With Symptoms of Depression and Anxiety Using a Fully Automated Conversational Agent (Woebot): A Randomized Controlled Trial. JMIR Mental Health. 2017;4(2):e19. doi:10.2196/mental.7785. https://mental.jmir.org/2017/2/e19/
- Heinz MV, et al. Randomized Trial of a Generative AI Chatbot for Mental Health Treatment. NEJM AI. 2025. doi:10.1056/AIoa2400802. https://ai.nejm.org/doi/full/10.1056/AIoa2400802
- Dartmouth. First Therapy Chatbot Trial Yields Mental Health Benefits. 2025. https://home.dartmouth.edu/news/2025/03/first-therapy-chatbot-trial-yields-mental-health-benefits
- Healio. Generative AI chatbot "promising" for mental health treatment, but supervision needed. 2025. https://www.healio.com/news/psychiatry/20250410/generative-ai-chatbot-promising-for-mental-health-treatment-but-supervision-needed
- He Y, Yang L, Qian C, Li T, Su Z, Zhang Q, Hou X. Conversational Agent Interventions for Mental Health Problems: Systematic Review and Meta-analysis of Randomized Controlled Trials. J Med Internet Res. 2023;25:e43862. doi:10.2196/43862. https://pmc.ncbi.nlm.nih.gov/articles/PMC10182468/
- Sohn J-S, Ha B-G, Park S, Kim J-J, Lee E, Oh H, Lee S, Kim E. Systematic review and meta-analysis of chatbots in the management of depressive and anxiety symptoms. npj Digital Medicine. 2026;9:377. doi:10.1038/s41746-026-02566-w. https://www.nature.com/articles/s41746-026-02566-w
- Moore J, Grabb D, Agnew W, Klyman K, Chancellor S, Ong DC, Haber N. Expressing stigma and inappropriate responses prevents LLMs from safely replacing mental health providers. FAccT 2025:599-627. doi:10.1145/3715275.3732039. Preprint arXiv:2504.18412. https://arxiv.org/abs/2504.18412
- CNN Business. National Eating Disorders Association takes its AI chatbot offline after complaints of "harmful" advice. 2023. https://www.cnn.com/2023/06/01/tech/eating-disorder-chatbot/
- NPR. Chatbot that offered bad advice for eating disorders taken down. 2023. https://www.npr.org/sections/health-shots/2023/06/08/1180838096/an-eating-disorders-chatbot-offered-dieting-advice-raising-fears-about-ai-in-hea
- MIT Technology Review. A chatbot helped more people access mental-health services. 2024. https://www.technologyreview.com/2024/02/05/1087690/a-chatbot-helped-more-people-access-mental-health-services/
- Limbic. Clinical research pages (vendor-published, not independently verified for this file). https://www.limbic.ai/research/closing-accessibility-gap
- ClinicalTrials.gov. Clinical Investigation of Wysa. NCT05533190. https://www.centerwatch.com/clinical-trials/listings/NCT05533190/clinical-investigation-of-wysa
