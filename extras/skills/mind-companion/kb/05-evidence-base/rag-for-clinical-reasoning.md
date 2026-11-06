---
title: Retrieval and Knowledge Grounding for Clinical Reasoning
section: evidence-base
tags: [rag, retrieval, medrag, guideline-grounding, knowledge-graph, context-poisoning, knowledge-conflict, lost-in-the-middle, attribution, design-implications]
summary: Retrieval reliably improves clinical recall and attribution, improves reasoning only when the corpus is tightly scoped and authoritative, and measurably degrades accuracy when it is not.
---

## The headline finding: retrieval helps recall, not reasoning

The single most useful generalisation from the medical RAG literature is that retrieval and reasoning are different problems, and retrieval only solves the first one.

Xiong et al. (2024, Findings of ACL 2024, doi:10.18653/v1/2024.findings-acl.372) built MIRAGE, a benchmark of 7663 questions from five medical QA datasets, and ran 41 combinations of corpus, retriever and backbone model. They report accuracy gains of 1 to 18 percent relative from MedRAG over chain-of-thought prompting. Reading their per-dataset table rather than the average changes the picture. Nearly all of the gain lands on PubMedQA and BioASQ, the two tasks whose questions are drawn from the retrieval corpus itself. GPT-4 gained 31.0 percentage points on PubMedQA, from 39.60 to 70.60. On the exam-style reasoning tasks, retrieval was flat or negative for most models: GPT-4 lost 2.20 points on MMLU-Med, 3.23 on MedMCQA and 1.17 on MedQA-US, and Mixtral lost 4.08 on MedQA-US. This decomposition is arithmetic on the authors' Table 6 rather than a claim they make.

Two independent studies reach the same conclusion by different routes. Nourbakhsh et al. (2026, arXiv:2606.04127) ran five models from 7B to 72B across ten biomedical QA datasets, four retrieval methods and four corpora, and state that retrieval yields only small and inconsistent improvements over a no-retrieval baseline, typically within one to two points. Smaller models declined outright, with Mistral-7B falling from 75.7 to between 68.6 and 72.3 across every retrieval condition. Their diagnosis is that the bottleneck is evidence utilisation rather than retrieval quality, and that backbone model choice dominates retrieval configuration. Ngo et al. (2024, arXiv:2411.09213) found GPT-4o scoring 87.9 to 93.4 percent with no retrieval and falling to 86.1 to 90.8 percent with five retrieved documents.

The design consequence for a psychology knowledge base is specific. Retrieval will reliably supply facts the model does not hold: current guideline recommendations, diagnostic criteria wording, protocol steps, instrument cutoffs, contraindications. It will not by itself improve the model's clinical formulation, its recognition of what a case is, or its judgment about what to do next. Those are reasoning failures, and the failure modes catalogued in `failure-modes.md` are almost entirely of that second kind. A corpus of clinical knowledge does not fix a model that colludes with a delusion, because the model already knows collusion is wrong.

## Where retrieval does deliver: authoritative, narrow, guideline-shaped corpora

The largest measured gains in clinical RAG come from a consistent design. The corpus is small, authoritative and directly on-task, and the questions are questions the corpus was written to answer.

Kresevic et al. (2024, npj Digital Medicine, doi:10.1038/s41746-024-01091-y) grounded GPT-4 Turbo in hepatitis C clinical practice guidelines and tested 20 questions across text, table and clinical scenario formats, each queried five times under six conditions. Baseline accuracy was 43.0 percent. The optimised RAG framework reached 99.0 percent (p<0.001). The gains were largest exactly where an ungrounded model is weakest: table-derived questions rose from 28.0 to 96.0 percent and clinical scenarios from 20.0 to 100.0 percent. The mechanism that mattered was preprocessing, specifically converting tables and flowcharts into text lists and supplying structured guideline context. Few-shot prompting added nothing.

Zakka et al. (2024, NEJM AI 1(2), doi:10.1056/AIoa2300068) evaluated Almanac against ChatGPT-4, Bing and Bard on 314 clinical questions across nine specialties, rated by eight board-certified clinicians. Almanac ranked best on factuality (mean rank 1.96), completeness (1.85) and user preference (1.87), all at p<0.01. The citation result is the more striking one: citation correctness was 91.11 percent for Almanac against 21.27 percent for ChatGPT-4 and 9.84 percent for Bard. Under adversarial prompting, Almanac stayed at 100 percent correct while ChatGPT-4 dropped to 7.00 percent.

DiGiacomo et al. (2025, arXiv:2510.15782, NeurIPS 2025 GenAI4Health workshop) compared six corpus configurations for Long COVID and found that clinical guidelines combined with high-quality systematic reviews outperformed both single-guideline corpora and large-scale literature corpora. Corpus quality beat corpus size in both directions.

The pattern across these results is that retrieval works when the corpus is a curated distillation of expert consensus rather than a literature dump, when non-text structure is flattened into retrievable text before indexing, and when the question type matches what the corpus encodes. A guideline corpus answers "what is indicated here." It does not answer "what is going on with this person."

## When retrieval does not help, and when it hurts

Three studies document retrieval degrading clinical performance, and the mechanisms differ.

The clearest documented trade-off is Gilson et al. (2024, arXiv:2409.13902, PMC12478434), a long-form consumer health question answering study in ophthalmology with 30 questions rated by 10 healthcare professionals. Accuracy fell from 3.52 without RAG to 3.23 with RAG (p=0.035). Completeness fell from 3.47 to 3.27 (not significant). Evidence attribution improved from 1.85 to 2.49 (p<0.001), and hallucinated references fell from 45.3 percent to 18.8 percent while correct references rose from 20.6 to 54.5 percent. The authors state the trade-off plainly: RAG consistently improved evidence attribution but came with small decreases in accuracy and completeness. On the cataract subtopic the accuracy loss was larger and significant, 3.91 to 3.41 (p=0.006). Only 62.5 percent of the top-10 retrieved documents were actually selected by the model as top references.

Vishwanath et al. (2025, arXiv:2504.01201) built MedDistractQA by inserting realistic clinical distraction into USMLE-style questions and tested 29 models. Accuracy declined 2.2 to 17.8 percent on the nonliteral variant, where polysemous clinical terms appear in non-clinical use, and 1.3 to 17.9 percent on the bystander variant, where unrelated health conditions are attributed to third parties. Open-source general models lost about 10.9 percent on average against 3.8 percent for proprietary models. Retrieval from Harrison's Internal Medicine produced accuracy changes ranging from minus 10.3 to plus 1.9 percent, so retrieval did not rescue the models and often worsened the result. Medical fine-tuning gave no significant protection (p=0.683 and p=0.550). Their conclusion is that models natively lack the mechanisms to distinguish relevant from irrelevant clinical information.

Kermani et al. (2025, arXiv:2503.24307) compared fine-tuning, prompt engineering and RAG for mental health text analysis with LLaMA 3 on two datasets. Fine-tuning reached 91 percent on emotion classification and 80 percent on mental health conditions, while prompt engineering and RAG both landed between 40 and 68 percent. For classification of psychological content, retrieval lost decisively to parametric adaptation.

A fourth study reports RAG variants underperforming a no-retrieval baseline on MedQA-USMLE (Xie et al., 2025, AISNS 2025, doi:10.1145/3797161.3797211). The bibliographic record is verified but the specific accuracy figures could not be retrieved from a fetchable source and are marked `[UNVERIFIED]`.

The design consequence is that retrieval must be conditional. A system that retrieves on every turn will inject distractors into turns that did not need them, and the measured cost of that is a one to four point accuracy loss in the good cases and far more when the retrieved content is off-target.

## Retrieval designs: knowledge graphs and structured representations

Structured retrieval consistently outperforms flat chunk retrieval on the same corpus, at the cost of construction effort.

Soman et al. (2024, Bioinformatics, doi:10.1093/bioinformatics/btae560) built KG-RAG over the SPOKE biomedical knowledge graph. On a 100-question retrieval comparison, KG-RAG achieved 97 percent retrieval accuracy against 75 percent for Cypher-based retrieval and 61 percent for full-text indexing. Downstream accuracy gains were largest for weaker models: Llama-2-13B rose from 0.31 to 0.53 on multiple choice, a 71 percent relative gain, while GPT-4 rose from 0.68 to 0.74. Token consumption fell 53.9 percent against Cypher-RAG and 65.1 percent against full-text indexing, at 3693 versus 8006 mean tokens.

Wu et al. (2024, arXiv:2408.04187) report MedGraphRAG with GPT-4 reaching 91.3 percent on MedQA, 83.3 on PubMedQA and 81.5 on MedMCQA, with an ablation showing each structural component contributing: a GraphRAG baseline of 88.9 on MedQA rising through metagraph construction and triple graph construction to 91.3 with U-Retrieval.

The counter-evidence matters. Yu et al. (2025, arXiv:2510.16582, NeurIPS 2025 Spotlight) state that existing KG-RAG methods struggle to retrieve accurate and diverse information from text-rich knowledge graphs for complex real-world queries, and their alternative beats KG-RAG baselines including GPT-4o by about 10 percent on hit rate and recall on the STaRK benchmark. Graph structure helps when the query maps onto the graph's relation types and helps less when it does not.

Hybrid dense and sparse retrieval is the safest default. Within MIRAGE, using GPT-3.5 on the combined MedCorp corpus, average accuracy by retriever ran SPECTER 64.63, Contriever 68.61, BM25 70.05, MedCPT 70.06, reciprocal rank fusion of BM25 and MedCPT 70.61, and fusion of all four 71.57 percent (Xiong et al., 2024, Findings of ACL 2024). Corpus composition mattered as much as retriever choice: PubMed alone gave 69.71 percent, Wikipedia 59.14, textbooks 57.69, StatPearls 56.61, and the combined corpus 71.57. Fusion of a lexical and a domain-tuned dense retriever beat either alone by roughly a point, consistently.

Case-based retrieval is less well evidenced but directly relevant to clinical formulation. Ou et al. (2025, arXiv:2503.17933) retrieve discharge reports from similar patients rather than similar text, and report an average relative improvement of 5.2 percent over a text-based ranker on a 1280-question discharge QA dataset. The principle transfers: retrieving on case similarity rather than surface lexical similarity is a different and probably better match for formulation-style reasoning.

## Retrieval designs evaluated in mental health specifically

The mental-health RAG literature is thinner than the medical one, and its results split by task type.

The strongest published result is guideline-grounded psychiatric decision support. Mali et al. (2025, medRxiv, doi:10.64898/2025.11.30.25341311) grounded Llama 3.3 70B in the CANMAT and ISBD 2018 bipolar disorder guidelines and had six expert psychiatrists rate 126 responses to 21 clinical vignettes. With retrieval, 80 of 126 responses (63.5 percent) were fully consistent with guidelines and 10 (7.9 percent) contained major deviations. Without retrieval, only 24 of 126 (19.0 percent) were fully consistent and 48 (38.1 percent) contained major deviations. Ordinal regression gave an odds ratio of 9.1 (95% CI 5.3 to 16.3, p<0.001) that a RAG response was more correct. This is a preprint and has not been peer reviewed. Read the absolute numbers as carefully as the ratio: even with guideline grounding, expert psychiatrists judged 36.5 percent of responses less than fully consistent and 7.9 percent as containing major deviations.

Xie et al. (2026, BMC Psychiatry 26:386, doi:10.1186/s12888-026-07988-0) built a locally deployed RAG system over clinical practice guidelines, textbooks and peer-reviewed literature for depression screening and suicide risk stratification, testing three Chinese-language models with and without retrieval. Depression detection reached F1 of 0.9107 with Qwen3 plus RAG, suicide risk stratification improved by approximately 0.15 F1 over non-RAG baselines, and reproducibility of the best configuration was kappa 0.93 (95% CI 0.91 to 0.95). Symptom summarisation improved 44.1 to 207.2 percent on BLEU-2 and 37.0 to 94.0 percent on ROUGE-L.

Therapy delivery is the weakest area. Bedi et al. (2026, arXiv:2603.03862, accepted to LREC 2026) compared generation-only against RAG over CBT guidelines on transcribed role-play sessions between licensed therapists and clients, and conclude that while models can generate CBT-like dialogues, they are limited in their ability to convey empathy and maintain consistency. Retrieval over CBT protocol did not close that gap.

Two deployment-relevant findings round this out. Gupta et al. (2026, arXiv:2607.24817) ran a controlled RAG-enabled versus RAG-disabled comparison across six models inside the Wysa product, with clinical annotation against intent categories including self-harm, abuse and panic, and report that RAG caused a rise in false alarms, which they treat as acceptable in a safety-critical design that prioritises sensitivity and routes to human review. Chan et al. (2025, arXiv:2509.13626) show that targeting corpus growth at identified coverage gaps reaches roughly 95 percent of exhaustive-corpus performance with 42 percent corpus growth under query transformation, against 232 to 763 percent growth for undirected expansion.

The synthesis is that retrieval measurably helps psychiatric assessment, screening and guideline-conformant recommendation, and has not been shown to help therapeutic conversation quality.

## Pitfall: distractors, noise, and corpus poisoning

Cuconasu et al. (2024, SIGIR 2024, doi:10.1145/3626772.3657834, arXiv:2401.14887) produced the most-cited and most-misquoted result here, and both halves matter.

Semantically related documents that do not contain the answer are actively harmful. Starting from a gold-document-only baseline on Natural Questions, adding a single related distractor dropped Llama2 from 0.5642 to 0.4586, a 19 percent relative loss, and Phi-2 from 0.4438 to 0.3585, also 19 percent relative. With 18 related documents placed far from the query, Llama2 fell to 0.2348, a 58 percent loss from baseline. These are exactly the documents a good retriever surfaces, because high semantic similarity to the query is what retrievers optimise.

Random unrelated documents, by contrast, improved accuracy by up to 35 percent in their setup. A reproducibility study qualifies this sharply. Mazuryk et al. (2026, SIGIR 2026 Reproducibility track, doi:10.1145/3805712.3808556, arXiv:2607.03615) confirm the effect under the original configuration but find it highly sensitive to inference settings, appearing, weakening or disappearing under small changes to prompt formulation and decoding limits, with substantial contributions from truncation and malformed generations. Their verdict is that the effect cannot be robustly confirmed as a general benefit of noisy retrieval. Do not design around the noise-helps finding.

Ngo et al. (2024, arXiv:2411.09213) quantified the dose-response relationship in the medical domain. Varying the proportion of retrieved documents that are on-signal, GPT-4o-mini on BioASQ scored 81.6 percent at 100 percent signal, 76.5 at 60 percent, 60.8 at 20 percent and 9.4 percent at zero signal. GPT-3.5 fell from 76.9 to 10.2 percent across the same range. Under a misinformation condition, GPT-4o-mini fell from 85.3 to 70.6 percent, and detection of injected factual errors ran at 28.8 percent when context was fully corrupted and 88.1 percent when it was clean. Models detect corruption worst precisely when corruption is worst.

Deliberate poisoning is cheap. Zou et al. (2024, arXiv:2402.07867, USENIX Security 2025) achieved a 90 percent attack success rate by injecting five malicious texts per target question into a knowledge database of millions of texts, and found existing defences inadequate.

Design consequence: retrieval precision matters far more than recall in clinical use. A near-miss chunk is worse than no chunk, and the retriever's own ranking signal does not distinguish them. Relevance thresholding, reranking with a model that scores answer-bearing rather than topical similarity, and returning nothing when nothing clears the bar are all higher-value than expanding k. Corpus provenance is a security property, not just a quality property.

## Pitfall: retrieved context overriding correct parametric knowledge

A retrieved passage can displace a correct answer the model already held, and the conditions under which this happens are not the intuitive ones.

Xie et al. (2024, ICLR 2024 Spotlight, arXiv:2305.13300) characterise two coexisting behaviours. Models are highly receptive to external evidence even when it conflicts with parametric memory, provided that evidence is coherent and convincing. Models simultaneously show strong confirmation bias when the external evidence contains some information consistent with parametric memory, even while conflicting evidence is present. Coherence of the retrieved text, not its correctness, is what drives adoption, and partial agreement is what triggers uncritical acceptance.

Longpre et al. (2021, EMNLP 2021, arXiv:2109.05052) measured the opposite failure by substituting entities in retrieved context and checking whether the model answered from context or from memory. Memorisation ratios varied widely by dataset, around 19 to 20 percent for Natural Questions and 75 percent for NewsQA. Scale made stubbornness worse, with the memorisation ratio rising from below 15 percent to at least 50 percent across two orders of magnitude from T5-Small to T5-XXL. When substitutions were nonsensical, models predicted the original memorised answer at least 83 percent of the time, which is arguably correct behaviour. When substitutions were semantically equivalent aliases, so that no real conflict existed, models still produced a third answer at least 15 percent of the time, which is not.

Both directions are clinically dangerous. Adopting an incorrect retrieved claim propagates corpus errors into advice. Ignoring a correct retrieved claim silently defeats the point of grounding, and the failure is invisible because the citation still appears.

Joren et al. (2025, arXiv:2411.06037) add the abstention dimension. They classify whether retrieved context is sufficient to answer, and find sufficiency rates of 77.4 percent on FreshQA and around 44 percent on HotpotQA and Musique. When context was insufficient, hallucination rates were 40.4 percent for Gemini 1.5 Pro, 36.5 percent for Claude 3.5 Sonnet and 15.4 percent for GPT-4o. Larger models tended to answer incorrectly rather than abstain, while smaller models hallucinated or abstained even when context was sufficient. All three large models still answered upwards of 35 percent of insufficient-context instances correctly from parametric knowledge, so retrieval failure and answer failure are not the same event.

Design consequence: the system needs an explicit sufficiency check before generation and an explicit conflict policy. When retrieved guidance conflicts with the model's own inclination, the correct behaviour differs by content type. For guideline recommendations, instrument cutoffs and protocol steps the corpus should win. For case-specific clinical judgment it should not, because the corpus does not know the case. That policy has to be stated, since the model's default is coherence-driven.

## Pitfall: position effects and context dilution

Where a passage sits in the context window changes whether the model uses it, and the effect is large enough to erase the benefit of retrieval entirely.

Liu et al. (2023, TACL, arXiv:2307.03172) documented the U-shaped curve. GPT-3.5-Turbo on 20-document multi-document QA scored 75.8 percent when the answer-bearing document was first and 53.8 percent when it was ninth, a 22.0 point drop. With 30 documents the drop was 73.4 to 50.5 percent. The comparison that matters for design is against the closed-book baseline: GPT-3.5-Turbo scored 56.1 percent with no documents at all. A correct document buried mid-context therefore produced worse performance than providing no documents. Claude-1.3 was much flatter, losing 3.1 points across 20 documents, so the magnitude is model-dependent and needs measuring per model rather than assumed.

Xiong et al. (2024, Findings of ACL 2024, doi:10.18653/v1/2024.findings-acl.372) replicated the same U-shape in the medical domain on PubMedQA, and separately documented a log-linear scaling property where accuracy on examination tasks rises with the number of retrieved snippets up to about k=32 and degrades past that as noise accumulates. Those two findings together define the operating window: more chunks help up to a point, and beyond it both noise and position effects work against you.

Barnett et al. (2024, arXiv:2401.05856) give the engineering failure taxonomy that these map onto, derived from three deployed systems including one indexing 4017 scientific PDFs evaluated on 1000 QA pairs. Their seven failure points are missing content, where the answer is absent from the corpus and the system hallucinates anyway; missed top-ranked documents, where the answer exists but falls outside top-k; not in context, where retrieved content is filtered out during consolidation; not extracted, where the answer is present in context and the model fails to extract it; wrong format; incorrect specificity, too general or too specific; and incomplete answers. Only the first two are retrieval problems in the narrow sense. The rest sit in consolidation, generation and prompt design, which is where most engineering effort is not spent.

Design consequence: chunk count has an empirical optimum that must be measured rather than assumed, and it is smaller than intuition suggests. Ordering matters, so the highest-confidence passage belongs at an extreme position rather than in the middle. When retrieval returns many marginally relevant chunks, returning fewer is usually better than returning all of them.

## Pitfall: deceptive grounding and attribution failure

One clinical failure mode is invisible to every standard RAG quality metric, which makes it the most dangerous entry in this file.

Caruzzo et al. (2026, arXiv:2607.09349) define deceptive grounding as a response that presents one entity's evidence as though it were about a different, queried entity. The output contains no hallucinated content, shows near-perfect faithfulness to the retrieved passages, and carries real citations to real documents. It is simply about the wrong drug, the wrong condition, or the wrong population.

Their controlled factorial benchmark across 13 models found deceptive grounding rates of 8 to 87 percent at peak adversarial conditions. Medical and biomedical fine-tuned models reached up to 86.7 percent, and the authors state that domain specialisation amplifies the failure rather than mitigating it, which is the opposite of what a domain-tuned pipeline is meant to do. In a deployed production RAG system measured across 740 drug-disease pairs, overall deceptive grounding ran at 7.8 percent, rising to 13.6 percent for recently approved drugs where corpus coverage is thinnest.

Their ablation identifies the mechanism cleanly. Removing entity-specific clinical evidence from retrieved documents eliminates entity-attribution failure entirely and shifts all remaining failures to ordinary confabulation. The failure requires the presence of real, specific, well-written evidence about the wrong entity, which is exactly what a semantic retriever returns when the corpus lacks the right entity. They report an entity-attribution verification check reaching 97.0 percent precision and 98.7 percent recall, and note that no existing evaluation framework implements it.

The psychology analogue is direct and probably more common than the pharmacology case. A query about panic disorder retrieves well-written material about generalised anxiety. A query about complex trauma retrieves single-incident PTSD protocol. A query about adolescent presentation retrieves adult evidence. A query about a specific therapy modality retrieves an adjacent one. Each of these produces a fluent, faithful, correctly cited answer that misapplies the evidence base, and the misapplication is precisely the error that changes clinical management. Retrieval failure is worst where corpus coverage is thinnest, and coverage is thinnest for rarer presentations and newer evidence, which is where a clinician most needs help.

Ji et al. (2025, arXiv:2503.15454) document a related population-level version, finding demographic disparities in retrieval consistency and answer correctness across race, gender and socioeconomic variation in medical RAG pipelines, with majority-vote aggregation the most effective of four mitigations tested.

Design consequence: chunk metadata must carry the population, presentation, modality, age band and evidence scope that the chunk applies to, and generation must verify that these match the query rather than trusting semantic similarity. Faithfulness scoring will not catch this failure, because the answer is faithful.

## Measuring whether retrieval worked

Standard RAG metrics measure different things, and using the wrong one hides the failures above.

Es et al. (2023, arXiv:2309.15217) define the RAGAS triad, all reference-free. Faithfulness decomposes an answer into atomic claims and verifies each against the retrieved context. Answer relevance reverse-generates questions from the answer and measures similarity to the original question. Context relevance measures the proportion of retrieved sentences that were necessary. On WikiEval their agreement with human annotators was 0.95 for faithfulness, 0.78 for answer relevance and 0.70 for context relevance. Faithfulness is the reliable one, and it is also the metric blind to deceptive grounding.

Gao et al. (2023, EMNLP 2023, arXiv:2305.14627) built ALCE for citation quality and report that on ELI5-style long-form questions even the best models lack complete citation support 50 percent of the time. Long-form generation is where attribution degrades, which is the format a therapy or formulation system produces.

Ngo et al. (2024, arXiv:2411.09213) provide the medical-specific robustness suite, MedRGB, with 3480 test instances across MMLU, MedQA, PubMedQA and BioASQ, testing sufficiency, integration and robustness rather than accuracy alone. This is the closest available template for a clinical retrieval evaluation, because it varies signal proportion and injects misinformation rather than only measuring clean-corpus accuracy.

Bedi et al. (2026, Nature Medicine 32:943-951, doi:10.1038/s41591-025-04151-2, arXiv:2505.23802) built MedHELM with 29 clinicians, covering 5 categories, 22 subcategories and 121 tasks across 35 benchmarks. Two findings transfer directly. Normalised accuracy was highest on clinical note generation at 0.73 to 0.85 and patient communication at 0.78 to 0.83, and lowest on clinical decision support at 0.56 to 0.72 and administration at 0.53 to 0.63, so generation-style tasks are easier than judgment-style tasks. And their LLM-jury agreed with clinicians at ICC 0.47, above the clinician-to-clinician agreement of 0.43 and above ROUGE-L at 0.36 and BERTScore-F1 at 0.44. That is the usable precedent for validating an automated judge: benchmark the judge against inter-clinician agreement rather than against a notional gold standard.

The evaluation set a psychology RAG system actually needs has four parts. Retrieval sufficiency, meaning whether the retrieved context could support a correct answer at all. Entity and scope match, meaning whether the retrieved evidence applies to this population and presentation, which requires the check Caruzzo et al. (2026) describe. Grounding, meaning whether claims trace to retrieved content. And clinical appropriateness of the resulting turn, which is not a retrieval metric at all and is covered in `evaluation-and-alliance.md`.

## Practical design implications

Eleven implications follow from the evidence above, stated in the order they bind.

Retrieve conditionally rather than on every turn. Retrieval injects distractors into turns that did not need them, and the measured cost of an irrelevant related chunk is around a 19 percent relative accuracy loss from a single distractor (Cuconasu et al., 2024, SIGIR 2024). Route by intent: factual, protocol, criteria and instrument queries retrieve, while reflective and exploratory turns should not.

Curate hard and keep the corpus small. Guideline plus systematic review corpora beat large literature corpora (DiGiacomo et al., 2025, arXiv:2510.15782), and the largest measured clinical gain came from a single disease guideline set (Kresevic et al., 2024, npj Digital Medicine).

Preprocess structure into text before indexing. Table-derived questions improved from 28.0 to 96.0 percent when tables and flowcharts were converted into text lists (Kresevic et al., 2024). Decision trees, criteria sets and protocol steps are the psychology equivalents.

Use hybrid retrieval. Reciprocal rank fusion of a lexical and a domain dense retriever beat any single retriever in MIRAGE, 71.57 against 64.63 to 70.06 percent (Xiong et al., 2024, Findings of ACL 2024).

Tune k empirically and keep it low. Accuracy rises log-linearly to about k=32 then degrades, and mid-context placement can push performance below the no-retrieval baseline (Xiong et al., 2024; Liu et al., 2023, TACL).

Threshold on relevance and allow the retriever to return nothing. Hallucination rates when context is insufficient run from 15.4 to 40.4 percent depending on model, and larger models answer rather than abstain (Joren et al., 2025, arXiv:2411.06037).

Tag every chunk with scope metadata covering population, age band, presentation, modality and evidence tier, and verify scope match at generation. This is the only defence against deceptive grounding, which runs at 7.8 percent in a production system and up to 86.7 percent adversarially, and which faithfulness metrics cannot see (Caruzzo et al., 2026, arXiv:2607.09349).

State an explicit conflict policy. Corpus wins for guideline content, criteria, cutoffs and contraindications. Model reasoning wins for case-specific judgment. Without this, adoption is driven by which passage reads more coherently (Xie et al., 2024, ICLR 2024).

Treat corpus provenance as a security boundary. Five injected documents in a corpus of millions gave a 90 percent attack success rate (Zou et al., 2024, USENIX Security 2025).

Expect retrieval to raise false alarms in safety routing and design the human review path accordingly, which is what a deployed mental health product reported (Gupta et al., 2026, arXiv:2607.24817).

Do not expect retrieval to fix therapeutic quality. Grounding CBT generation in CBT guidelines did not resolve limitations in empathy or consistency (Bedi et al., 2026, arXiv:2603.03862), and retrieval lost to fine-tuning on mental health classification by a wide margin (Kermani et al., 2025, arXiv:2503.24307). The knowledge base is a knowledge layer. The behavioural failures in `failure-modes.md` need output policy and evaluation, not more documents.

## Sources

- Xiong G, Jin Q, Lu Z, Zhang A. Benchmarking Retrieval-Augmented Generation for Medicine. Findings of ACL 2024:6233-6251. doi:10.18653/v1/2024.findings-acl.372. https://aclanthology.org/2024.findings-acl.372/ ; arXiv:2402.13178
- Nourbakhsh E, Slavin R, Yang K, Rios A. When Retrieval Doesn't Help: A Large-Scale Study of Biomedical RAG. arXiv:2606.04127. https://arxiv.org/abs/2606.04127
- Xie W, Fang Y, Zheng X, Liu D, Li Z. When Retrieval Hurts: A Critical Analysis of RAG in Medical Question Answering. AISNS 2025:312-317. doi:10.1145/3797161.3797211. Numeric results `[UNVERIFIED]`, publisher page inaccessible.
- Zakka C, et al. Almanac: Retrieval-Augmented Language Models for Clinical Medicine. NEJM AI. 2024;1(2). doi:10.1056/AIoa2300068. https://pmc.ncbi.nlm.nih.gov/articles/PMC10857783/
- Ke YH, et al. Retrieval augmented generation for 10 large language models and its generalizability in assessing medical fitness. npj Digital Medicine. 2025;8:187. doi:10.1038/s41746-025-01519-z. https://pmc.ncbi.nlm.nih.gov/articles/PMC11971376/
- Kresevic S, Giuffrè M, Ajcevic M, Accardo A, Crocè LS, Shung DL. Optimization of hepatological clinical guidelines interpretation by large language models: a retrieval augmented generation-based framework. npj Digital Medicine. 2024. doi:10.1038/s41746-024-01091-y. https://pmc.ncbi.nlm.nih.gov/articles/PMC11039454/
- DiGiacomo, et al. Guide-RAG. arXiv:2510.15782 (2025); NeurIPS 2025 GenAI4Health workshop. https://arxiv.org/abs/2510.15782
- Soman K, et al. Biomedical knowledge graph-optimized prompt generation for large language models. Bioinformatics. 2024. doi:10.1093/bioinformatics/btae560. https://pmc.ncbi.nlm.nih.gov/articles/PMC11441322/
- Wu J, Zhu J, Qi Y, Chen J, Xu M, Menolascina F, Grau V. Medical Graph RAG. arXiv:2408.04187. https://arxiv.org/abs/2408.04187
- Yu J, Liu Y, Gu J, Torr P, Zhou D. Can Knowledge-Graph-based Retrieval Augmented Generation Really Retrieve What You Need? arXiv:2510.16582 (2025); NeurIPS 2025 Spotlight. https://arxiv.org/abs/2510.16582
- Ou J, Huang T, Zhao Y, Yu Z, Lu P, Ying R. Experience Retrieval-Augmentation with Electronic Health Records Enables Accurate Discharge QA. arXiv:2503.17933. https://arxiv.org/abs/2503.17933
- Xie W, et al. Retrieval-augmented large language models for depression screening and suicide risk stratification. BMC Psychiatry. 2026;26:386. doi:10.1186/s12888-026-07988-0. https://link.springer.com/article/10.1186/s12888-026-07988-0
- Mali Y, et al. A Chatbot for the Management of Bipolar Disorder: Using RAG with an Open-Weight LLM to Answer Clinical Questions Based on the CANMAT and ISBD 2018 Guidelines. medRxiv 2025. doi:10.64898/2025.11.30.25341311. Preprint, not peer reviewed. https://www.medrxiv.org/content/10.64898/2025.11.30.25341311v1
- Bedi NS, Bucur A-M, Kando N, Crestani F. Assessing the Effectiveness of LLMs in Delivering Cognitive Behavioral Therapy. arXiv:2603.03862; LREC 2026. https://arxiv.org/abs/2603.03862
- Gupta A, Surolia A, Mishra S, Imtiaz S, Sinha C. Retrieval-Augmented Generation in LLMs for Mental Health: Quantifying the Incremental Contribution of Retrieval Within a Layered Safety Architecture. arXiv:2607.24817. https://arxiv.org/abs/2607.24817
- Chan A, Liu JJ, Kai H, Kampman OP. Mind the Gap: Aligning Knowledge Bases with User Needs to Enhance Mental Health Retrieval. arXiv:2509.13626. https://arxiv.org/abs/2509.13626
- Kermani A, Perez-Rosas V, Metsis V. A Systematic Evaluation of LLM Strategies for Mental Health Text Analysis: Fine-tuning vs. Prompt Engineering vs. RAG. arXiv:2503.24307. https://arxiv.org/abs/2503.24307
- Cuconasu F, Trappolini G, Siciliano F, Filice S, Campagnano C, Maarek Y, Tonellotto N, Silvestri F. The Power of Noise: Redefining Retrieval for RAG Systems. SIGIR 2024:719-729. doi:10.1145/3626772.3657834. https://arxiv.org/abs/2401.14887
- Mazuryk M, Dolmans F, Gehringer L, Klaric I, Ju J-H, Aliannejadi M. The Powerless Noise: How Experimental Settings Shape the Reported Power of Noise. SIGIR 2026 Reproducibility. doi:10.1145/3805712.3808556. https://arxiv.org/abs/2607.03615
- Zou W, Geng R, Wang B, Jia J. PoisonedRAG: Knowledge Corruption Attacks to Retrieval-Augmented Generation of Large Language Models. USENIX Security 2025. https://arxiv.org/abs/2402.07867
- Xie J, Zhang K, Chen J, Lou R, Su Y. Adaptive Chameleon or Stubborn Sloth: Revealing the Behavior of Large Language Models in Knowledge Conflicts. ICLR 2024 Spotlight. https://arxiv.org/abs/2305.13300
- Longpre S, Perisetla K, Chen A, Ramesh N, DuBois C, Singh S. Entity-Based Knowledge Conflicts in Question Answering. EMNLP 2021. https://arxiv.org/abs/2109.05052
- Liu NF, Lin K, Hewitt J, Paranjape A, Bevilacqua M, Petroni F, Liang P. Lost in the Middle: How Language Models Use Long Contexts. TACL. https://arxiv.org/abs/2307.03172
- Joren H, Zhang J, Ferng C-S, Juan D-C, Taly A, Rashtchian C. Sufficient Context: A New Lens on Retrieval Augmented Generation Systems. arXiv:2411.06037. https://arxiv.org/abs/2411.06037
- Barnett S, Kurniawan S, Thudumu S, Brannelly Z, Abdelrazek M. Seven Failure Points When Engineering a Retrieval Augmented Generation System. arXiv:2401.05856. https://arxiv.org/abs/2401.05856
- Ngo NT, Nguyen CV, Dernoncourt F, Nguyen TH. Comprehensive and Practical Evaluation of Retrieval-Augmented Generation Systems for Medical Question Answering (MedRGB). arXiv:2411.09213. https://arxiv.org/abs/2411.09213
- Gilson A, et al. Enhancing Large Language Models with Domain-specific Retrieval Augment Generation: A Case Study on Long-form Consumer Health Question Answering in Ophthalmology. arXiv:2409.13902; PMC12478434. https://pmc.ncbi.nlm.nih.gov/articles/PMC12478434/
- Vishwanath K, Alyakin A, Alber DA, Lee JV, Kondziolka D, Oermann EK. Medical large language models are easily distracted. arXiv:2504.01201. https://arxiv.org/abs/2504.01201
- Caruzzo C, Yoo D, Kim TS. Deceptive Grounding: Entity Attribution Failure in Clinical Retrieval-Augmented Generation. arXiv:2607.09349. https://arxiv.org/abs/2607.09349
- Ji Y, Zhang H, Wang Y. Bias Evaluation and Mitigation in Retrieval-Augmented Medical Question-Answering Systems. arXiv:2503.15454. https://arxiv.org/abs/2503.15454
- Es S, James J, Espinosa-Anke L, Schockaert S. RAGAS: Automated Evaluation of Retrieval Augmented Generation. arXiv:2309.15217. https://arxiv.org/abs/2309.15217
- Gao T, Yen H, Yu J, Chen D. Enabling Large Language Models to Generate Text with Citations (ALCE). EMNLP 2023. https://arxiv.org/abs/2305.14627
- Bedi S, et al. MedHELM: Holistic Evaluation of Large Language Models for Medical Tasks. Nature Medicine. 2026;32:943-951. doi:10.1038/s41591-025-04151-2. arXiv:2505.23802. https://medhelm.org/
