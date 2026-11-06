"""
Assemble the system prompt for one turn.

Retrieval returns chunks; this turns them into something a model can run on. The
assembly order is not cosmetic. Material at the beginning and end of a context is
used more reliably than material in the middle (Liu et al., 2024), so:

    scope statement          the model needs a settled identity first, because
                             most guardrail failures follow identity drift
    turn procedure           the eight steps, lifted verbatim from the KB
    standing constraints     what it must never do, with reasons
    SAFETY BLOCK             first among retrieved material when the gate fires
    retrieved chunks         aim-governing section first, support after
    pre-send checklist       last, so it sits in the recency position it needs

The scaffold text and the retrieved content are assembled from separate sources
and neither is baked into the other. That separation is decision D007 and it is
what makes a prompt-only versus retrieval-only ablation possible later.

    python rag/assemble.py "user turn" [--query "clinical query"] [--no-kb]
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from rag.retrieve import retrieve  # noqa: E402

KB = os.path.join(ROOT, "kb")

SCOPE = """You are a reflective conversational partner with clinical-psychology training encoded \
as a retrieved knowledge base. You are not a registered psychologist. You hold no licence, carry \
no duty of care, and no one supervises your work. You cannot assess, diagnose, prescribe, or act \
in the physical world.

Fluent clinical language creates an impression of expertise that nothing behind you backs up. That \
impression is the main risk you carry, so prefer plain speech over clinical vocabulary, and say \
plainly when something needs a person."""


def _extract(path, heading_startswith):
    """Pull one `##` section out of a knowledge base file by heading prefix."""
    with open(os.path.join(KB, path), encoding="utf-8") as fh:
        text = fh.read()
    parts = re.split(r"^## (.+)$", text, flags=re.MULTILINE)
    for i in range(1, len(parts), 2):
        if parts[i].strip().lower().startswith(heading_startswith.lower()):
            return parts[i].strip(), parts[i + 1].strip()
    return None, None


def build(turn, query=None, include_kb=True, include_scaffold=True, recent_ids=None, history=None):
    """Assemble the prompt. `include_scaffold` and `include_kb` are the two
    independent switches the ablation design needs: scaffold-only, retrieval-only,
    both, or neither."""
    blocks, meta = [], {}

    if include_scaffold:
        blocks.append("# Who you are\n\n" + SCOPE)

        h, body = _extract("06-reasoning-scaffold/thinking-pathway.md", "The turn-level procedure")
        if body:
            blocks.append("# The procedure you run on every turn\n\n" + body)

        h, body = _extract("04-risk-safety-ethics/guardrails-and-disclosure.md", "Standing behavioural constraints")
        if body:
            blocks.append("# Standing constraints\n\n" + body)

    decision = retrieve(turn, query=query, recent_ids=recent_ids, history=history) if include_kb else {
        "safety_gate": False, "safety_cues": [], "sections": [], "chunks": [], "skipped": "kb disabled", "query": query or turn,
    }
    meta["retrieval"] = {
        "safety_gate": decision["safety_gate"],
        "safety_cues": decision["safety_cues"],
        "sections": decision["sections"],
        "chunk_ids": [c["id"] for c in decision["chunks"]],
        "skipped": decision.get("skipped"),
    }

    if decision["safety_gate"]:
        blocks.append(
            "# SAFETY: this turn contains a risk cue\n\n"
            "Cues detected: %s.\n\n"
            "This overrides everything else. Respond to the risk before you respond to the surface "
            "question. Do not answer the literal request if answering it would supply means or "
            "bypass the cue. Do not hand over a phone number and stop engaging. A positive screen "
            "must change the shape of your reply, not append a disclaimer to it."
            % ", ".join(decision["safety_cues"]))

    if decision["chunks"]:
        parts = []
        for c in decision["chunks"]:
            parts.append("## %s\n_source: %s / %s_\n\n%s" % (c["heading"], c["section"], c["file"], c["text"]))
        blocks.append(
            "# Retrieved reference material\n\n"
            "This is reference for your reasoning, not text to quote. Do not reproduce its "
            "vocabulary in your reply and do not consult it while drafting.\n\n" + "\n\n---\n\n".join(parts))

    if include_scaffold:
        h, body = _extract("04-risk-safety-ethics/guardrails-and-disclosure.md", "The pre-send checklist")
        if body:
            blocks.append("# Before you send\n\n" + body)

    prompt = "\n\n".join(blocks)
    meta["chars"] = len(prompt)
    meta["approx_tokens"] = len(prompt) // 4
    return prompt, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("turn")
    ap.add_argument("--query", default=None, help="constructed clinical query; defaults to the turn")
    ap.add_argument("--no-kb", action="store_true", help="ablation: scaffold only, no retrieval")
    ap.add_argument("--no-scaffold", action="store_true", help="ablation: retrieval only, no scaffold")
    ap.add_argument("--meta", action="store_true", help="print assembly metadata instead of the prompt")
    args = ap.parse_args()

    prompt, meta = build(args.turn, query=args.query,
                         include_kb=not args.no_kb, include_scaffold=not args.no_scaffold)
    if args.meta:
        print(json.dumps(meta, indent=2))
    else:
        print(prompt)


if __name__ == "__main__":
    main()
