---
title: Interpreting Measurement: Reliability, Error, Change, and Bias
section: assessment
tags: [psychometrics, reliability, validity, standard-error-of-measurement, reliable-change-index, clinical-significance, regression-to-the-mean, measurement-invariance, response-bias, cultural-bias, assessment-limits]
summary: How to reason about a psychological test score, including the error around it, what counts as real change, why an instrument validated in one population can fail in another, and why inferring a score from free text is not administration of the instrument.
---

## Reliability: what it is and what it constrains

Reliability is the proportion of variance in observed scores that reflects true score variance rather than measurement error. It is a property of scores in a population, not a fixed property of a test. The same instrument can be reliable in one sample and unreliable in another, which is why reporting "the scale has an alpha of .90" without naming the sample is incomplete.

Several distinct things are called reliability and they are not interchangeable.

Internal consistency, usually reported as Cronbach's alpha or McDonald's omega, indexes how far items on a scale covary. It answers whether the items are measuring something in common. It does not establish that they measure one thing, and a high alpha is routinely misread as evidence of unidimensionality. Alpha rises with the number of items, so a long scale can post a high alpha while being multidimensional.

Test-retest reliability indexes stability of scores across time in the absence of real change. It matters most for traits and least for states. A depression measure with a two-week recall window should not have high test-retest reliability across six months if the depression is changing, so a low correlation there is not necessarily a defect.

Inter-rater reliability indexes agreement between raters, usually as kappa or an intraclass correlation. It applies to clinician-rated instruments and to diagnostic interviews. Diagnostic agreement is not uniform across the diagnostic system. In one validation of the MINI against the SCID-5-CV, kappa was 0.88 for psychotic disorders and 0.85 for bipolar disorder but 0.44 for generalised anxiety disorder and 0.32 for PTSD, meaning that agreement on some categories is close to chance-corrected marginal.

The practical consequence of reliability is that it caps validity. A score that is substantially error cannot correlate strongly with anything real. It also determines the width of the uncertainty band around an individual score, which is the next section. The single most common misuse of reliability is reporting it at the group level and then interpreting an individual score as if it were exact.

## Standard error of measurement and the band around a score

A test score is a point estimate of an unobservable true score. The standard error of measurement (SEM) quantifies how far the observed score is likely to sit from the true score, and it is expressed in the units of the test, which makes it directly usable.

The formula is SEM = SD × √(1 − r), where SD is the standard deviation of scores in the relevant population and r is the reliability coefficient (National Council on Measurement in Education, Module 9). Reliability and SEM move in opposite directions: as reliability approaches 1, SEM approaches 0; as reliability falls, the band widens.

Treating measurement error as approximately normally distributed, a confidence interval around an observed score is the score plus or minus a multiple of the SEM: roughly ±1 SEM for about 68% confidence, ±1.96 SEM for 95%, and ±2.58 SEM for 99%.

Worked example. A cognitive test with a mean of 100, an SD of 15, and a reliability of .96 has an SEM of 15 × √(1 − .96) = 15 × 0.2 = 3. A person scoring 100 has a 95% interval of roughly 94 to 106. A second person scoring 106 has an interval of roughly 100 to 112. These two people are not reliably different from each other, and reporting them as "average" and "above average" overstates what the test can support.

The same logic applies to symptom scales. Any instrument with reliability below about .90 has a band wide enough to cross its own severity boundaries. If a depression scale has an SD of 6 and reliability of .85, SEM = 6 × √0.15 ≈ 2.3, so the 95% band on any score is about ±4.5 points. A score of 14 on such a scale cannot be confidently distinguished from a score of 10 or a score of 18, and if 10 and 15 are the boundaries of a severity band, a single score near a boundary carries almost no information about which band the person belongs in.

Two rules follow. Never treat a score as a number that means something exact. And never make a categorical decision on the basis of a score sitting one or two points either side of a cut-point, because the cut-point is a convention imposed on a continuum and the score has error in it. Clinicians who say "you scored 10, so you have moderate depression" are misreporting the measurement.

This applies with particular force in text-only contexts, where the SEM of the underlying instrument is not even the relevant quantity, because the instrument was not administered.

## Reliable change and clinically significant change

A score changing between two time points does not mean anything has changed. The observed difference contains measurement error at both time points, and the error compounds.

The Reliable Change Index (RCI) is the standard correction. Jacobson and Truax (1991) defined it as the difference between pre-treatment and post-treatment scores divided by the standard error of the difference between the two scores. The standard error of the difference is S_diff = SD₁ × √2 × √(1 − r), where SD₁ is the standard deviation at baseline and r is the reliability of the instrument. The RCI is interpreted as a z score: values above 1.96 indicate reliable improvement, values below −1.96 indicate reliable deterioration, and values between the two indicate no reliable change.

Note the √2 term. The error band on a change score is about 1.41 times wider than the error band on a single score, because both measurements carry error. This is why a small pre-post difference is uninformative even when it looks meaningful on a chart.

Reliable change alone is not clinical significance. Jacobson and Truax paired the RCI with a cut-off separating a functional from a dysfunctional distribution, producing four outcome categories: recovered (reliable change and crossed into the functional range), improved (reliable change but still in the dysfunctional range), unchanged (no reliable change), and deteriorated (reliable change in the wrong direction). Reporting only mean group change hides how many people fall in each category, and a treatment producing a moderate mean improvement can contain a substantial deteriorated subgroup.

Published RCI values exist for common instruments. For the Outcome Rating Scale, the adult clinical cut-off is 25 and the reliable change index is commonly reported as 5 or 6 points depending on the normative sample used, with change that both meets the RCI and crosses 25 treated as clinically significant. For the PCL-5, the VA's National Center for PTSD suggests 10 points as an indicator of response and a post-treatment score below 28 as an indicator of clinically significant change, citing Marx et al. (2022, Psychological Assessment 34(2):197-203), a study conducted in male veterans.

The general principle is that any claim about change needs to specify which of three questions it answers: did the score move, did it move more than measurement error, and did the person's clinical status change. These are increasingly demanding and increasingly informative.

## Regression to the mean

Regression to the mean is a statistical artefact that generates false evidence of treatment effect, and it operates most strongly in exactly the situation clinical services find themselves in.

Whenever a measure is imperfectly reliable, extreme scores are extreme partly because of real standing on the construct and partly because of error. On re-measurement, the real component persists and the error component resamples, so the expected second score is closer to the population mean than the first. The effect is proportional to unreliability: a perfectly reliable measure shows none, and a measure that is entirely noise regresses fully to the mean.

The clinical setup that maximises this artefact is selection on an extreme score. People enter treatment when they are at their worst, often crossing a threshold on a screening measure to be admitted. Their baseline score is therefore selected for being high, which means it is selected for having positive error. The expected follow-up score is lower whatever the treatment does. A single-arm pre-post design in a service that admits on the basis of a high score will show improvement even if the treatment is inert.

Three consequences follow. First, uncontrolled pre-post outcome data from routine services systematically overstate treatment effect and cannot be used to establish that a treatment works. Second, the magnitude of the artefact is larger for less reliable measures and for more extreme selection thresholds. Third, the same logic applies within a single case: a person presenting on their worst day will usually report feeling somewhat better at the next contact, and attributing that to the intervening session is unwarranted.

The corrections are a control group, or in a single case a baseline period with repeated measurement before intervention rather than a single pre-treatment point. Where neither is available, the honest statement is that the direction of change is consistent with improvement but does not establish it.

Regression to the mean also explains a family of clinical superstitions. Any intervention applied at the point of maximum distress will appear to help, which is why practices with no active mechanism accumulate confident practitioners.

## Statistical significance versus clinical significance

These answer different questions and neither substitutes for the other.

Statistical significance answers whether an observed difference is larger than would be expected from sampling variability under a null hypothesis. It is heavily determined by sample size. With a large enough sample, a difference of half a point on a 27-point scale reaches p < .001. That p value says the difference is probably not zero. It says nothing about whether it is worth anything.

Clinical significance answers whether the difference matters to the person. It is assessed with effect sizes, with the reliable change and recovery categories described above, and with anchors based on patient report, such as the minimal clinically important difference (MCID), which is the smallest change a person can detect as beneficial.

The two dissociate in both directions. A large trial can produce a statistically significant benefit too small for any individual to notice. A small trial can fail to reach significance while containing a large effect that is simply underpowered, and reporting that as "no difference" is a misreading; absence of evidence of an effect is not evidence of absence.

Two further distinctions matter when reading outcome literature. Mean group change is not individual change: a mean improvement of 6 points is compatible with half the sample improving 12 points and half not moving. And between-group differences at endpoint are the relevant comparison in a controlled trial, not within-group change from baseline, because within-group change absorbs regression to the mean, natural remission, and expectancy.

Effect sizes have their own trap. Cohen's benchmarks of 0.2, 0.5, and 0.8 for small, medium, and large were offered as rough conventions in the absence of better information, not as a scale of clinical value. In psychotherapy research, where typical effects cluster in the medium range, the benchmark contributes little. A standardised mean difference should be translated back into the units of the instrument and then into a description of what the person can now do.

## Measurement invariance

Measurement invariance is the property that an instrument measures the same construct, in the same metric, across groups. Without it, comparing scores across groups compares two different things.

Invariance is tested in a hierarchy. Configural invariance holds when the number of factors and the pattern of loadings is the same across groups, meaning the same broad structure applies. Metric invariance additionally requires the factor loadings to be equal across groups, meaning a one-unit change in the latent construct produces the same change in item responses in each group; this licenses comparing associations and regression slopes. Scalar invariance additionally requires equal intercepts, meaning that at the same level of the latent construct the groups give the same item responses; this is what licenses comparing group means. Scalar or at least partial scalar invariance is a prerequisite for comparing latent means between groups.

The failure mode is concrete. Suppose an item on a depression scale asks about crying. If one cultural group reports crying at a lower threshold of distress than another, the intercept for that item differs, and at identical true depression severity the two groups produce different total scores. Comparing raw totals then produces a spurious group difference in depression that is actually a difference in item functioning. This is the same phenomenon known in the item response theory literature as differential item functioning.

Non-invariance arises from translation, from culture, from age, from clinical versus community setting, and from mode of administration. Somatic items on depression scales are a recurring source of it, because they conflate depression with physical illness in medically unwell and older populations. Items referencing work or study misfire for people not in either.

The practical rule for interpreting any score is to ask who the instrument was validated on and whether this person resembles them. An instrument developed and normed on US undergraduates or on treatment-seeking adults in high-income health systems has not been shown to behave the same way elsewhere. The score is not invalid, but its relationship to the underlying construct and to any published cut-point is unestablished, and cut-points in particular are the least transportable part of an instrument because they depend on both item functioning and local base rates.

## Response bias and social desirability

Self-report instruments measure what the person reports, which is not the same as what is true. The gap has structure and the structure is predictable.

Social desirability is the tendency to answer in a way that presents the self favourably. It operates both as impression management, which is deliberate, and as self-deceptive enhancement, which is not. It suppresses reported symptoms and it is strongest where the answer has consequences. Assessments attached to employment, custody, immigration, fitness to practise, insurance, or firearms licensing are systematically under-reported, and treating a low score in those contexts as reassurance is a serious error.

Symptom exaggeration operates in the opposite direction and is likewise driven by context, most obviously in medicolegal, disability, and compensation settings. Neither direction should be assumed as a default; both should be considered as a function of what the person stands to gain or lose.

Acquiescence is the tendency to agree with items regardless of content. It inflates scores on scales where all items are keyed in the same direction, and it is more pronounced in people with lower literacy, in people answering in a second language, and in cultures with stronger norms against disagreeing with an interlocutor. Reverse-keyed items partially control it and introduce their own problem, because a proportion of respondents miss the reversal.

Extreme and midpoint responding are stylistic tendencies to use the ends or the centre of a scale, and they vary systematically across cultural groups. This produces group differences in scores that have nothing to do with the construct.

Recall bias affects any item with a retrospective window. Current mood colours recall of past mood, so a person who is currently low reports the last two weeks as worse than a contemporaneous diary would show. This inflates apparent severity at intake and contributes to apparent improvement later.

Demand characteristics operate in clinical relationships. A person who likes their therapist and wants to be a good patient reports improvement. This is a specific problem for session-by-session outcome measures administered by the treating clinician, and it is the main reason to be cautious with alliance measures like the SRS, which show strong ceiling effects.

The corrections available are limited. Establishing that the answers have no consequences where that is true, asking about behaviour rather than about self-assessment, seeking collateral report, and using multiple methods rather than multiple self-report questionnaires. In a text-only context the correction set is smaller still: there is no collateral, no observation, and no behavioural sample, so response bias is uncorrectable and must be treated as a permanent limit on the inference.

## Cultural and linguistic bias in assessment

Bias in assessment is not confined to the instrument. It enters at the level of the construct, the item, the administration, the norm, and the interpretation.

Construct bias occurs when the underlying construct is not equivalent across groups. Depression as operationalised in DSM-based instruments emphasises mood and cognitive symptoms, and idioms of distress in many populations are predominantly somatic or relational. An instrument that indexes the construct as defined in one tradition will under-detect distress expressed in another, and it will do so invisibly, since the output is still a plausible-looking number.

Item bias is differential item functioning as described above. Translation is a frequent source. A translated instrument is a new instrument and requires revalidation, including of its cut-points; back-translation establishes semantic correspondence, not psychometric equivalence.

Method bias covers everything about administration. Familiarity with Likert-type formats varies. Test-taking motivation varies. The identity of the assessor changes responses, particularly on questions about discrimination, substance use, immigration status, and sexuality. Language of administration matters even in fluent second-language speakers, and emotional vocabulary in a second language is generally less differentiated than in a first.

Norm bias occurs when a person is compared against a reference sample they do not belong to. Most widely used instruments were normed on samples that overrepresent white, educated, high-income, treatment-seeking populations in a small number of countries. The published cut-point of an instrument is a property of the validation sample and of the base rate in that sample, and it is the component least likely to transport.

Interpretation bias is the clinician's. Diagnostic disparities are well documented, including long-standing overdiagnosis of schizophrenia and underdiagnosis of mood disorders in Black patients in the US and UK. These do not require conscious prejudice; they follow from differential thresholds for reading behaviour as pathological, from misreading justified mistrust of services as paranoia, and from unfamiliarity with normative expression.

Language-based automated assessment inherits all of these and adds its own. Rai et al. (2024) examined whether established language markers of depression generalise across race in a matched sample of 868 Black and White US Facebook users with PHQ-9 scores. Greater depression severity predicted first-person singular pronoun use in White participants but not in Black participants, and five negative-emotion topics related to depression severity in White but not Black participants. Models trained on White participants' language correlated r = 0.392 with depression severity in a held-out White test set but only r = 0.132 in a Black test set. A model trained exclusively on Black participants' language performed poorly on Black participants (r = 0.126). The authors conclude that language-based depression models need to demonstrate racial invariance before clinical integration. This is a direct, quantified demonstration that a language-based inference pipeline can fail for a whole population while continuing to output confident numbers.

## Inferring a score from free text is not administration

This is the most important limit in this file for a system that reasons over conversation.

An instrument is a standardised procedure. Its psychometric properties belong to the procedure, not to the construct it names. Those properties were established under specific conditions: fixed item wording, fixed response options, a fixed recall window, a fixed order, and self-completion by the respondent. Change any of those and the published reliability, validity, sensitivity, specificity, and cut-points no longer apply, because they were never estimated under the changed conditions.

Reading a conversation and producing "this appears to be around a 14 on the PHQ-9" is not a PHQ-9 score. It is an impression with a number attached. The impression may have some validity as an impression. The number imports a false precision and an unearned evidentiary status, because a PHQ-9 of 14 carries a specific meaning derived from validation studies, and that meaning attaches to the administered instrument, not to a similar-sounding judgement.

The specific failures are these. The items were never asked, so the person never considered several symptom domains and never had the chance to report symptoms they did not spontaneously mention. The recall window was never applied, so a mention of poor sleep might refer to last night or to last year. The response anchors were never used, so there is no calibration between "not at all" and "several days". The person did not self-rate, so the rating reflects the model's inference about the person rather than the person's report about themselves, and self-report instruments derive their validity precisely from being self-report. And the ordering, framing, and completeness that make item responses comparable across people are absent.

The same applies to diagnostic criteria. Concluding from a conversation that someone meets criteria for a disorder is not a diagnostic assessment. Diagnosis requires systematic criterion coverage, duration and functional impairment thresholds, exclusion of substance and medical causes, differential consideration, and usually collateral information. None of these are available from a conversation, and the most consequential differentials, such as bipolar versus unipolar depression, depend precisely on the information self-report in a single conversation is worst at supplying.

The permitted operations are narrower and still useful. Asking the actual questions of a public-domain instrument, in its actual wording, with its actual response options and recall window, and having the person answer them, is administration, and it is a legitimate thing to do in text where the instrument permits self-completion. Noting that a person has described several features that overlap with a recognised pattern, and naming that as a hypothesis to be checked, is legitimate. Recommending that the person complete a validated measure with a clinician, or seek assessment, is legitimate.

What is not legitimate is producing a score, a severity band, a percentile, a probability of diagnosis, or a diagnosis, from inference over text, and presenting it in the vocabulary of measurement. The vocabulary of measurement carries an implicit claim about procedure that has not been met.

## Sources

- Jacobson, N. S., & Truax, P. (1991). Clinical significance: a statistical approach to defining meaningful change in psychotherapy research. Overview and RCI formula summarised at PSYCTC. https://www.psyctc.org/psyctc/root/stats/rcsc/
- Reliable Change Index (encyclopedia entry, formula and interpretation). Springer. https://link.springer.com/rwe/10.1007/978-3-319-56782-2_1242-3
- Validity of clinically significant change classifications yielded by Jacobson-Truax and Hageman-Arrindell methods. *BMC Psychiatry* (2016). https://bmcpsychiatry.biomedcentral.com/articles/10.1186/s12888-016-0895-5
- Harvill, L. M. Standard Error of Measurement. NCME Instructional Module 9. https://ncme.org/wp-content/uploads/2025/10/Module-9-Standard-Error-of-Measurement-Harvill-S-1.pdf
- Standard Error of Measurement and confidence intervals. National University Statistics Resources. https://resources.nu.edu/statsresources/ComputingSEM
- Measurement Invariance overview (configural, metric, scalar). ScienceDirect Topics. https://www.sciencedirect.com/topics/psychology/measurement-invariance
- Cross-Cultural Measurement Invariance of Scales Assessing Stigma and Attitude to Seeking Professional Psychological Help. *Frontiers in Psychology*. https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.01249/full
- Rai, S., Stade, E. C., Giorgi, S., Francisco, A., Ungar, L. H., Curtis, B., & Guntuku, S. C. (2024). Key language markers of depression on social media depend on race. *PNAS*, 121(14), e2319837121. https://www.pnas.org/doi/10.1073/pnas.2319837121
- Commentary: Do "Black individuals" really display no linguistic markers of depression? *PNAS*. https://www.pnas.org/doi/10.1073/pnas.2410997121
- US Department of Veterans Affairs, National Center for PTSD. PTSD Checklist for DSM-5 (PCL-5): scoring, cut-points, and change thresholds. https://www.ptsd.va.gov/professional/assessment/adult-sr/ptsd-checklist.asp
- Marx, B. P., Lee, D. J., Norman, S. B., et al. (2022). Reliable and clinically significant change in the Clinician-Administered PTSD Scale for DSM-5 and PTSD Checklist for DSM-5 among male veterans. *Psychological Assessment*, 34(2), 197-203. https://pubmed.ncbi.nlm.nih.gov/34941354/
- Sheehan, D. V., et al. (1998). The Mini-International Neuropsychiatric Interview (M.I.N.I.). *Journal of Clinical Psychiatry*, 59(Suppl 20), 22-33. https://pubmed.ncbi.nlm.nih.gov/9881538/
- CORC. Outcome Rating Scale (ORS) and Child Outcome Rating Scale (CORS): clinical cut-off and reliability. https://www.corc.uk.net/outcome-measures-guidance/directory-of-outcome-measures/outcome-rating-scale-ors-child-outcome-rating-scale-cors/
