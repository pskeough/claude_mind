---
title: Screening and Outcome Instruments: Scoring, Properties, and Misuse
section: assessment
tags: [PHQ-9, GAD-7, DASS-21, K10, BDI-II, PCL-5, AUDIT, AUDIT-C, ASRS, AQ-10, MDQ, WHODAS, ORS, SRS, screening, sensitivity, specificity, base-rates, positive-predictive-value]
summary: What each common mental health measure actually assesses, its verified scoring bands and cut-points, its sensitivity and specificity where established, and the specific way each one gets misused.
---

## Screening instruments are not diagnostic tests

Every instrument in this file is a screening or severity measure. None of them diagnoses anything. The distinction is not a disclaimer, it is a statement about what the numbers mean.

A screening instrument sorts people into a group who probably warrant further assessment and a group who probably do not. It is calibrated to be cheap, fast, and sensitive, and it accepts a high false-positive rate as the price. A diagnostic assessment is a structured evaluation against criteria, conducted by a clinician, incorporating history, duration, functional impairment, differential consideration, and exclusion of medical and substance causes. The reference standard against which screening instruments are validated is a semi-structured diagnostic interview, not another questionnaire.

Three consequences follow, and all three are routinely violated in practice.

A score above a cut-point is a positive screen, not a diagnosis. "PHQ-9 of 16" means the person reported symptoms at a level that warrants clinical assessment. It does not mean they have major depressive disorder, and a majority of positive screens in low-prevalence settings are false positives, which the next section quantifies.

Severity bands are conventions, not natural categories. The boundary between "moderate" and "moderately severe" on the PHQ-9 is a line drawn on a continuum. A person scoring 14 and a person scoring 15 are not meaningfully different, and given measurement error they are frequently not even reliably different, as covered in the interpretation file.

The instrument measures self-report under specific conditions. Change the wording, the response options, the recall window, or who does the rating, and the published properties no longer apply. This includes the case where a system reads a conversation and estimates what someone would have scored, which is not administration.

One further point applies across all of them. These instruments were largely developed and validated in high-income, English-speaking, predominantly white samples. Cut-points in particular are the least transportable component, because a cut-point encodes both the item functioning and the base rate of the validation sample.

## Base rates and positive predictive value: a worked example

Sensitivity and specificity are properties of the test. Positive predictive value is a property of the test in a population, and it is what a clinician actually needs to know. The gap between them is the most consequential piece of arithmetic in screening.

Sensitivity is the proportion of people with the condition who screen positive. Specificity is the proportion of people without the condition who screen negative. Positive predictive value (PPV) is the proportion of people who screen positive who actually have the condition. PPV depends on prevalence, and it collapses as prevalence falls.

Take the PHQ-9 at its standard cut-point of 10. The individual participant data meta-analysis by Levis, Benedetti and Thombs (2019), pooling 29 studies and 6,725 participants against a semi-structured interview reference standard, found sensitivity 0.88 (95% CI 0.83 to 0.92) and specificity 0.85 (95% CI 0.82 to 0.88). Hold those fixed and vary prevalence.

Scenario A, general adult population screening. Take an 8% prevalence of past-year major depressive episode, close to the NIMH figure of 8.3% for US adults in 2021. In 10,000 people, 800 have the condition and 9,200 do not.
True positives: 800 × 0.88 = 704.
False negatives: 96.
False positives: 9,200 × 0.15 = 1,380.
True negatives: 7,820.
PPV = 704 / (704 + 1,380) = 704 / 2,084 = 33.8%.
Roughly two out of every three positive screens are wrong.

Scenario B, community screening at a lower point prevalence of 2%. In 10,000 people, 200 have the condition.
True positives: 176. False positives: 9,800 × 0.15 = 1,470.
PPV = 176 / 1,646 = 10.7%.
Nearly nine out of ten positive screens are wrong.

Scenario C, a psychiatric outpatient clinic where prevalence is 30%. In 10,000 people, 3,000 have the condition.
True positives: 2,640. False positives: 7,000 × 0.15 = 1,050.
PPV = 2,640 / 3,690 = 71.5%.

The test did not change. Its sensitivity and specificity are identical in all three. What changed is the prior probability, and PPV moved from 11% to 72%. Levis et al. flag this directly, noting that at cut-point 10 in low-prevalence settings PPV can be around 49%, meaning about half of positive screens are false.

Negative predictive value moves the opposite way and is high in low-prevalence settings. In Scenario A, NPV is 7,820 / 7,916 = 98.8%. A negative screen in a low-prevalence population is fairly informative; a positive one is not.

Three practical rules. Interpret any positive screen against the setting it was administered in. Expect most positives in unselected populations to be false and plan the follow-up assessment accordingly rather than treating the screen as the finding. And never quote a sensitivity or specificity figure as though it told you the probability that this person has the condition, because it does not; that is the inverse probability and it requires the base rate.

## PHQ-9

What it measures. Depressive symptom severity over the past two weeks, mapped onto the nine DSM criteria for major depressive episode. Developed by Kroenke, Spitzer and Williams (2001). Public domain and free to use.

Structure and scoring. Nine items, each rated 0 (not at all), 1 (several days), 2 (more than half the days), 3 (nearly every day). Total range 0 to 27. A tenth question about functional difficulty is asked but not scored into the total.

Severity bands. 0 to 4 minimal, 5 to 9 mild, 10 to 14 moderate, 15 to 19 moderately severe, 20 to 27 severe.

Psychometrics. The original validation (Kroenke et al., 2001, N = 580, against independent structured mental health professional interview) reported sensitivity 88% and specificity 88% at a cut-point of 10. The individual participant data meta-analysis by Levis et al. (2019, BMJ 365:l1476) found at cut-point 10 a pooled sensitivity of 0.88 (95% CI 0.83 to 0.92) and specificity of 0.85 (95% CI 0.82 to 0.88) against semi-structured interview reference standards across 29 studies and 6,725 participants. Accuracy varied by reference standard: against fully structured interviews sensitivity fell to 0.70 with specificity 0.84, and against the MINI sensitivity was 0.77 with specificity 0.87. This variation is itself informative, since it shows that a substantial part of what looks like test accuracy is a property of what the test is being compared against.

Item 9. The final item asks about thoughts of being better off dead or of self-harm. It is treated differently from the other items: any endorsement counts, regardless of the frequency selected. A positive response requires direct suicide risk assessment by someone competent to conduct one. It is a prompt to ask, not a risk assessment in itself, and it has poor predictive value for suicide as a standalone item.

Misuse to avoid. Reporting a band as a diagnosis. Using the score to make a treatment decision without clinical assessment, particularly at scores near a band boundary. Assuming the somatic items (sleep, appetite, energy, psychomotor) are measuring depression in people with physical illness, where they are confounded. And treating repeated administrations as measuring change without applying a reliable change threshold.

## GAD-7

What it measures. Generalised anxiety symptom severity over the past two weeks. Developed by Spitzer, Kroenke, Williams and Löwe (2006). Public domain.

Structure and scoring. Seven items, each rated 0 to 3 on the same frequency anchors as the PHQ-9. Total range 0 to 21.

Severity bands. 0 to 4 minimal, 5 to 9 mild, 10 to 14 moderate, 15 to 21 severe.

Psychometrics. At a cut-point of 10, the original validation reported sensitivity 89% and specificity 82% for generalised anxiety disorder (Spitzer et al., 2006). [UNVERIFIED against primary text: the original paper is paywalled with no open deposit; these figures were confirmed only through direct quotation in a peer-reviewed secondary source.] Kroenke et al. (2007, Annals of Internal Medicine 146(5):317-25) reported that the GAD-7 and GAD-2 performed well across four anxiety disorders with areas under the curve ranging from 0.80 to 0.91. [UNVERIFIED: the frequently quoted per-disorder sensitivity and specificity pairs for panic disorder, social anxiety disorder, and PTSD could not be confirmed against the primary text.] A meta-analysis by Plummer et al. (2016) across 12 samples and 5,223 participants reported acceptable performance at cut-points 7 to 10 with optimal performance at 8 (sensitivity 0.83, specificity 0.84). [UNVERIFIED: secondary-sourced only.]

The critical caveat. The cut-point of 10 does not transport to psychiatric or high-comorbidity populations. In a specialty outpatient anxiety and mood clinic sample (N = 536), a cut-point of 10 yielded sensitivity 79.5% but specificity of only 44.7%, and no cut-point achieved an acceptable balance, with AUCs of 0.65 to 0.74 (Rutter & Brown, 2016). Kertz et al. (2013) reported a comparable pattern in a psychiatric sample with sensitivity 83% and specificity 46%. The authors concluded the GAD-7 works better as a dimensional severity index in such settings than as a binary screener. This is the clearest available demonstration that a published cut-point belongs to a validation population.

Misuse to avoid. Reading a high GAD-7 as evidence specifically of generalised anxiety disorder; it is elevated across anxiety, depressive, and trauma presentations, and the GAD-7 and PHQ-9 correlate strongly with each other. Using it to screen in a psychiatric population at the primary care cut-point.

## DASS-21

What it measures. Three correlated dimensions of negative emotional state over the past week: Depression, Anxiety, and Stress. Derived from the 42-item DASS by Lovibond and Lovibond (1995). Free for research and clinical use; the manual is purchased.

Structure and scoring. Twenty-one items, seven per subscale, each rated 0 to 3. Subscale scores are summed and then multiplied by 2 so they are comparable to DASS-42 norms. Each subscale therefore ranges 0 to 42 after doubling.

Severity bands, applied to the doubled scores.
Depression: Normal 0 to 9, Mild 10 to 13, Moderate 14 to 20, Severe 21 to 27, Extremely Severe 28 and above.
Anxiety: Normal 0 to 7, Mild 8 to 9, Moderate 10 to 14, Severe 15 to 19, Extremely Severe 20 and above.
Stress: Normal 0 to 14, Mild 15 to 18, Moderate 19 to 25, Severe 26 to 33, Extremely Severe 34 and above.

What the subscales cover. The Depression scale assesses dysphoria, hopelessness, devaluation of life, self-deprecation, lack of interest, anhedonia, and inertia. The Anxiety scale assesses autonomic arousal, skeletal muscle effects, situational anxiety, and subjective anxious affect. The Stress scale assesses chronic non-specific arousal: difficulty relaxing, nervous arousal, being easily upset, irritability, and impatience.

The explicit non-diagnostic statement. The DASS scoring documentation states directly that the instrument is built on a dimensional rather than categorical conception, that differences between normal and clinical populations are differences of degree, and that the DASS-21 therefore "has no direct implications for the allocation of patients to discrete diagnostic categories postulated in classificatory systems such as the DSM and ICD" (DASS-21 scoring instructions, Lovibond & Lovibond, 1995). This is the clearest statement of the screening-versus-diagnosis distinction that any of these instruments makes about itself, and it is routinely ignored by people reporting "severe depression on the DASS".

Misuse to avoid. Treating the Anxiety subscale as a general anxiety measure; it is weighted toward physiological arousal and under-detects worry-dominant presentations, which is why Stress and Anxiety often behave unexpectedly. Forgetting to double the subscale scores, which produces spuriously normal results. Reporting band labels as if they were diagnoses. Note also that the recall window is one week, shorter than the PHQ-9 and GAD-7, so the scales are not interchangeable across timeframes.

## K10

What it measures. Non-specific psychological distress, meaning the anxiety and depressive symptom load that is common across conditions rather than specific to any one. Developed by Kessler and colleagues (Kessler et al., 2002, Psychological Medicine 32(6):959-976). Widely used in Australian services and population surveys.

Structure and scoring. Ten items about frequency of distress symptoms, each rated 1 (none of the time) to 5 (all of the time), with a four-week recall period. Total range 10 to 50.

Interpretation bands. The Australian bands, attributable to Andrews and Slade (2001, Australian and New Zealand Journal of Public Health 25(6):494-497) and used by the Australian Bureau of Statistics, are: Low 10 to 15, Moderate 16 to 21, High 22 to 29, Very High 30 to 50.

A discrepancy worth knowing about. Alternative band systems circulate in clinical software and service documentation, including one that sets the boundaries at 20, 25, and 30. These are not interchangeable with the Andrews and Slade bands and a score can fall in different categories depending on which set is applied. Check which convention a given score was interpreted under before comparing across services. [UNVERIFIED: an alternative 0 to 40 scoring convention, with items scored 0 to 4, is sometimes referenced; no citable source confirming it was located, so treat the 10 to 50 range as the standard and verify the range before interpreting any K10 score.]

Psychometrics and what it is for. The K10's value is as a brief distress screen and a population-level monitoring tool. It performs reasonably at detecting the presence of a common mental disorder and poorly at saying which one, by design, since non-specificity is the construct. A high K10 tells you someone is distressed and warrants assessment. It tells you nothing about whether that distress is depression, anxiety, trauma-related, substance-related, or a response to circumstances.

Misuse to avoid. Using it as a depression measure. Using it as an outcome measure without a reliable change threshold. Using band labels as severity of a disorder rather than severity of distress. And treating "Low" as reassurance in someone reporting suicidal ideation, since distress and risk are different constructs and the K10 does not assess risk at all.

## BDI-II

What it measures. Depressive symptom severity over the past two weeks including today. Developed by Beck, Steer and Brown (1996) as a revision of the original BDI, realigned to DSM-IV criteria.

Structure and scoring. Twenty-one items, each a set of four statements graded 0 to 3 in increasing severity, from which the respondent selects the one that best fits. Total range 0 to 63.

Severity bands. 0 to 13 minimal, 14 to 19 mild, 20 to 28 moderate, 29 to 63 severe.

Copyright status. The BDI-II is proprietary and owned by Pearson. It requires purchase and user qualification, and reproducing the items is copyright infringement. This matters practically: it is the main reason the PHQ-9 has displaced it in routine care, since the PHQ-9 is free, shorter, and directly criterion-mapped.

Psychometrics. Unlike the PHQ-9 and GAD-7, the BDI-II does not have a single canonical screening cut-point with a universally reported sensitivity and specificity pair. The severity bands are the primary interpretive framework, and reported cut-point accuracy varies substantially by the population assessed, particularly in medically ill samples where the somatic items inflate scores. No single figure should be quoted as the BDI-II's sensitivity.

Misuse to avoid. Using it in medically unwell or older populations without accounting for somatic item confounding. Comparing BDI-II scores directly to PHQ-9 scores, which is a different scale with a different range and different bands. Reproducing the items.

## PCL-5

What it measures. The severity of the 20 DSM-5 PTSD symptoms. Maintained by the US Department of Veterans Affairs National Center for PTSD and freely available to clinicians and researchers.

Structure and scoring. Twenty items, each rated 0 (not at all) to 4 (extremely), with a past-month default recall period; past-week and extended versions with Criterion A assessment exist. Total range 0 to 80.

Two interpretation methods, which the VA presents side by side rather than preferring one.

Cut-point method. The VA states that initial research suggests a cut-point between 31 and 33 is indicative of probable PTSD across samples, with the explicit guidance that a lower cut-point should be considered when screening or when maximising detection is desirable, and a higher cut-point when attempting a provisional diagnosis or minimising false positives. The underlying study is Bovin et al. (2016, Psychological Assessment 28(11):1379-1391), which examined two veteran samples (N = 468) against the CAPS-5 and found 31 to 33 optimally efficient, reporting kappa of 0.58. [UNVERIFIED: exact sensitivity and specificity percentages at the 31 to 33 cut-point could not be confirmed against the primary text; secondary sources report inconsistent figures. Do not quote a specific sensitivity or specificity for this cut-point.]

DSM-5 symptom cluster method. Treat each item rated 2 (moderately) or higher as endorsed, then require at least one Criterion B item (questions 1 to 5), one C item (6 to 7), two D items (8 to 14), and two E items (15 to 20).

Change interpretation. The VA suggests 10 points as an indicator of response, and a post-treatment score below 28 as an indicator of clinically significant change, citing Marx et al. (2022, Psychological Assessment 34(2):197-203). That study was conducted in male veterans, so the thresholds carry the population caveat that applies to every other number in this file.

Misuse to avoid. Treating a score above 33 as a PTSD diagnosis; the reference standard remains a structured clinical interview, the CAPS-5. Administering it without establishing a Criterion A event, since the items ask about responses to a specific stressful experience and are uninterpretable without one. Using it to screen general populations, where PPV will be low. And administering it in a text conversation as a way of extracting a trauma narrative, which risks destabilising the person with no containment available.

## AUDIT and AUDIT-C

AUDIT. The Alcohol Use Disorders Identification Test, developed by the WHO (Babor, Higgins-Biddle, Saunders & Monteiro, 2nd edition, 2001). Ten items: three on consumption, three on dependence symptoms, four on alcohol-related problems. Items 1 to 8 are scored 0 to 4 and items 9 to 10 are scored 0, 2, or 4. Total range 0 to 40.

Risk zones from the WHO manual, which map to actions rather than to diagnoses. Zone I, 0 to 7: alcohol education. Zone II, 8 to 15: simple advice. Zone III, 16 to 19: simple advice plus brief counselling and continued monitoring. Zone IV, 20 to 40: referral to a specialist for diagnostic evaluation.

Psychometrics. The manual states that at the recommended cut-off of 8, most studies have found very favourable sensitivity and usually lower but still acceptable specificity. In the original multinational development sample (Saunders et al., 1993), sensitivities were generally in the mid-0.90s and specificities averaged in the 0.80s. A cut-off of 10 trades sensitivity for greater specificity.

Population adjustment. The manual states that setting the cut-off one point lower, at 7, for all women and for men over 65 will increase sensitivity in those groups. One cited study of elderly hospital patients found low sensitivity and high specificity above age 65 at the standard cut-off.

AUDIT-C. The first three consumption items, used as a very brief screen. Range 0 to 12.

Cut-point attribution, which is commonly reported wrongly. Bush, Kivlahan, McDonell et al. (1998, Archives of Internal Medicine 158(16):1789-1795) validated the AUDIT-C in a male-only VA outpatient sample (n = 243 analysed, mean age 67; the six women in the sample were excluded from the analytic set). At a cut-off of 4 or above for the composite outcome of heavy drinking and/or active alcohol abuse or dependence, sensitivity was 86% and specificity 72%. Because that sample was entirely male, Bush et al. could not have established a cut-point for women. The commonly cited gender-specific pair comes from Bradley, DeBenedetti, Volk, Williams, Frank and Kivlahan (2007, Alcoholism: Clinical and Experimental Research 31(7):1208-1217), in a mixed-gender family practice sample (392 men, 927 women): men at 4 or above, sensitivity 0.86 and specificity 0.89; women at 3 or above, sensitivity 0.73 and specificity 0.91; AUROC 0.94 for men and 0.90 for women. Attribute the 4-for-men and 3-for-women pair to Bradley 2007, not Bush 1998. [UNVERIFIED: the Bradley score-band tables mapping AUDIT-C ranges to probability of past-year dependence could not be confirmed against the primary paper.]

Misuse to avoid. Reading a positive AUDIT-C as a diagnosis of alcohol use disorder, which it is not; it identifies drinking above a risk threshold. Applying the male cut-point to women. Assuming a low score rules out a problem in a context where the person has a reason to under-report, such as employment or custody assessment, since alcohol screens are among the most susceptible to social desirability effects.

## ASRS v1.1

What it measures. Adult ADHD symptoms, mapped to DSM-IV criteria. Developed with the World Health Organization. Freely available.

Structure and scoring. The full instrument has 18 items. Part A is a six-item screener, which is the part most commonly used. Scoring uses per-item thresholds rather than a simple sum: for questions 1 to 3, a response of "sometimes" or higher counts as positive; for questions 4 to 6, only "often" or higher counts. Four or more positive items on Part A is a positive screen warranting further evaluation. [The scoring rule is taken from a widely reproduced version of the official instructions; the primary Harvard-hosted document was not directly accessible for confirmation.]

Psychometrics. Kessler et al. (2005, Psychological Medicine) validated it in an NCS-R clinical reappraisal subsample (n = 154, oversampled for childhood ADHD and adult persistence). The six-item Part A screener achieved sensitivity 68.7%, specificity 99.5%, total classification accuracy 97.9%, and kappa 0.76. The full 18-item version performed worse as a classifier: sensitivity 56.3%, specificity 98.3%, accuracy 96.2%, kappa 0.58. Kessler et al. (2007, International Journal of Methods in Psychiatric Research 16(2):52-65) replicated in a representative health plan sample and reported an AUC of 0.90, but did not report sensitivity and specificity, so the 68.7% and 99.5% figures belong specifically to the 2005 paper.

Note the shape of those numbers. Specificity is very high and sensitivity is moderate, which is unusual for a screener and means the ASRS Part A misses roughly a third of cases while rarely producing false positives in that validation sample. That trade-off inverts in low-prevalence unselected populations and in self-selected populations seeking assessment.

A separate instrument. A DSM-5-updated ASRS exists (Üstün et al., 2017, JAMA Psychiatry) with different properties, reported sensitivity around 91% and more variable specificity of 74% to 96%. It is a different revision and its numbers should not be attached to the v1.1 screener.

Misuse to avoid. Treating a positive Part A as an ADHD diagnosis. Adult ADHD diagnosis requires evidence of childhood-onset symptoms, impairment in more than one setting, and exclusion of alternative explanations including anxiety, depression, trauma, sleep disorder, and substance use, all of which produce inattention. Self-administered ASRS results from people who have already concluded they have ADHD carry substantial expectancy effects.

## AQ-10

What it measures. A brief screen for autistic traits, abbreviated from the 50-item Autism Spectrum Quotient. Developed by Allison, Auyeung and Baron-Cohen (2012, Journal of the American Academy of Child and Adolescent Psychiatry 51(2):202-212).

Structure and scoring. Ten items, one point per item scored in the autism-consistent direction. Range 0 to 10. The adult cut-point is 6 or above.

Psychometrics as originally reported. At a cut-point of 6 or above, sensitivity 0.88, specificity 0.91, positive predictive value 0.85 (Allison et al., 2012).

Psychometrics in clinical populations, which are much worse. Ashwood et al. (2016, Psychological Medicine 46(12):2595-2604) studied 476 adults seen consecutively at a national ASD diagnostic referral service, of whom 73% received a clinical diagnosis of ASD against expert ICD-10 assessment informed by ADOS-G and ADI-R. Self-report AQ scores did not significantly predict receipt of a diagnosis. Sensitivity was 0.77 (95% CI 0.72 to 0.82) and PPV 0.76 (95% CI 0.70 to 0.80), but specificity was only 0.29. Important scope note: this study used the full self-report Autism-Spectrum Quotient, not the 10-item AQ-10, so it is evidence about the AQ family in clinical referral samples rather than about the AQ-10 specifically. Bezemer, Blijd-Hoogewys and Meek-Heekelaar (2021, Journal of Autism and Developmental Disorders 51(7):2402-2415) evaluated adults referred for autism assessment in clinical practice and concluded that predictive values were considerably lower in this clinical population than in general population research, and that psychometric results in the core publications appear less representative of clinical practice. [UNVERIFIED: exact sensitivity, specificity and PPV figures from this study were not available in the accessible abstract.]

[UNVERIFIED: NICE guidance. Secondary sources consistently report that NICE CG142 recommends the AQ-10 as a screening tool for adults where autism is suspected, but the primary NICE text could not be accessed to confirm the wording.]

Misuse to avoid. This is the instrument in this file with the widest gap between its published properties and its behaviour in the setting it is actually used in. A score below 6 should not be used to rule out autism in someone referred for assessment. A score of 6 or above in a self-referring population is weak evidence. Autism assessment requires developmental history, ideally informant history, and multi-domain assessment; the AQ-10 is a triage tool at best.

## MDQ

What it measures. A screen for lifetime history of manic or hypomanic symptoms, used to detect bipolar spectrum disorder in people presenting with depression. Developed by Hirschfeld et al. (2000, American Journal of Psychiatry).

Structure and scoring. Thirteen yes/no items about manic and hypomanic symptoms, plus a question about whether several of the endorsed symptoms co-occurred in the same time period, plus a question about the degree of functional problems caused. A positive screen requires all three: seven or more "yes" responses, plus co-occurrence, plus at least moderate functional impairment.

Psychometrics, and the reason this instrument is the best base-rate lesson in this file. In the original validation of 198 psychiatric outpatients across five mood disorder clinics, sensitivity was 0.73 and specificity 0.90 (Hirschfeld et al., 2000). In a general population study of 711 respondents drawn from 85,358 sampled, with 695 completing telephone SCID-based interviews, sensitivity fell to 0.281 with specificity 0.972 (Hirschfeld et al., 2003, American Journal of Psychiatry 160(1):178-180). Sensitivity dropped from 0.73 to 0.28 moving from a clinical to a community sample. The same instrument, the same scoring rule, and it detects roughly a quarter of cases instead of three quarters.

The false positive problem. Zimmerman et al. (2010, Journal of Clinical Psychiatry) assessed 480 psychiatric outpatients and found borderline personality disorder diagnosed four times more often in MDQ-positive than MDQ-negative patients (21.5% versus 4.1%). Among MDQ-positive patients, roughly as many received a borderline personality disorder diagnosis (27.6%) as a bipolar diagnosis (23.5%). Their conclusion was that positive results on the MDQ were as likely to indicate borderline personality disorder as bipolar disorder.

Misuse to avoid. Treating a positive MDQ as evidence of bipolar disorder, which the Zimmerman finding directly contradicts. Treating a negative MDQ as ruling out bipolarity, which in community settings it emphatically does not. Using it to justify a mood stabiliser or to withhold an antidepressant. The MDQ's legitimate use is prompting a careful clinical enquiry into past elevated mood, which then has to be conducted properly, ideally with collateral history, since hypomania is the symptom people are least able to report retrospectively about themselves.

## WHODAS 2.0

What it measures. Functioning and disability, independent of diagnosis, grounded in the WHO's International Classification of Functioning, Disability and Health. This makes it different in kind from every other instrument in this file: it measures what the person can do rather than what symptoms they have.

Domains. Six: cognition (understanding and communicating), mobility (moving and getting around), self-care, getting along with others, life activities (domestic, leisure, work, school), and participation in society.

Structure. A 36-item version taking roughly 20 minutes and giving domain-level scores, and a 12-item version taking about 5 minutes which accounts for 81% of the variance in the longer version. A 12+24 configuration also exists. Self-administered, interviewer-administered, and proxy versions are available. The recall period is the past 30 days, chosen because recall accuracy is best over about a month.

Scoring. Items are rated none (0), mild (1), moderate (2), severe (3), extreme or cannot do (4). Simple scoring sums the item scores without weighting, which is practical for hand scoring. Complex scoring uses an item response theory algorithm that differentially weights items and severity levels, producing a summary score converted to a 0 to 100 metric where 0 is no disability and 100 is full disability. The two methods do not produce the same number and should not be compared.

Why it matters clinically. Symptom severity and functional impairment dissociate. Two people with identical PHQ-9 scores can differ enormously in what they are able to do, and functioning is usually what the person actually cares about and what determines eligibility for support. DSM-5 included the WHODAS 2.0 as its recommended disability measure partly for this reason.

Misuse to avoid. Comparing simple-scored and IRT-scored results. Assuming the domains are equally relevant to everyone, since mobility and self-care items have limited range in physically well adults and can flatten the profile. Treating a low disability score as evidence that a mental health problem is not serious, since many people maintain function at high cost.

## ORS and SRS

What they are. The Outcome Rating Scale and Session Rating Scale, developed by Miller and Duncan, designed for routine session-by-session measurement rather than for diagnosis. They are the most widely used instruments in feedback-informed treatment.

ORS structure. Four items presented as 10cm visual analogue lines, covering personal or symptom distress, interpersonal wellbeing, social role functioning, and overall wellbeing. Each line scores 0 to 10 by measured position, giving a total range of 0 to 40, where higher means better functioning. This is the opposite direction to every symptom scale in this file, and mixing the directions up is a common error.

ORS interpretation. The adult clinical cut-off is 25. Scores of 25 or below fall in the clinical range. Reported normative data place non-clinical samples around 28.0 and clinical samples around 19.6. The reliable change index is commonly reported as 5 or 6 points depending on the normative sample used. Change that both meets the reliable change threshold and crosses the clinical cut-off of 25 is treated as clinically significant change, following the Jacobson and Truax framework.

ORS reliability. Internal consistency is high, with reported coefficient alpha estimates of .93 and .97. Test-retest reliability estimates vary widely across studies, reported in ranges of .58 to .66 and .80 to .84.

SRS structure and interpretation. Four items on the therapeutic alliance, covering the relationship, goals and topics, approach or method, and overall fit, in the same visual analogue format, total range 0 to 40. The cut-off is 36 out of 40. Scores below 36 are the signal to discuss the alliance.

The SRS ceiling problem. A cut-off of 36 out of 40 exists because almost everyone scores high. Reported figures suggest around a quarter of cases fall below 36. This is a severe ceiling effect and it reflects demand characteristics: the client is rating their therapist, to their therapist's face, in a relationship they depend on. The SRS should be read as a prompt for a conversation, not as a measurement of alliance quality, and a perfect score is close to uninformative.

Misuse to avoid. Treating a four-item visual analogue scale as a precise measure. Using the ORS as a symptom measure, which it is not; it measures subjective wellbeing across four broad domains. Interpreting single-session movement, which is well inside measurement error. And using aggregate ORS improvement to demonstrate that a service works, since routine outcome data selected on high baseline distress is exactly the setup that generates regression to the mean.

## Choosing and sequencing measures

Instruments answer specific questions and the first decision is which question is being asked.

To detect something that may be present but unmentioned, use a sensitive screener and accept false positives: PHQ-9 and GAD-7 for common mental disorders, AUDIT-C for alcohol, MDQ for past hypomania in a depressed presentation with the caveats above.

To grade severity of something already established and track it, use a dimensional measure with known change properties: PHQ-9, GAD-7, DASS-21, PCL-5, or ORS, applied repeatedly with a reliable change threshold.

To capture what the problem is costing the person, use a functioning measure: WHODAS 2.0. Symptom scales do not answer this.

To decide something diagnostically, use a structured interview and clinical assessment. No questionnaire in this file does this job.

Sequencing rules. Screen broadly before narrowing, because a person presenting with anxiety frequently has depression, trauma, or substance involvement that a single-target instrument will not surface. Screen for bipolarity before treating depression, because the treatment implications diverge. Screen for substances always, because they change every other interpretation. Establish a baseline before starting treatment, and use at least two baseline points where the situation allows, since a single pre-treatment score taken at the point of maximum distress guarantees apparent improvement.

Administration rules that preserve the properties. Use the actual items in their actual wording. Use the specified response options and recall window. Let the person do their own rating on self-report instruments. Record which version and which scoring convention was used, particularly for the K10 and WHODAS where multiple conventions exist. Record the setting, since the setting determines the base rate and therefore what a positive result means.

The stopping rule. Adding more questionnaires does not add information proportionally, because these instruments correlate strongly with each other. The PHQ-9, GAD-7, DASS subscales, and K10 all load heavily on a general distress factor, so administering all four mostly measures the same thing four times while increasing burden. Two well-chosen measures plus a functioning measure is usually more informative than six symptom scales.

## Sources

- Kroenke, K., Spitzer, R. L., & Williams, J. B. W. (2001). The PHQ-9: validity of a brief depression severity measure. *Journal of General Internal Medicine*, 16(9), 606-613. https://onlinelibrary.wiley.com/doi/full/10.1046/j.1525-1497.2001.016009606.x
- Levis, B., Benedetti, A., & Thombs, B. D. (2019). Accuracy of Patient Health Questionnaire-9 (PHQ-9) for screening to detect major depression: individual participant data meta-analysis. *BMJ*, 365, l1476. https://pmc.ncbi.nlm.nih.gov/articles/PMC6454318/
- National HIV Curriculum. PHQ-9 bands and item 9 guidance. https://www.hiv.uw.edu/page/mental-health-screening/phq-9
- Spitzer, R. L., Kroenke, K., Williams, J. B. W., & Löwe, B. (2006). A brief measure for assessing generalized anxiety disorder: the GAD-7. *Archives of Internal Medicine*, 166(10), 1092-1097. https://pubmed.ncbi.nlm.nih.gov/16717171/
- Kroenke, K., Spitzer, R. L., Williams, J. B. W., Monahan, P. O., & Löwe, B. (2007). Anxiety disorders in primary care: prevalence, impairment, comorbidity, and detection. *Annals of Internal Medicine*, 146(5), 317-325. https://pubmed.ncbi.nlm.nih.gov/17339617/
- Rutter, L. A., & Brown, T. A. (2016). Psychometric properties of the GAD-7 in outpatients with anxiety and mood disorders. *Journal of Psychopathology and Behavioral Assessment*. https://doi.org/10.1007/s10862-016-9571-9
- Lovibond, S. H., & Lovibond, P. F. (1995). *Manual for the Depression Anxiety Stress Scales* (2nd ed.). Sydney: Psychology Foundation. Official site: https://www2.psy.unsw.edu.au/dass/ and FAQ: https://www2.psy.unsw.edu.au/dass/DASSFAQ.htm
- DASS-21 form and scoring instructions including the severity table. https://maic.qld.gov.au/wp-content/uploads/2016/07/DASS-21.pdf
- Kessler, R. C., et al. (2002). Short screening scales to monitor population prevalences and trends in non-specific psychological distress. *Psychological Medicine*, 32(6), 959-976. https://pubmed.ncbi.nlm.nih.gov/12214795/
- Andrews, G., & Slade, T. (2001). Interpreting scores on the Kessler Psychological Distress Scale (K10). *Australian and New Zealand Journal of Public Health*, 25(6), 494-497. https://pubmed.ncbi.nlm.nih.gov/11824981/ K10 scoring and interpretation: https://comorbidityguidelines.org.au/appendix-m-kessler-psychological-distress-scale-k10/k10-scoring-and-interpretation
- Beck, A. T., Steer, R. A., & Brown, G. K. (1996). *Beck Depression Inventory-II*. Pearson. https://www.nctsn.org/measures/beck-depression-inventory-second-edition
- Bovin, M. J., et al. (2016). Psychometric properties of the PTSD Checklist for DSM-5 (PCL-5) in veterans. *Psychological Assessment*, 28(11), 1379-1391. https://pubmed.ncbi.nlm.nih.gov/26653052/
- US Department of Veterans Affairs, National Center for PTSD. PCL-5 scoring, cut-points and change thresholds. https://www.ptsd.va.gov/professional/assessment/adult-sr/ptsd-checklist.asp
- Babor, T. F., Higgins-Biddle, J. C., Saunders, J. B., & Monteiro, M. G. (2001). *AUDIT: The Alcohol Use Disorders Identification Test, Guidelines for Use in Primary Care* (2nd ed.). WHO. https://www.paho.org/sites/default/files/Auditmanual_ENG.pdf
- Bush, K., Kivlahan, D. R., McDonell, M. B., et al. (1998). The AUDIT alcohol consumption questions (AUDIT-C). *Archives of Internal Medicine*, 158(16), 1789-1795. https://pubmed.ncbi.nlm.nih.gov/9738608/
- Bradley, K. A., DeBenedetti, A. F., Volk, R. J., Williams, E. C., Frank, D., & Kivlahan, D. R. (2007). AUDIT-C as a brief screen for alcohol misuse in primary care. *Alcoholism: Clinical and Experimental Research*, 31(7), 1208-1217. https://pubmed.ncbi.nlm.nih.gov/17451397/
- Kessler, R. C., et al. (2005). The World Health Organization Adult ADHD Self-Report Scale (ASRS): a short screening scale for use in the general population. *Psychological Medicine*. https://pubmed.ncbi.nlm.nih.gov/15841682/
- Kessler, R. C., et al. (2007). Validity of the WHO Adult ADHD Self-Report Scale (ASRS) Screener. *International Journal of Methods in Psychiatric Research*, 16(2), 52-65. https://pubmed.ncbi.nlm.nih.gov/17623385/
- Allison, C., Auyeung, B., & Baron-Cohen, S. (2012). Toward brief "red flags" for autism screening: the Short Autism Spectrum Quotient and the Short Quantitative Checklist for Autism in toddlers. *Journal of the American Academy of Child and Adolescent Psychiatry*, 51(2), 202-212.e7. https://pubmed.ncbi.nlm.nih.gov/22265366/
- Ashwood, K. L., et al. (2016). Predicting the diagnosis of autism in adults using the Autism-Spectrum Quotient (AQ) questionnaire. *Psychological Medicine*, 46(12), 2595-2604. https://pubmed.ncbi.nlm.nih.gov/27353452/
- Bezemer, M. L., Blijd-Hoogewys, E. M. A., & Meek-Heekelaar, M. (2021). The Predictive Value of the AQ and the SRS-A in the Diagnosis of ASD in Adults in Clinical Practice. *Journal of Autism and Developmental Disorders*, 51(7), 2402-2415. https://pubmed.ncbi.nlm.nih.gov/33001348/
- Hirschfeld, R. M. A., et al. (2000). Development and validation of a screening instrument for bipolar spectrum disorder: the Mood Disorder Questionnaire. *American Journal of Psychiatry*, 157(11), 1873-1875. https://pubmed.ncbi.nlm.nih.gov/11058490/
- Hirschfeld, R. M. A., et al. (2003). Validity of the Mood Disorder Questionnaire: a general population study. *American Journal of Psychiatry*, 160(1), 178-180. https://pubmed.ncbi.nlm.nih.gov/12505821/
- Zimmerman, M., et al. (2010). Screening for bipolar disorder and finding borderline personality disorder. *Journal of Clinical Psychiatry*, 71(9), 1212-1217. https://pubmed.ncbi.nlm.nih.gov/20361913/
- Marx, B. P., Lee, D. J., Norman, S. B., et al. (2022). Reliable and clinically significant change in the Clinician-Administered PTSD Scale for DSM-5 and PTSD Checklist for DSM-5 among male veterans. *Psychological Assessment*, 34(2), 197-203. https://pubmed.ncbi.nlm.nih.gov/34941354/
- Saunders, J. B., Aasland, O. G., Babor, T. F., et al. (1993). Development of the Alcohol Use Disorders Identification Test (AUDIT). *Addiction*, 88(6), 791-804. https://pubmed.ncbi.nlm.nih.gov/8329970/
- World Health Organization. WHO Disability Assessment Schedule 2.0 (WHODAS 2.0). https://www.who.int/standards/classifications/international-classification-of-functioning-disability-and-health/who-disability-assessment-schedule
- American Psychiatric Association. WHODAS 2.0 self-administered version (DSM-5 online assessment measures). https://www.psychiatry.org/File%20Library/Psychiatrists/Practice/DSM/APA_DSM5_WHODAS-2-Self-Administered.pdf
- CORC. Outcome Rating Scale (ORS) and Child Outcome Rating Scale (CORS). https://www.corc.uk.net/outcome-measures-guidance/directory-of-outcome-measures/outcome-rating-scale-ors-child-outcome-rating-scale-cors/
- Low, D. The Outcome Rating Scales (ORS) and Session Rating Scale (SRS). CORC. https://www.corc.uk.net/media/2754/ors-srs-david-low-paper-for-cyp-iapt.pdf
- National Institute of Mental Health. Major Depression statistics (2021 NSDUH). https://www.nimh.nih.gov/health/statistics/major-depression
