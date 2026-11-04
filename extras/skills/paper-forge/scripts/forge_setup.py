"""Create a paper-forge run folder and freeze its inputs verbatim.

python -u forge_setup.py <args.json> [--force]

Reads the args file, creates <outDir> with the standard layout, and writes:
  input/forge_args.json          copy of the args
  input/DECISIONS_VERBATIM.md    every decisionFiles entry concatenated verbatim (80 KB cap per file, truncation marked)
  input/PORTFOLIO_BOUNDARIES.md  copy of args.boundariesFile, or a stub when none is given
  input/PAPER_LESSONS.md         copy of args.lessonsFile, default <skill>/references/PAPER_LESSONS.md (the 11-rule gate)
Refuses to run if outDir already has input/forge_args.json (no silent overwrite); pass --force to refresh inputs only.
Relative paths in the args resolve against the folder that holds the args file.
"""
import json, os, shutil, sys, datetime as dt
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
DEFAULT_LESSONS = SKILL_DIR / "references" / "PAPER_LESSONS.md"
CAP = 80_000
DIRS = ["input", "inventory", "analysis", "analysis/scripts", "experiments", "lit", "venue",
        "exemplars", "plan", "figures", "drafts", "review", "agents"]

BOUNDARIES_STUB = """# Portfolio boundaries

No portfolio boundaries file was supplied for this run. Treat the paper(s) in this run as the user's only claims on this data.
If you notice that a claim overlaps with another paper or preprint by the same author (found in the project folder or in memory),
do not resolve it yourself: list it in NEEDS_USER.md with the file that shows the overlap.
"""


def resolve(p, base):
    if not p:
        return None
    q = Path(os.path.expandvars(os.path.expanduser(p)))
    return q if q.is_absolute() else (base / q)


def main():
    argv = [a for a in sys.argv[1:] if a != "--force"]
    if not argv:
        sys.exit(__doc__)
    force = "--force" in sys.argv
    args_path = Path(argv[0]).resolve()
    base = args_path.parent
    with open(args_path, encoding="utf-8") as f:
        A = json.load(f)
    for key in ("outDir", "projectDir"):
        if not A.get(key):
            sys.exit(f"args file is missing '{key}'")
    out = resolve(A["outDir"], base)
    if (out / "input" / "forge_args.json").exists() and not force:
        sys.exit(f"{out} already set up; use --force to refresh inputs")
    for d in DIRS:
        (out / d).mkdir(parents=True, exist_ok=True)
    for p in A.get("papers", []):
        (out / "drafts" / p["id"]).mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args_path, out / "input" / "forge_args.json")

    parts = [f"# Decisions, deviations and corrections, quoted verbatim\n\nFrozen {dt.datetime.now():%Y-%m-%d %H:%M} by forge_setup.py. "
             "These files are quoted, not summarised. Where they conflict, the newer file wins; say which one you followed.\n"]
    missing = []
    files = A.get("decisionFiles", []) or []
    for raw in files:
        p = resolve(raw, base)
        if p is None or not p.exists():
            missing.append(raw)
            continue
        txt = p.read_text(encoding="utf-8", errors="replace")
        mtime = dt.datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d")
        note = ""
        if len(txt) > CAP:
            note = f"\n\n[TRUNCATED at {CAP} chars of {len(txt)}. The tail is usually the newest part: read the full file at {p}]\n"
            txt = txt[:CAP // 4] + "\n\n[... middle omitted ...]\n\n" + txt[-(CAP * 3 // 4):]
        parts.append(f"\n\n---\n\n## FILE: {p} (modified {mtime})\n\n{txt}{note}")
    if not files:
        parts.append("\n\nNo decision files were listed in the args.\n")
    if missing:
        parts.append("\n\n---\n\n## Missing files listed in args\n" + "\n".join(f"- {m}" for m in missing))
    with open(out / "input" / "DECISIONS_VERBATIM.md", "w", encoding="utf-8", newline="\n") as f:
        f.write("".join(parts))

    boundaries = resolve(A.get("boundariesFile"), base)
    if boundaries and boundaries.exists():
        shutil.copyfile(boundaries, out / "input" / "PORTFOLIO_BOUNDARIES.md")
    else:
        if boundaries:
            print(f"WARNING: boundariesFile {boundaries} missing; writing stub")
        with open(out / "input" / "PORTFOLIO_BOUNDARIES.md", "w", encoding="utf-8", newline="\n") as f:
            f.write(BOUNDARIES_STUB)

    lessons = resolve(A.get("lessonsFile"), base) or DEFAULT_LESSONS
    if lessons.exists():
        shutil.copyfile(lessons, out / "input" / "PAPER_LESSONS.md")
    else:
        print(f"WARNING: {lessons} missing; the 11-rule gate will not be in input/")

    print(f"set up {out}")
    print(f"decision files: {len(files) - len(missing)} copied, {len(missing)} missing")
    for m in missing:
        print(f"  MISSING {m}")


if __name__ == "__main__":
    main()
