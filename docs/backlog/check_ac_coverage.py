#!/usr/bin/env python3
"""Check that every acceptance criterion marked `pass` is named by a test.

The convention is that a test which settles a criterion names that criterion's
id in its `describe(...)` or `it(...)` title:

    it("AC-NOTE-03.5: creates every missing intermediate folder, top down")

Nothing enforced it, so a criterion could read `pass` with evidence citing a
test name while no test named it. The verdict then had nothing holding it in
place, and a later refactor could delete the test in silence.

    python3 check_ac_coverage.py                 exit 1 when a problem is found
    python3 check_ac_coverage.py --report-only   always exit 0, still print
    python3 check_ac_coverage.py --self-check    prove this script works

Two failure modes, and they are not symmetric:

  unbacked verdict    a criterion reads `pass`, no test title names its id
  dangling reference  a test title names an id no epic file defines

A criterion that is `unverified`, `n-a` or `fail` with no test is NOT a
problem. Several criteria here are legitimately untestable in this environment
(AC-CAL-01.5 wants a jsdom harness, parts of US-CMD-01 want a live Obsidian
host). A gate demanding universal coverage would be permanently red for honest
reasons, which teaches everyone to ignore it. This gates consistency with the
recorded verdict, not coverage.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).parent
EPICS_DIR = HERE / "epics"
REPO_ROOT = HERE.parent.parent

AC_IN_TITLE = re.compile(r"\bAC-[A-Z]+-\d{2}\.\d+\b")


def load_criteria(epics_dir):
    """Every criterion in the catalogue, as (epic, story_id, ac_id, status)."""
    out = []
    for path in sorted(epics_dir.glob("*.json")):
        data = json.loads(path.read_text())
        for story in data.get("stories", []):
            for ac in story.get("acceptance_criteria", []):
                out.append((data["epic"], story["id"], ac["id"],
                            ac.get("status", "unverified")))
    return out


def test_titles(root):
    """Full test titles from a real vitest run.

    A run rather than a grep of the sources, because a title assembled at
    runtime — a `describe.each` table, a template literal — still counts as
    naming its criterion, and static parsing would miss it.
    """
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        report = pathlib.Path(tmp.name)
    try:
        proc = subprocess.run(
            ["npx", "vitest", "run", "--reporter=json",
             f"--outputFile={report}"],
            cwd=root, capture_output=True, text=True,
        )
        if not report.exists() or not report.stat().st_size:
            sys.exit("vitest produced no JSON report:\n"
                     + (proc.stderr or proc.stdout))
        data = json.loads(report.read_text())
    finally:
        report.unlink(missing_ok=True)
    return [a["fullName"]
            for suite in data.get("testResults", [])
            for a in suite.get("assertionResults", [])]


def tagged_ids(titles):
    return {m for t in titles for m in AC_IN_TITLE.findall(t)}


def check(criteria, tagged):
    """(unbacked, dangling). Pure, so --self-check can drive it directly."""
    known = {ac_id for _, _, ac_id, _ in criteria}
    unbacked = [c for c in criteria if c[3] == "pass" and c[2] not in tagged]
    dangling = sorted(tagged - known)
    return unbacked, dangling


def report(unbacked, dangling, total_tagged):
    print(f"AC coverage: {total_tagged} criteria named by tests, "
          f"{len(unbacked)} unbacked, {len(dangling)} dangling\n")

    if unbacked:
        print(f"UNBACKED VERDICTS ({len(unbacked)}) — "
              "marked `pass`, no test names the id")
        last_story = None
        for epic, story_id, ac_id, _ in unbacked:
            if story_id != last_story:
                print(f"  {epic} / {story_id}")
                last_story = story_id
            print(f"    {ac_id}")
        print()

    if dangling:
        print(f"DANGLING REFERENCES ({len(dangling)}) — "
              "named by a test, defined by no epic file")
        for ac_id in dangling:
            print(f"    {ac_id}")
        print()

    if not unbacked and not dangling:
        print("No problems.")


def self_check():
    """Catches both failure modes, stays quiet on an honest `unverified`."""
    catalogue = [
        ("NOTE", "US-NOTE-03", "AC-NOTE-03.1", "pass"),
        ("NOTE", "US-NOTE-03", "AC-NOTE-03.2", "pass"),
        ("NOTE", "US-NOTE-03", "AC-NOTE-03.3", "unverified"),
        ("CAL", "US-CAL-01", "AC-CAL-01.5", "n-a"),
        ("CAL", "US-CAL-01", "AC-CAL-01.6", "fail"),
    ]
    tagged = tagged_ids([
        "noteCreate > AC-NOTE-03.1: creates the folder",
        "noteCreate > AC-NOTE-99.9: renumbered away",
        "no criterion in this title at all",
    ])
    assert tagged == {"AC-NOTE-03.1", "AC-NOTE-99.9"}, tagged

    unbacked, dangling = check(catalogue, tagged)

    assert [c[2] for c in unbacked] == ["AC-NOTE-03.2"], unbacked
    assert dangling == ["AC-NOTE-99.9"], dangling

    # The asymmetry this gate exists for: an untestable criterion with no test
    # is honest, so unverified / n-a / fail must never appear above.
    quiet = {"AC-NOTE-03.3", "AC-CAL-01.5", "AC-CAL-01.6"}
    assert quiet.isdisjoint({c[2] for c in unbacked}), unbacked

    # And a `pass` that IS named stays quiet too, or the gate is just noise.
    assert check(catalogue[:1], {"AC-NOTE-03.1"}) == ([], [])

    print("self-check passed: both failure modes caught, honest gaps quiet")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--report-only", action="store_true",
                    help="print the findings but always exit 0")
    ap.add_argument("--self-check", action="store_true",
                    help="run this script's own assertions and exit")
    args = ap.parse_args()

    if args.self_check:
        self_check()
        return 0

    criteria = load_criteria(EPICS_DIR)
    tagged = tagged_ids(test_titles(REPO_ROOT))
    unbacked, dangling = check(criteria, tagged)
    report(unbacked, dangling, len(tagged))

    if args.report_only:
        print("report-only: not failing the build")
        return 0
    return 1 if (unbacked or dangling) else 0


if __name__ == "__main__":
    sys.exit(main())
