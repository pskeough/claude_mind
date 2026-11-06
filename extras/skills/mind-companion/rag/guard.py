"""
Output-side safety gate.

Built in response to a measured failure, not a hypothetical one. With the safety
gate firing correctly, the right chunks retrieved, and an explicit instruction in
the system prompt not to answer a means enquiry, a 9B local model listed bridge
heights anyway. All three arms (full, prompt-only, control) failed identically,
so neither the scaffold nor the retrieval changed the behaviour at that scale.

The conclusion is that a prompt-side instruction is not a safety control. It is a
request, and a small model declines it. Anything that must not happen has to be
enforced deterministically on the output, after generation, where compliance is
not required.

This module does not judge quality. It answers one question: given that the
safety screen fired on the user's turn, does this reply supply something it must
not? If so the reply is blocked and never reaches the user.

    from rag.guard import check_reply
    verdict = check_reply(reply, cues)
"""
import re

# Patterns that constitute supplying means. Each is scoped to the cue families
# that make it dangerous, so a reply discussing medication adherence for a person
# with no means cue is not blocked.
MEANS_PATTERNS = [
    # A measurement attached to a structure, which is the bridge-height failure.
    (r"\b\d+\s*(m|metre|meter|meters|metres|ft|feet|foot|storey|stories|floors?)\b",
     "numeric height or measurement", {"possible means", "possible means enquiry"}),
    # Named tall structures enumerated, typically as a list.
    (r"\b(bridge|tower|building|rooftop|cliff|overpass|viaduct|car ?park|parking garage)\b",
     "named structure", {"possible means", "possible means enquiry"}),
    # Doses, quantities, and lethality framing.
    (r"\b\d+\s*(mg|mcg|g|grams?|ml|tablets?|pills?|capsules?)\b",
     "dose or quantity", {"possible means", "possible means enquiry", "suicidal ideation", "ending it"}),
    (r"\b(lethal|fatal|toxic|overdose)\s+(dose|amount|level|threshold|quantity)\b",
     "lethality quantification", None),
    (r"\b(how (much|many)|enough)\b.{0,30}\b(to (die|kill|be fatal)|would (kill|be lethal))\b",
     "lethality quantification", None),
    # Method instruction.
    (r"\b(you (could|can|should|would)|the (best|easiest|most effective) way)\b.{0,40}"
     r"\b(hang|jump|cut|overdose|suffocate|drown|asphyxiat)\w*",
     "method instruction", None),
    # Ligature and firearm specifics.
    (r"\b(ligature|noose|knot|rope strength|caliber|calibre|ammunition|load(ing)? (a|the) (gun|firearm))\b",
     "method specifics", None),
]

# A reply that only names a crisis service is not supplying means even if it
# contains digits, so phone numbers are excluded before matching.
PHONE_LIKE = re.compile(r"\b(1[38]00[\s\d]{3,}|13\s?\d\d\s?\d\d|\b988\b|116\s?123|000)\b")


def check_reply(reply, cues):
    """Return a verdict dict. `blocked` true means the reply must not be sent."""
    if not cues:
        return {"blocked": False, "reason": None, "matches": [], "screened": False}

    cueset = set(cues)
    scrubbed = PHONE_LIKE.sub(" ", reply)
    matches = []
    for pattern, label, applies_to in MEANS_PATTERNS:
        if applies_to and not (cueset & applies_to):
            continue
        m = re.search(pattern, scrubbed, re.IGNORECASE)
        if m:
            matches.append({"label": label, "text": m.group(0)[:60]})

    # A single structure noun in passing is not a violation; the failure mode is a
    # measurement or an enumeration. Require either a quantity match, or a
    # structure noun appearing more than twice, which is what a list looks like.
    quantitative = [m for m in matches if m["label"] in (
        "numeric height or measurement", "dose or quantity",
        "lethality quantification", "method instruction", "method specifics")]
    structure_count = len(re.findall(
        r"\b(bridge|tower|building|rooftop|cliff|overpass|viaduct)\b", scrubbed, re.IGNORECASE))

    blocked = bool(quantitative) or structure_count >= 3
    reason = None
    if blocked:
        reason = ("reply supplies means information on a safety-positive turn: %s"
                  % ", ".join(sorted({m["label"] for m in (quantitative or matches)})))

    return {"blocked": blocked, "reason": reason, "matches": matches,
            "structure_mentions": structure_count, "screened": True}


# A blocked reply is replaced, never simply dropped. The knowledge base is
# explicit that handing over a number and disengaging is experienced as rejection
# at the moment it is most dangerous, so the substitute has to stay in the
# conversation and do the actual work.
SUBSTITUTE = """I'm not going to answer that question, and I want to be honest about why rather than \
just deflecting.

You told me you lost your job, and then asked me something I can't read as neutral. I might be \
wrong, and if I am, tell me and I'll take it. But I'd rather ask directly than talk around it: \
are you thinking about hurting yourself?

I'm asking because it's the thing that matters here, and because asking doesn't make it worse. \
Losing work can take a lot more than income with it.

If you're in immediate danger, please call 000. Lifeline is 13 11 14, any hour, or you can text \
them on 0477 13 11 14.

I'm still here. What's been happening?"""


def enforce(reply, cues, substitute=None):
    """Apply the gate. Returns (final_reply, verdict)."""
    verdict = check_reply(reply, cues)
    if verdict["blocked"]:
        return (substitute or SUBSTITUTE), verdict
    return reply, verdict
