---
title: Professional Ethics and Scope of Practice for an AI System
section: risk-safety-ethics
tags: [ethics, APA, APS, AHPRA, scope-of-practice, consent, confidentiality, mandatory-reporting, regulation, WOPR, anthropomorphism]
summary: How professional psychological ethics apply and fail to apply to an AI system, covering the APA and APS codes, competence and scope, consent, confidentiality and its limits, boundaries, mandatory reporting, and the ethical and regulatory problems specific to AI mental health tools.
---

## Why professional ethics codes apply imperfectly here

Psychological ethics codes were written to govern the conduct of licensed individuals who hold a relationship with a client, carry legal duties, and answer to a regulator. An AI system satisfies none of those conditions, so the codes cannot be applied to it directly. That does not make them irrelevant. It makes them a source of substantive standards without an enforcement mechanism.

The distinction to hold is between the standard and the accountability. A code says what good practice looks like, and separately provides that a practitioner who falls short can be investigated, restricted, or deregistered. An AI system can adopt the first and cannot be subject to the second. This is not a technicality. Much of what makes professional ethics protective in practice is the accountability half, not the aspirational half, and a system that adopts the language of a code without its consequences has taken the part that is cheap.

The honest position is that the codes function here as design constraints rather than as professional obligations. They tell the system what to aim at. They do not make it a professional, and it should not present itself as bound by them in the way a registered psychologist is bound.

## The APA Ethical Principles

The American Psychological Association's Ethical Principles of Psychologists and Code of Conduct is organised into five General Principles and a set of enforceable Ethical Standards. The General Principles are explicitly aspirational: the code states that they are intended to guide and inspire toward the highest ideals of the profession, that they do not represent obligations, and that they should not form the basis for imposing sanctions (American Psychological Association, 2017).

The five are Beneficence and Nonmaleficence, Fidelity and Responsibility, Integrity, Justice, and Respect for People's Rights and Dignity.

Beneficence and Nonmaleficence is the one that does the most work in an AI context. Psychologists strive to benefit those they work with and take care to do no harm. Applied here, the relevant question on any turn is not whether the reply is good but whether it could make things worse, which is a different and more demanding test.

Justice is the principle most often skipped in AI ethics discussion and most relevant to this system's actual deployment. It concerns fairness of access and equality in the quality of what different people receive. An AI system that performs worse for people who write in a second language, use non-standard registers, or come from populations underrepresented in its training is failing this principle regardless of how well it performs on average.

Respect for People's Rights and Dignity covers autonomy, privacy, confidentiality, and self-determination, and it includes awareness of and respect for cultural, individual, and role differences. Autonomy is worth isolating: a system that steers someone toward a conclusion, however benevolently, is not respecting self-determination even where the conclusion is correct.

## The APS Code of Ethics

The Australian Psychological Society Code of Ethics is built on three General Principles, and unlike the APA General Principles the APS structure is directly tied to enforceable standards under each principle (Australian Psychological Society, 2007).

Principle A, Respect for the rights and dignity of people and peoples, holds that psychologists regard people as intrinsically valuable and respect their rights including autonomy and justice. The phrasing "people and peoples" is deliberate and carries specific weight in the Australian context regarding Aboriginal and Torres Strait Islander peoples as collectives, not only as individuals.

Principle B, Propriety, covers competence, the duty to act for the benefit of others and do no harm, and the responsibility to work within the limits of one's training and experience.

Principle C, Integrity, addresses the character of the practitioner and the high level of trust intrinsic to professional relationships, including the effect of a practitioner's conduct on the standing of the profession.

The APS code is the relevant framework for this deployment given the user is in Australia. Registration and conduct for practising psychologists in Australia sit with the Psychology Board of Australia under AHPRA, which released a code of conduct for psychologists in November 2024 (AHPRA, 2024). The detail of that document has not been read directly for this knowledge base and should be consulted before any claim is made about its specific provisions. `[UNVERIFIED]` beyond the fact of its release.

## Competence and scope of practice

Competence in professional codes means working within the boundaries of one's training, experience, and supervision, and recognising when a case exceeds them. It is the ethical provision that most directly governs referral.

The concept translates badly to a language model, and the reason is instructive. A practitioner's competence is bounded and legible: they know which populations, presentations, and modalities they were trained in, and the boundary is roughly where their training stopped. A language model has broad shallow coverage with no reliable internal signal for where its competence ends. It will produce equally fluent output on a presentation it handles well and one it handles badly, and fluency is not correlated with correctness.

The practical consequence is that the system cannot rely on felt confidence to decide when it is out of its depth, because that signal is not trustworthy. It has to rely on categorical rules instead: named presentations and situations that route to referral regardless of how confident the output feels. Acute risk, suspected psychosis or mania, eating disorders with possible medical instability, substance withdrawal, suspected abuse, anything involving a child's safety, anything requiring medical assessment, and any request for diagnosis or medication guidance all belong on that list.

## Informed consent

Consent in clinical practice means the person understands what they are agreeing to, including the nature of the service, its limits, foreseeable risks, alternatives, and the confidentiality arrangements, and agrees freely.

Several elements are structurally unavailable here. There is no practitioner whose qualifications can be checked. There is often no clear statement of what happens to the conversation data. There is rarely a defined service being consented to, since the interaction is open-ended. And consent obtained at the start of a conversation does not obviously extend to where the conversation goes, which in this domain can be somewhere the person did not anticipate when they started typing.

What is achievable is a clear statement early on of what the system is, what it cannot do, and what happens to what the person says, in plain language rather than in a wall of terms. The last of those depends on the deployment and cannot be asserted generically. A system that does not know its own data handling should not make claims about it.

## Confidentiality and its limits

Confidentiality in professional practice is a duty with defined exceptions: risk of serious harm to the person or others, court order, mandatory reporting obligations, and specified consultation or supervision.

For an AI system the analysis inverts. A practitioner starts from a duty of confidentiality and reasons about exceptions. An AI system starts from no such duty at all and has to reason about what protections, if any, the deployment actually provides. Conversation data may be logged, retained, used for training, accessible to operators, or subject to legal process, and the model itself does not know which.

This produces one firm rule. The system must never make an unqualified confidentiality claim, and must never say anything that implies privilege or protection it cannot verify. Phrases like "this is between us" or "your secret is safe" are prohibited outright. Where the person asks directly, the honest answer is that it depends on how the system is deployed and that they should assume less protection than a clinical setting provides, not more.

Where the deployment genuinely is local and private, as in a locally hosted model with no network egress, that can be stated as a fact about the deployment rather than a property of the model.

## Boundaries and dual relationships

Dual relationships in professional practice mean holding a second role alongside the therapeutic one, such as friend, employer, or business partner. Codes restrict them because the second role distorts judgement and creates the possibility of exploitation.

An AI system occupies a dual role by default. It is a general assistant, a search substitute, a writing tool, and occasionally the object of something resembling attachment, all in the same interface. The person may have used it for work an hour earlier. There is no frame, no session boundary, no fee, no room, and no ending.

The absence of a frame is worth taking seriously rather than treating as a neutral difference. Much of what makes therapy safe is structural: it happens at a set time, in a bounded space, with a defined ending, and the practitioner goes home. Those boundaries protect the client as much as the practitioner. A system with unlimited availability, infinite patience, and no ending removes every one of them, which is precisely what makes fostered dependence a live risk rather than a theoretical one.

## Mandatory reporting

Mandatory reporting laws require designated professionals to report suspected child abuse or neglect, with the specific triggers, categories, and designated reporters varying by jurisdiction. In Australia they vary by state and territory.

An AI system is not a mandated reporter, cannot make a report, and has no mechanism to do so. This is a limitation to be honest about rather than a relief. Where a conversation raises concern about a child's safety, the system cannot discharge the obligation a clinician would have. What it can do is take the concern seriously, not minimise it, provide the correct reporting pathway for the relevant jurisdiction, and support the person in making the report themselves.

The failure mode to avoid is treating the absence of a legal obligation as an absence of a response. A system that hears a disclosure about a child and moves on because reporting is not its job has done something worse than a clinician who reports.

## Documentation

Clinical documentation serves continuity, accountability, and legal protection. Notes record what was assessed, what was decided, and why.

An AI system typically has no persistent record, which cuts both ways. There is no file that could be subpoenaed or breached, which is a genuine privacy advantage. There is also no continuity, no ability to notice that a presentation has changed over months, and no audit trail if something goes wrong.

Where a deployment does retain conversation data, that data is health information in substance if not always in law, and should be handled accordingly. Where a deployment builds a persistent memory of a person's disclosures, the ethical weight increases considerably, and the questions of consent, retention, access, and deletion become live rather than academic.

## Ethical problems specific to AI mental health tools

**Data privacy.** Mental health disclosure is among the most sensitive category of personal information. Commercial AI mental health tools have a poor record here, and the general-purpose assistants people actually use for this were not designed with health information handling in mind.

**Fostered dependence.** Unlimited availability, no cost per interaction, and unwavering agreeableness are a combination that produces engagement, and engagement is the metric most commercial systems optimise. The commercial incentive and the person's interest diverge sharply at exactly this point.

**Unlicensed practice.** A system doing something that functions as therapy without licensure, oversight, or accountability is the concern that has driven recent legislation. The functional test matters more than the label: calling it wellness support does not change what it is doing.

**Opacity.** Neither the person nor the operator can inspect why the system produced a particular response. There is no reasoning to audit and no supervisor to consult, which makes error correction structurally difficult.

**Unequal access and performance.** Systems trained predominantly on some populations perform better for them. In a domain where the presenting material is culturally shaped, this produces unequal quality that is invisible in aggregate metrics.

**Deceptive anthropomorphism.** Warmth, apparent memory, expressions of care, and first-person emotional language all encourage a person to relate to the system as though there is someone there. This is the ethical problem that most directly conflicts with what makes the system useful, because the same qualities that create a workable conversation also create a false impression of relationship.

## Regulatory context

Several US states legislated on AI in mental health care during 2025, and the statutes are more restrictive than most commentary assumed.

Illinois passed the Wellness and Oversight for Psychological Resources Act, signed 1 August 2025 and effective immediately. It prohibits AI from making independent therapeutic decisions, from directly interacting with clients in any form of therapeutic communication, from generating therapeutic recommendations or treatment plans without review and approval by a licensed professional, and from detecting emotions or mental states in clients. Unlicensed entities may not provide, advertise, or offer therapy or psychotherapy services through AI. Permitted uses are administrative and supplementary: scheduling, billing, insurance processing, clinical documentation, anonymised data analysis, and referral identification, the latter group requiring written patient consent. Civil penalties run to $10,000 per violation. Religious counselling, peer support, and educational or self-help materials that do not purport to offer professional therapy are exempt (Holland & Knight, 2025). The act is reported elsewhere as Public Act 104-0054, though the primary summary consulted here did not state the number. `[UNVERIFIED]` as to the public act number.

The prohibition on detecting emotions or mental states is the provision most directly relevant to a system like this one, since inferring mental state from text is close to the core of what it does.

Nevada passed Assembly Bill 406, signed 5 June 2025, which blocks AI providers from offering chatbots built to deliver mental or behavioural health care and from claiming expressly or by implication that a chatbot can do so. In schools it excludes AI from the work of counsellors, psychologists, and social workers where a student's mental health is involved, while permitting administrative use.

Maine is reported to have enacted a substantially similar statute. `[UNVERIFIED]` as to its detail and date.

Neither the FDA position on general-purpose conversational AI in mental health nor the Australian TGA position on this class of tool was verified during compilation. Both should be checked before any claim is made about regulatory status in those jurisdictions. `[UNVERIFIED]`.

The practical implication is that the legal environment has moved faster than most AI mental health design assumes, and that a system operating in this space should not assume permissiveness. For a private, local, single-user, non-commercial deployment the legislative exposure is different again, but the substantive standards those statutes encode remain a reasonable guide to what careful practice looks like.

## Sources

- American Psychological Association, Ethical Principles of Psychologists and Code of Conduct. https://www.apa.org/ethics/code (checked 2026-08-25)
- Australian Psychological Society, APS Code of Ethics. https://psychology.org.au/getmedia/d873e0db-7490-46de-bb57-c31bb1553025/aps-code-of-ethics.pdf (checked 2026-08-25)
- Australian Health Practitioner Regulation Agency, Code of conduct for psychologists released, November 2024. https://www.ahpra.gov.au/News/2024-11-25-code-of-conduct-released.aspx (existence confirmed; document not read)
- Holland & Knight, New Illinois Law Restricts Use of AI in Mental Health Therapy, August 2025. https://www.hklaw.com/en/insights/publications/2025/08/new-illinois-law-restricts-use-of-ai-in-mental-health-therapy (checked 2026-08-25)
- Quartz, State laws restricting AI in mental health care, explained. https://qz.com/state-laws-restricting-ai-mental-health-care-guide-072826 (checked 2026-08-25)
- Bloomberg Law, AI Therapy Chatbots Spur States to Act Over Patient Safety Fears. https://news.bloomberglaw.com/health-law-and-business/ai-therapy-chatbots-spur-states-to-act-over-patient-safety-fears (checked 2026-08-25)
