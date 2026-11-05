#!/usr/bin/env python3
"""Build the coverage table at the end of testing-guide.md.

Reads every acceptance criterion whose `testable_by` is integration or manual
from docs/backlog/epics/*.json, and maps it to the scenarios whose `Covers:`
line names it, or to the "Not testable by clicking" appendix.

  python3 docs/qa/coverage.py --write   rewrite the table in the guide
  python3 docs/qa/coverage.py --check   exit 1 when the guide is incomplete or stale
"""
import glob
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUIDE = ROOT / "docs/qa/testing-guide.md"
HUMAN_KINDS = {"integration", "manual"}
AC_ID = re.compile(r"AC-[A-Z]+-\d+\.\d+")


def criteria() -> dict:
    """Every AC id in the epics, with its testable_by."""
    found = {}
    for path in sorted(glob.glob(str(ROOT / "docs/backlog/epics/*.json"))):
        for story in json.load(open(path)).get("stories", []):
            for ac in story["acceptance_criteria"]:
                found[ac["id"]] = ac["testable_by"]
    return found


def between(text: str, name: str) -> tuple[int, int]:
    start = text.index(f"<!-- {name}:start -->") + len(f"<!-- {name}:start -->")
    return start, text.index(f"<!-- {name}:end -->")


def parse(text: str) -> tuple[dict, dict]:
    """Scenario -> AC ids from `Covers:` lines, and appendix AC -> reason."""
    covers, scenario = {}, None
    for line in text.splitlines():
        heading = re.match(r"#+ (QA-[A-Z]+-\d+)", line)
        if heading:
            scenario = heading.group(1)
        elif line.startswith("- Covers:") and scenario:
            covers.setdefault(scenario, []).extend(AC_ID.findall(line))
    start, end = between(text, "appendix")
    appendix = {}
    for row in text[start:end].splitlines():
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        if len(cells) == 2 and AC_ID.fullmatch(cells[0]):
            appendix[cells[0]] = cells[1]
    return covers, appendix


def build(text: str) -> tuple[str, list]:
    known = criteria()
    covers, appendix = parse(text)
    problems = []
    by_ac = {}
    for scenario, ids in covers.items():
        for ac in ids:
            by_ac.setdefault(ac, []).append(scenario)
    for ac in sorted(set(by_ac) | set(appendix)):
        if ac not in known:
            problems.append(f"{ac} is named in the guide but does not exist in the epics")
    for ac, reason in appendix.items():
        if not reason:
            problems.append(f"{ac} is in the appendix with no reason")
        if ac in by_ac:
            problems.append(f"{ac} is both in the appendix and on a Covers line")
    defined = set(re.findall(r"^#+ (QA-[A-Z]+-\d+)", text, re.M))
    for ref in sorted(set(re.findall(r"QA-[A-Z]+-\d+", text)) - defined):
        problems.append(f"{ref} is referred to but no scenario has that id")

    human = [ac for ac, kind in known.items() if kind in HUMAN_KINDS]
    rows, clicked, listed = [], 0, 0
    for ac in sorted(human, key=sort_key):
        if ac in by_ac:
            clicked += 1
            rows.append(f"| {ac} | {known[ac]} | {', '.join(by_ac[ac])} |")
        elif ac in appendix:
            listed += 1
            rows.append(f"| {ac} | {known[ac]} | not testable by clicking |")
        else:
            problems.append(f"{ac} ({known[ac]}) has no scenario and is not in the appendix")
            rows.append(f"| {ac} | {known[ac]} | MISSING |")
    extra = sorted({ac for ac in by_ac if known.get(ac) == "unit"}, key=sort_key)
    table = "\n".join(
        [
            f"{len(human)} integration and manual criteria: {clicked} covered by a scenario, {listed} listed as not testable by clicking."
            + (f" Scenarios also touch {len(extra)} unit criteria, not listed here." if extra else ""),
            "",
            "| AC | testable_by | Scenario |",
            "|---|---|---|",
            *rows,
        ]
    )
    start, end = between(text, "coverage")
    return text[:start] + "\n" + table + "\n" + text[end:], problems


def sort_key(ac: str):
    epic, story, criterion = re.match(r"AC-([A-Z]+)-(\d+)\.(\d+)", ac).groups()
    return epic, int(story), int(criterion)


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "--check"
    text = GUIDE.read_text()
    updated, problems = build(text)
    for problem in problems:
        print(f"coverage: {problem}", file=sys.stderr)
    if mode == "--write":
        GUIDE.write_text(updated)
    elif updated != text:
        print("coverage: the table in testing-guide.md is stale; run --write", file=sys.stderr)
        return 1
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
