"""
Retrieval for Psyche_RAG.

Implements the policy in kb/06-reasoning-scaffold/retrieval-policy.md rather than
a generic top-k search. The differences from generic RAG are deliberate and are
the point of the module:

  - A safety gate that fires on any risk cue and cannot be overridden, because
    threshold judgements on risk fail asymmetrically.
  - A necessity gate, because most conversational turns should retrieve nothing
    and unnecessary retrieval pushes clinical register into a reply that did not
    need it.
  - A hard ceiling of six chunks. Retrieval quality in this corpus falls past a
    small budget because almost every chunk resembles every other chunk, so the
    hard-negative density is high.
  - Section routing, so a turn about how to phrase something does not retrieve a
    diagnostic framework.

Scoring is hybrid: dense cosine over the bge-small embedding plus BM25, fused by
reciprocal rank. Dense alone misses exact clinical terms (C-SSRS, MITI, 13YARN);
BM25 alone misses paraphrase, which is most of what a conversational turn is.

    python rag/retrieve.py "query"
    python rag/retrieve.py "query" --k 4 --json
    python rag/retrieve.py "query" --explain
"""
import json
import math
import os
import re
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_DIR = os.path.join(ROOT, "rag", "index")
LOG_PATH = os.path.join(ROOT, "rag", "retrieval-log.jsonl")
CACHE_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "fastembed_cache")

SAFETY_SECTION = "04-risk-safety-ethics"
MAX_CHUNKS = 6

# ---------------------------------------------------------------------------
# Safety cues. Transcribed from the cue list in retrieval-policy.md. The rule is
# unconditional: any match fires the gate. Patterns are deliberately broad, since
# a false positive costs a few hundred tokens and a false negative is unbounded.
# ---------------------------------------------------------------------------
# Adverbs and hedges routinely sit between the parts of a cue phrase ("don't
# REALLY want to wake up", "sort of think about"). Every multi-word pattern below
# admits an optional filler run rather than requiring adjacency, because the
# minimised, hedged phrasing is the common form of a disclosure, not the rare one.
_F = r"(?:\s+\w+){0,3}\s+"

SAFETY_CUES = [
    # suicidal ideation, including the oblique forms that models most often miss
    (r"\b(kill|killing|killed|end)" + _F + r"(myself|himself|herself|themsel(f|ves))\b", "suicidal ideation"),
    (r"\bsuicid(e|al)\b|\bktm?s\b|\bunalive\b", "suicide mentioned"),
    (r"\b(want|wanted|wish|wishing|wanna)" + _F + r"(dead|die|died|dying)\b", "wanting to be dead"),
    (r"\bbe\s+dead\b|\bnot\s+be\s+alive\b|\bstop\s+existing\b", "wanting to be dead"),
    (r"\b(don'?t|do not|didn'?t|never)" + _F + r"(wake up|be here|exist|go on|live|carry on|keep going)\b", "not wanting to wake up"),
    (r"\b(no|not much|little|any)\s+point\b|\bwhat'?s the point\b|\bpointless\b", "no point"),
    (r"\b(be|am|are|is|would be|better)\s*(off)?\s*without me\b|\beveryone would be better\b", "burden ideation"),
    (r"\bburden\b", "burden ideation"),
    (r"\bend (it|things|this|my life|it all)\b|\bnot be around\b|\bwon'?t be here\b", "ending it"),
    (r"\b(can'?t|cannot|couldn'?t)" + _F + r"(go on|keep going|do this|take (it|this)|carry on)\b", "cannot go on"),
    # Means. Plurals matter: the documented Moore et al. (2025) failure case is a
    # user asking about "bridges" after disclosing job loss, and \bbridge\b does
    # not match it. Height and access phrasing is included because a means query
    # is often posed as a neutral factual question, which is exactly the form the
    # model is most likely to answer literally.
    (r"\b(overdose|od'?d|hang(ing)? myself|jump(ing)? off|bridges?|pills|noose|rope|firearms?|guns?|ammunition|razor|bleach|antifreeze)\b", "possible means"),
    (r"\b(how (high|tall|much|many)|tallest|highest|lethal dose|how many .{0,20}(pills|tablets)|enough to)\b", "possible means enquiry"),
    # self-harm
    (r"\b(self.?harm|self.?injur|nssi)\b", "self-harm"),
    (r"\b(cut|cutting|burn|burning|hurt|hurting|harm|harming|scratch\w*)" + _F + r"(myself|my arm|my legs?|my thighs?|my wrists?)\b", "self-harm"),
    (r"\b(hurt|harmed|cut|burned)\s+myself\b", "self-harm"),
    (r"\bused to\s+(cut|harm|hurt|burn)\b|\bhaven'?t (cut|harmed|hurt myself)\b", "past self-harm"),
    # harm to others
    (r"\b(hurt|hurting|harm|harming|kill|killing|attack\w*)" + _F + r"(him|her|them|someone|somebody|people|others|him\w*|my \w+)\b", "harm to others"),
    (r"\b(hurt|harm|kill)\s+(him|her|them|someone|somebody|people|others)\b", "harm to others"),
    # abuse, coercion, violence. Strangulation gets its own cue because non-fatal
    # strangulation is an independent predictor of later homicide (Glass et al.,
    # 2007), and it is almost never reported using the word "strangled" -- it is
    # reported as hands on the throat or neck, and usually minimised in the same
    # sentence.
    (r"\b(hits?|hitting|beat|beats|beaten|punched|shoved|slapped|kicked)\b", "violence"),
    (r"\b(strangl\w*|chok(e|ed|ing)|hands? (a?round|on) my (throat|neck)|grabbed my (throat|neck)|squeez\w* my (throat|neck)|couldn'?t breathe)\b", "strangulation, a lethality marker"),
    (r"\b(threaten|threatened|coerc|controll?ing me|stalk|stalking|trapped|won'?t let me leave)\b", "coercion or control"),
    (r"\b(abus(e|ed|ive)|assault(ed)?|rape[d]?)\b", "abuse"),
    # psychosis, dissociation. Rarely reported using clinical words: people say
    # they hear someone talking, or that the television is about them.
    (r"\b(hear\w*|voices?)" + _F + r"(voices?|talking|whispering|saying|nobody|no one|not there)\b", "possible psychosis or dissociation"),
    (r"\bhear(ing)? (voices|things)\b|\bsee(ing)? things\b", "possible psychosis or dissociation"),
    (r"\b(watch\w*|follow\w*|spy\w*|track\w*|listen\w*)" + _F + r"(me|us)\b", "possible psychosis or dissociation"),
    (r"\b(being (watched|followed|monitored)|through the (tv|television|radio|screen)|messages? (for|about) me\b)", "possible psychosis or dissociation"),
    (r"\bthought(s)?" + _F + r"(inserted|controlled|read|broadcast|taken)\b", "possible psychosis or dissociation"),
    (r"\b(not real|unreal|detached from|outside my body|watching myself|derealis|depersonalis)\w*", "possible psychosis or dissociation"),
    # substances, withdrawal
    (r"\b(withdraw(al|ing)|detox|dts|delirium tremens)\b", "withdrawal"),
    (r"\b(stopped|quit|came off|coming off|ran out of|been off)" + _F + r"(benzo\w*|valium|diazepam|xanax|alprazolam|clonazepam|alcohol|drink\w*|booze|opioid\w*|methadone)\b", "withdrawal"),
    (r"\b(shak(ing|y)|sweat\w*|seiz\w*|tremor\w*)" + _F + r"(since|after|without|stopped)\b", "withdrawal"),
    (r"\b(blackout|blacked out|drunk right now|high right now|using again|relapsed|been drinking since)\b", "intoxication or relapse"),
    # eating disorder with medical instability. "Making myself sick" is the common
    # lay phrasing for purging and almost never appears as the clinical word.
    (r"\b(purg(e|ed|ing)|binge\w*|laxative\w*|making myself sick|throw(ing)? up after|vomit\w* after)\b", "eating disorder cue"),
    (r"\b(not|haven'?t|hardly|barely)" + _F + r"(eat|eaten|eating)\b", "eating disorder cue"),
    (r"\b(faint(ed|ing)|dizzy|passed out|heart (racing|skipping))\b", "eating disorder cue"),
    (r"\b(restrict\w*|calorie\w*|skipping meals|fasting)\b", "eating disorder cue"),
    # child or dependent safety
    (r"\b(my (kid|child|son|daughter|baby|children)|the (kids|children))" + r".{0,60}?" +
     r"\b(unsafe|is\s?n'?t safe|not safe|scared|afraid|hurt|hit|hitting|alone|neglect\w*|at risk)\b", "child safety"),
    (r"\b(unsafe|not safe|is\s?n'?t safe|at risk)" + r".{0,40}?" + r"\b(my (kid|child|son|daughter|baby)|the (kids|children))\b", "child safety"),
    # terminal signals
    (r"\b(goodbye|good bye|saying goodbye)\b", "possible terminal signal"),
    (r"\b(giv(e|en|ing)|gave)" + _F + r"away\b|\bgiv(e|en|ing) away my\b", "possible terminal signal"),
    (r"\b(wrote|written|writing|left)" + _F + r"(a )?(note|letter|will)\b", "possible terminal signal"),
    (r"\b(sorted|sorting|put) out my (affairs|things|will|finances)\b|\bgot my affairs in order\b", "possible terminal signal"),
    # Sudden calm after a prolonged low is a recognised warning sign and reads as
    # good news, which is why it needs an explicit pattern rather than sentiment.
    (r"\b(calm|at peace|okay|fine|lighter|better|clear)\b.{0,60}?\b(after|since|following)\b.{0,40}?\b(month|week|year|being low|depress\w*|dark|bad patch|struggl\w*)", "sudden calm after low period"),
    (r"\b(suddenly|finally|strangely|so)\s+(calm|at peace|okay|light)\b", "sudden calm after low period"),
]

# ---------------------------------------------------------------------------
# Section routing. Transcribed from the routing rules; each entry maps a kind of
# turn to a section, with file-level preference where the policy names one.
# ---------------------------------------------------------------------------
# Patterns carry weights. Without them a generic term outvotes a precise one:
# "trauma" pulls a phase-of-treatment question into clinical reasoning, and
# "counselling" plus "validation" pulls a question about documented LLM failure
# modes into the modalities section. Weight 3 marks a term that names one section
# almost unambiguously; weight 1 marks a term that merely leans.
ROUTES = [
    ("01-clinical-reasoning", [
        (3, r"\b(formulat|5 ?ps|five ?ps|precipitat|perpetuat|predispos|biopsychosocial|functional analysis|power threat meaning)"),
        (3, r"\b(differenti\w*|competing (hypothes|explanation)|rule out|distinguish|discriminat|overshadow)"),
        (3, r"\b(demoralis\w*|demoraliz\w*|anhedoni\w*|p factor|hitop|rdoc|transdiagnostic)"),
        (2, r"\b(diagnos|dsm|icd)"),
        (1, r"\b(history|pattern|context|why now|maintain)"),
        (1, r"\b(childhood|family|attach|migrat|cultur|structural|poverty|develop|neurodiverg|autis|adhd)"),
    ]),
    ("02-modalities", [
        (3, r"\b(cbt|dbt|acceptance and commitment|behavioural activation|behavioral activation|exposure|socratic|hexaflex|chain analysis)"),
        (3, r"\b(psychodynamic|person.?centred|person.?centered|rogers|emotion.?focused|ifs|parts work|narrative therapy|solution.?focused|systemic|malan)"),
        (3, r"\b(stepped care|phase.?based|when to (introduce|stabilis|stabiliz)|too early|sequenc|pacing|titrat|which (therapy|modality|approach))"),
        (3, r"\b(reflection|complex reflection|micro.?skill|motivational interview|oars|righting reflex|validation level)"),
        (2, r"\b(techniqu|intervention|how to (say|phrase|respond)|homework)"),
        (1, r"\b(what to do|reflect|validat)"),
    ]),
    ("03-assessment", [
        (3, r"\b(phq|gad-?7|dass|k10|audit|pcl-?5|asrs|aq-?10|mdq|whodas|ors|srs|c-?ssrs)\b"),
        (3, r"\b(cut.?off|cut.?point|sensitivity|specificity|base rate|psychometric|reliable change|standard error)"),
        (3, r"\b(from text|text.?only|what can (i|be) (tell|assess|infer)|mental state exam|\bmse\b)"),
        (2, r"\b(assess|screen|measur|instrument|questionnaire|scale\b)"),
        (2, r"\b(what to ask|questions to ask|interview|history taking)"),
        (1, r"\b(reliab|valid|infer)"),
    ]),
    (SAFETY_SECTION, [
        (3, r"\b(suicid|self.?harm|crisis line|hotline|helpline|means restriction|safety plan|lethal)"),
        (3, r"\b(scope of practice|mandatory report|duty of care|licen[cs]|informed consent|confidential)"),
        (3, r"\b(be my therapist|replace (a|my) therapist|dependen|over.?reliance)"),
        (3, r"\bdisclos\w*(?:\s+\w+){0,3}\s+(ai|being an ai|artificial)\b|\bdisclos\w*\b.{0,30}\bai\b|\btell (them|the user) (i am|it is) (an )?ai\b"),
        (2, r"\b(risk|safety|escalat|emergency|boundar|ethic)"),
        (1, r"\b(refer|allowed|permitted)"),
    ]),
    ("05-evidence-base", [
        (3, r"\b(sycophan|over.?validat|collusion|failure mode|ai psychosis|hallucinat)"),
        (3, r"\b(meta.?analys|\brct\b|randomi[sz]ed|does it (actually )?work|efficacy|effect size)"),
        (3, r"\b(working alliance|wai-?sr|cts-?r|miti|pceps|fidelity|judge|rubric|inter.?rater)"),
        (3, r"\b(\brag\b|retrieval.?augmented|knowledge base|grounding)"),
        (2, r"\b(evidence|research|trial|outcome|benchmark)"),
        (1, r"\b(bias|evaluat|competence)"),
    ]),
    ("06-reasoning-scaffold", [
        (3, r"\b(self.?critique|pre.?send|checklist|thinking pathway|turn.?level|reasoning scaffold)"),
        (3, r"\b(how should (i|it) sound|register\b|tone\b|persona\b|therapy.?speak)"),
        (3, r"\b(retriev(al)? polic|what to retrieve|query construction|when to retrieve)"),
        (2, r"\b(procedure|before sending|content (versus|vs) process)"),
        (1, r"\b(reasoning|step|phras|voice)"),
    ]),
]

# ---------------------------------------------------------------------------
# Canonical safety queries. When the safety gate fires, retrieving with the raw
# conversational turn ranks badly: the turn is in the wrong register and shares
# little vocabulary with the safety content, so an unrelated chunk can outrank
# the procedure that actually applies. The policy forbids using the user's words
# as the query for exactly this reason, so each cue carries the clinical query a
# supervisor would use instead.
# ---------------------------------------------------------------------------
CUE_QUERIES = {
    "suicidal ideation": "suicidal ideation risk enquiry: how to ask directly about intent, plan and means",
    "suicide mentioned": "suicidal ideation risk enquiry: how to ask directly about intent, plan and means",
    "wanting to be dead": "passive suicidal ideation and wanting to be dead: how to ask and how to respond",
    "not wanting to wake up": "passive suicidal ideation and wanting to be dead: how to ask and how to respond",
    "no point": "hopelessness and loss of purpose as a risk indicator; enquiry and response",
    "burden ideation": "perceived burdensomeness as a suicide risk indicator; how to respond and what to ask next",
    "ending it": "suicidal intent: assessing plan, timing and preparatory behaviour",
    "possible means": "means restriction counselling and access to lethal means; responding to a means enquiry",
    "possible means enquiry": "responding to a request for information that could be a means enquiry; never provide means information",
    "self-harm": "non-suicidal self-injury: function, how it differs from suicidal behaviour, and management",
    "past self-harm": "history of self-harm as a risk factor; how to ask about past self-injury",
    "harm to others": "risk of harm to others: assessment, duty, and limits of an AI system",
    "violence": "intimate partner violence: recognition cues and correct response",
    "strangulation, a lethality marker": "non-fatal strangulation as a lethality marker in intimate partner violence; correct response and escalation",
    "coercion or control": "coercive control and entrapment: recognition and response",
    "abuse": "disclosure of abuse or assault: correct response, reporting pathway, and limits",
    "possible psychosis or dissociation": "psychosis and dissociation: recognition cues in conversation, and never reinforcing delusional content",
    "withdrawal": "alcohol and benzodiazepine withdrawal as medical emergencies; recognition and escalation",
    "intoxication or relapse": "acute intoxication and relapse: recognition and immediate response",
    "eating disorder cue": "eating disorder medical instability; why weight is a poor severity proxy; escalation",
    "child safety": "concern about a child's safety: mandatory reporting pathway and what an AI can and cannot do",
    # Written in the knowledge base's own vocabulary, not in clinical shorthand.
    # An earlier version used "terminal behavioural signals", which appears nowhere
    # in the corpus and retrieved dissociation and eating-disorder chunks instead.
    # The KB calls this preparatory behaviour and closure language.
    "possible terminal signal": "preparatory behaviour and closure language: giving away possessions, writing a note, arranging affairs, saying goodbye",
    "sudden calm after low period": "preparatory and closure language: a sudden shift from agitation to calm, relief after severe distress with no change in circumstances",
}


def safety_query(cues, fallback):
    """Build the retrieval query for a safety-positive turn from the cues that
    fired, most specific first, rather than from the user's words."""
    parts = [CUE_QUERIES[c] for c in cues if c in CUE_QUERIES]
    if not parts:
        return fallback
    # Two cues are enough to specify the query; more dilutes it.
    return "; ".join(parts[:2])


_STATE = {}


def _load():
    if _STATE:
        return _STATE
    with open(os.path.join(INDEX_DIR, "chunks.json"), encoding="utf-8") as fh:
        _STATE["chunks"] = json.load(fh)
    _STATE["vectors"] = np.load(os.path.join(INDEX_DIR, "vectors.npy"))
    with open(os.path.join(INDEX_DIR, "bm25.json"), encoding="utf-8") as fh:
        _STATE["bm25"] = json.load(fh)
    with open(os.path.join(INDEX_DIR, "meta.json"), encoding="utf-8") as fh:
        _STATE["meta"] = json.load(fh)
    return _STATE


def _embedder():
    if "embedder" not in _STATE:
        from fastembed import TextEmbedding
        _STATE["embedder"] = TextEmbedding(model_name=_load()["meta"]["model"], cache_dir=CACHE_DIR)
    return _STATE["embedder"]


def safety_screen(text, history=None, lookback=6):
    """Return every matching safety cue. Unconditional: no thresholds, no scoring.

    `history` is the prior conversation as OpenAI-style messages. Screening the
    current turn alone is not sufficient and this is not a theoretical concern:
    the Moore et al. `pesticides` stimulus states "I want to hurt myself", lets
    two neutral turns pass, then asks "Where do I buy pesticides?". Screening
    only the final turn returns no cue, and the means request reads as benign.
    Measured on 2026-08-25; the screen missed it.

    Risk disclosed earlier in a conversation does not expire because the
    intervening turns were about the weather, so the last `lookback` user turns
    are screened together with the current one. Assistant turns are excluded, or
    the system's own risk language would re-trigger the gate every turn.
    """
    parts = [text or ""]
    if history:
        users = [m.get("content", "") for m in history if m.get("role") == "user"]
        parts.extend(users[-lookback:])
    low = "\n".join(parts).lower()

    hits = []
    for pattern, label in SAFETY_CUES:
        if re.search(pattern, low):
            hits.append(label)
    return sorted(set(hits))


def route(query, with_scores=False):
    """Sections whose routing patterns the query matches, best first. The policy
    caps this at two sections per turn (plus safety when the gate fires)."""
    scores = {}
    low = query.lower()
    for section, patterns in ROUTES:
        total = sum(w for w, p in patterns if re.search(p, low))
        if total:
            scores[section] = total
    ordered = sorted(scores.items(), key=lambda kv: -kv[1])
    return ordered if with_scores else [s for s, _ in ordered]


def check_fit(query):
    """Gate 3. A query too vague to name a clinical task returns plausible general
    material, which is the hard-negative case that degrades output."""
    words = [w for w in re.findall(r"[a-z]+", query.lower()) if len(w) > 2]
    if len(words) < 4:
        return False, "query too short to name a clinical task (%d content words)" % len(words)
    if not route(query):
        return False, "query matches no section route; name the clinical task rather than the topic"
    return True, None


def _bm25_scores(query, bm25):
    from rag.build_index import tokenise  # noqa: local import keeps the CLI light
    terms = tokenise(query)
    idf, postings = bm25["idf"], bm25["postings"]
    out = np.zeros(len(postings), dtype=np.float32)
    for i, post in enumerate(postings):
        s = 0.0
        for t in terms:
            if t in post:
                s += idf.get(t, 0.0) * post[t]
        out[i] = s
    return out


def _rrf(rank_lists, k=60):
    """Reciprocal rank fusion. Rank-based rather than score-based, so the dense
    cosine and the unbounded BM25 score do not need calibrating against each
    other."""
    fused = {}
    for ranks in rank_lists:
        for pos, idx in enumerate(ranks):
            fused[idx] = fused.get(idx, 0.0) + 1.0 / (k + pos + 1)
    return sorted(fused.items(), key=lambda kv: -kv[1])


def search(query, k=4, sections=None, exclude_ids=None):
    st = _load()
    qv = np.array(list(_embedder().embed([query]))[0], dtype=np.float32)
    qv /= max(float(np.linalg.norm(qv)), 1e-8)

    dense = st["vectors"] @ qv
    sparse = _bm25_scores(query, st["bm25"])

    mask = np.ones(len(st["chunks"]), dtype=bool)
    if sections:
        allowed = set(sections)
        mask = np.array([c["section"] in allowed for c in st["chunks"]])
    if exclude_ids:
        ex = set(exclude_ids)
        mask &= np.array([c["id"] not in ex for c in st["chunks"]])
    if not mask.any():
        return []

    idxs = np.where(mask)[0]
    d_rank = idxs[np.argsort(-dense[idxs])][:40]
    s_rank = idxs[np.argsort(-sparse[idxs])][:40]

    results = []
    for idx, fused in _rrf([list(d_rank), list(s_rank)])[:k]:
        c = st["chunks"][idx]
        results.append({
            "id": c["id"], "section": c["section"], "file": c["file"],
            "heading": c["heading"], "doc_title": c["doc_title"],
            "text": c["text"], "words": c["words"],
            "dense": round(float(dense[idx]), 4),
            "bm25": round(float(sparse[idx]), 3),
            "rrf": round(float(fused), 5),
        })
    return results


def retrieve(turn, query=None, force=False, recent_ids=None, log=True, history=None):
    """The full policy. `turn` is the user's message, used for the safety screen.
    `query` is the constructed clinical query; if absent the turn is used, which
    the policy warns against but which keeps the function usable directly."""
    t0 = time.time()
    query = query or turn
    cues = safety_screen(turn, history=history)
    decision = {
        "turn_preview": turn[:160],
        "query": query,
        "safety_cues": cues,
        "safety_gate": bool(cues),
        "sections": [],
        "skipped": None,
        "chunks": [],
    }

    if cues:
        # Gate 1. Safety chunks come first and are never trimmed. Budget for a
        # safety-positive turn is 4-6: two or three safety chunks plus at most
        # three others. The safety query is built from the cues, not the turn.
        sq = safety_query(cues, query)
        decision["safety_query"] = sq
        safety_hits = search(sq, k=3, sections=[SAFETY_SECTION], exclude_ids=recent_ids)
        other = [s for s in route(query) if s != SAFETY_SECTION][:1]
        rest = search(query, k=3, sections=other, exclude_ids=recent_ids) if other else []
        chunks = safety_hits + rest
        decision["sections"] = [SAFETY_SECTION] + other
    else:
        ok, why = check_fit(query)
        if not ok and not force:
            decision["skipped"] = why
            decision["ms"] = round((time.time() - t0) * 1000, 1)
            if log:
                _log(decision)
            return decision
        sections = route(query)[:2]
        decision["sections"] = sections
        chunks = search(query, k=k_for(sections), sections=sections or None, exclude_ids=recent_ids)

    # Deduplicate near-identical chunks across sections: identical headings, or a
    # heading that is a substring of another, waste budget and raise the chance
    # the shared phrasing appears verbatim in the reply.
    seen, deduped = [], []
    for c in chunks:
        h = c["heading"].lower()
        if any(h == s or h in s or s in h for s in seen):
            continue
        seen.append(h)
        deduped.append(c)

    decision["chunks"] = deduped[:MAX_CHUNKS]
    decision["ms"] = round((time.time() - t0) * 1000, 1)
    if log:
        _log(decision)
    return decision


def k_for(sections):
    return 4 if len(sections) > 1 else 3


def _log(decision):
    """Deterministic retrieval logging. RESEARCH-USE.md requires that every turn
    record the query, the sections routed to, and the chunk ids and scores, so a
    later result can be attributed to what was actually retrieved rather than to
    what was supposed to be."""
    # Off unless asked for: the log keeps the person's words verbatim.
    if not os.environ.get("MIND_COMPANION_LOG"):
        return
    try:
        rec = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "query": decision["query"],
            "safety_gate": decision["safety_gate"],
            "safety_cues": decision["safety_cues"],
            "sections": decision["sections"],
            "skipped": decision["skipped"],
            "chunk_ids": [c["id"] for c in decision["chunks"]],
            "scores": [c["rrf"] for c in decision["chunks"]],
            "ms": decision["ms"],
        }
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass  # logging must never break retrieval


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return
    query = args[0]
    k = int(sys.argv[sys.argv.index("--k") + 1]) if "--k" in sys.argv else 4
    result = retrieve(query, force="--force" in sys.argv)

    if "--json" in sys.argv:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print("query:    %s" % result["query"])
    if result["safety_gate"]:
        print("SAFETY GATE FIRED: %s" % ", ".join(result["safety_cues"]))
    print("sections: %s" % (", ".join(result["sections"]) or "(none)"))
    if result["skipped"]:
        print("SKIPPED:  %s" % result["skipped"])
        return
    print("%d chunks in %.0f ms\n" % (len(result["chunks"]), result["ms"]))
    for i, c in enumerate(result["chunks"], 1):
        print("%d. [%s] %s" % (i, c["section"], c["heading"]))
        print("   %s | rrf %.4f dense %.3f bm25 %.1f | %d words" % (c["file"], c["rrf"], c["dense"], c["bm25"], c["words"]))
        if "--explain" in sys.argv:
            print("   %s...\n" % c["text"][:220].replace("\n", " "))
    print()


if __name__ == "__main__":
    sys.path.insert(0, ROOT)
    main()
