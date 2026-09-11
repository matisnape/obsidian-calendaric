#!/usr/bin/env python3
"""Check that a `pass` verdict citing a test is really held up by that test.

The convention is that a test which settles a criterion names that criterion's
id in its `describe(...)` or `it(...)` title:

    it("AC-NOTE-03.5: creates every missing intermediate folder, top down")

Nothing enforced it, so a criterion could read `pass` with evidence citing a
test name while no test named it. The verdict then had nothing holding it in
place, and a later refactor could delete or rename the test in silence.

    python3 check_ac_coverage.py                 exit 1 when a problem is found
    python3 check_ac_coverage.py --report-only   always exit 0, still print
    python3 check_ac_coverage.py --self-check    prove this script works

The gate compares a verdict's own evidence string against reality, in three
groups. Only the first two fail:

  unbacked test claim   `pass`, evidence cites a test, no test title names the
                        id. This is the drift worth failing on: the verdict
                        claims a regression that cannot be found.
  dangling reference    a test title names an id no epic file defines. A typo,
                        or a criterion renumbered out from under the test.
  no regression behind  `pass`, evidence cites review or a one-off observation
                        instead of a test. Listed and counted, never failed:
                        nothing can be tagged for it. Auditable, not hidden.

A criterion that is `unverified`, `n-a` or `fail` with no test is not reported
at all. Several criteria here are legitimately untestable in this environment
(AC-CAL-01.5 wants a jsdom harness, parts of US-CMD-01 want a live Obsidian
host). A gate demanding universal coverage would be permanently red for honest
reasons, which teaches everyone to ignore it.
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

# Read off the 30 evidence strings that exist today rather than assumed.
#
# Two shapes claim a test run, and neither is reliably a LEADING marker:
#
#   "vitest: src/fmt/noteDate.test.ts > computeNoteDate > ..."   the usual one
#   "grep confirms ...; vitest: src/notes/templateTokens.test.ts (13 tests)"
#       AC-ARCH-03.4 puts the marker after a semicolon, so anchoring to the
#       start of the string would miss it
#   "FakeVaultPort/FakeWorkspacePort cover ... (src/notes/noteCreate.test.ts)"
#       AC-ARCH-03.2 carries no marker word at all, only test file paths
#
# Three shapes claim something that is not a test run:
#
#   "code review: ci.yml has on: {pull_request: ...} and no push key"
#   "gh pr checks 6 on the real merged PR: one check named ... reported pass"
#   "detect-ci-gates.sh re-run after the merge: source=github-checks"
#
# Both of the last two contain the bare word "test" — it is the CI job name,
# "install, test, build" — so a bare `test` substring would misread them as
# test claims. Match the runner name and the test-file suffix, nothing looser.
TEST_CLAIM = re.compile(r"vitest|\.test\.ts", re.IGNORECASE)

# A verdict is only excused from rule 1 when it says out loud what settled it
# instead of a test. Recognising the phrasing, rather than treating "no test
# marker" as proof of no test claim, is what keeps this fail-closed: a future
# evidence string that cites a test in wording nobody anticipated ("covered by
# the noteCreate suite") lands in rule 1 and gets noticed, not in rule 2 where
# it would never fail. `.sh` covers a named script run, as in AC-ARCH-09.4.
NON_TEST_CLAIM = re.compile(
    r"code review|gh pr checks|grep confirms|measured by|observed|inspected"
    r"|descoped|\.sh\b",
    re.IGNORECASE,
)


def claims_a_test(evidence):
    """Fail closed: a verdict too vague to read is treated as claiming a test.

    A false alarm costs one tagged title. A missed unbacked verdict is the
    thing this gate exists to prevent. A test claim beats a non-test claim in
    the same string, because "vitest: ... plus code review of the wiring"
    (AC-MIG-01.2) does name a test that must still be findable.
    """
    if not evidence or not evidence.strip():
        return True
    if TEST_CLAIM.search(evidence):
        return True
    return not NON_TEST_CLAIM.search(evidence)


def load_criteria(epics_dir):
    """Every criterion, as (epic, story_id, ac_id, status, evidence)."""
    out = []
    for path in sorted(epics_dir.glob("*.json")):
        data = json.loads(path.read_text())
        for story in data.get("stories", []):
            for ac in story.get("acceptance_criteria", []):
                out.append((data["epic"], story["id"], ac["id"],
                            ac.get("status", "unverified"), ac.get("evidence")))
    return out


def parse_report(data):
    """Full test titles out of a vitest JSON report."""
    return [a["fullName"]
            for suite in data.get("testResults", [])
            for a in suite.get("assertionResults", [])]


def test_titles(root, report_path=None):
    """Full test titles, from a real vitest run unless a report is supplied.

    A run rather than a grep of the sources, because a title assembled at
    runtime — a `describe.each` table, a template literal — still counts as
    naming its criterion, and static parsing would miss it.

    `report_path` reads a report somebody else already produced. --self-check
    uses it to drive main() over synthetic reports, and a caller that has just
    run the suite can pass its report instead of paying for a second run.
    """
    if report_path is not None:
        return parse_report(json.loads(pathlib.Path(report_path).read_text()))

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
    return parse_report(data)


def tagged_ids(titles):
    return {m for t in titles for m in AC_IN_TITLE.findall(t)}


def check(criteria, tagged):
    """(unbacked, no_regression, dangling). Pure, so --self-check drives it."""
    known = {c[2] for c in criteria}
    untagged_pass = [c for c in criteria if c[3] == "pass" and c[2] not in tagged]
    unbacked = [c for c in untagged_pass if claims_a_test(c[4])]
    no_regression = [c for c in untagged_pass if not claims_a_test(c[4])]
    dangling = sorted(tagged - known)
    return unbacked, no_regression, dangling


def by_story(rows):
    last = None
    for epic, story_id, ac_id, _, _ in rows:
        if story_id != last:
            print(f"  {epic} / {story_id}")
            last = story_id
        print(f"    {ac_id}")


def report(unbacked, no_regression, dangling, total_tagged):
    print(f"AC coverage: {total_tagged} criteria named by tests, "
          f"{len(unbacked)} unbacked, {len(dangling)} dangling, "
          f"{len(no_regression)} passing without regression\n")

    if unbacked:
        print(f"UNBACKED TEST CLAIMS ({len(unbacked)}) — FAIL. Evidence cites a "
              "test, no test names the id.")
        by_story(unbacked)
        print()

    if dangling:
        print(f"DANGLING REFERENCES ({len(dangling)}) — FAIL. Named by a test, "
              "defined by no epic file.")
        for ac_id in dangling:
            print(f"    {ac_id}")
        print()

    if no_regression:
        print(f"PASSING WITH NO REGRESSION BEHIND THEM ({len(no_regression)}) — "
              "not a failure. The verdict rests on review or a one-off "
              "observation, so there is no test to name. Nothing to tag; each "
              "one is a decision about whether the verdict should stand.")
        by_story(no_regression)
        print()

    if not unbacked and not dangling:
        print("No failures.")


def self_check():
    """Both failure modes fire, and the two `pass` kinds are told apart."""
    catalogue = [
        # (epic, story, ac_id, status, evidence)
        ("NOTE", "US-NOTE-03", "AC-NOTE-03.1", "pass",
         "vitest: src/notes/noteCreate.test.ts > creates the folder"),
        ("NOTE", "US-NOTE-03", "AC-NOTE-03.2", "pass",
         "vitest: src/notes/noteCreate.test.ts > deletes nothing"),
        ("NOTE", "US-NOTE-03", "AC-NOTE-03.3", "unverified", None),
        ("ARCH", "US-ARCH-09", "AC-ARCH-09.2", "pass",
         "code review: ci.yml has no push key — inspected verbatim"),
        ("ARCH", "US-ARCH-09", "AC-ARCH-09.1", "pass",
         "gh pr checks 6: one check named 'install, test, build' passed in 19s"),
        ("ARCH", "US-ARCH-03", "AC-ARCH-03.2", "pass",
         "FakeVaultPort covers it (src/notes/noteOpen.test.ts)"),
        ("CAL", "US-CAL-01", "AC-CAL-01.5", "n-a", "needs a jsdom harness"),
        ("CAL", "US-CAL-01", "AC-CAL-01.6", "fail", "measured by hand: wrong"),
    ]
    tagged = tagged_ids([
        "noteCreate > AC-NOTE-03.1: creates the folder",
        "noteCreate > AC-NOTE-99.9: renumbered away",
        "no criterion in this title at all",
    ])
    assert tagged == {"AC-NOTE-03.1", "AC-NOTE-99.9"}, tagged

    unbacked, no_regression, dangling = check(catalogue, tagged)
    unbacked_ids = [c[2] for c in unbacked]
    no_regression_ids = [c[2] for c in no_regression]

    # Rule 1. A vitest-claiming `pass` with no test naming it is a failure.
    assert "AC-NOTE-03.2" in unbacked_ids, unbacked_ids
    # And so is the unmarked string that only names a .test.ts path.
    assert "AC-ARCH-03.2" in unbacked_ids, unbacked_ids
    assert len(unbacked_ids) == 2, unbacked_ids

    # Rule 2. Review- and observation-backed `pass` verdicts never fail, and
    # they must be listed, not dropped. "install, test, build" is a CI job
    # name, so AC-ARCH-09.1 proves the bare word `test` does not trip rule 1.
    assert "AC-ARCH-09.2" in no_regression_ids, no_regression_ids
    assert "AC-ARCH-09.1" in no_regression_ids, no_regression_ids
    assert len(no_regression_ids) == 2, no_regression_ids
    assert not set(no_regression_ids) & set(unbacked_ids)

    # Rule 3. A test naming an id the catalogue does not define is a failure.
    assert dangling == ["AC-NOTE-99.9"], dangling

    # Rule 4. The asymmetry this gate exists for: an untestable criterion with
    # no test is honest, so unverified / n-a / fail never appear anywhere.
    quiet = {"AC-NOTE-03.3", "AC-CAL-01.5", "AC-CAL-01.6"}
    assert quiet.isdisjoint(set(unbacked_ids) | set(no_regression_ids))

    # A `pass` that IS named stays quiet too, or the gate is just noise.
    assert check(catalogue[:1], {"AC-NOTE-03.1"}) == ([], [], [])

    # Fail closed. Empty evidence, and evidence that names neither a test nor
    # a recognised non-test source, both count as claiming a test: an
    # unanticipated way of citing one must surface, not slip into rule 2.
    assert claims_a_test(None) and claims_a_test("   ")
    assert claims_a_test("covered by the noteCreate suite")
    # A test claim wins over a non-test claim in the same string.
    assert claims_a_test("vitest: dailyNotesImport.test.ts plus code review")
    # And the recognised non-test phrasings really are recognised.
    assert not claims_a_test("code review: settings.ts renders the banner")
    assert not claims_a_test("detect-ci-gates.sh re-run: source=github-checks")

    end_to_end_check()

    print("self-check passed: unbacked test claims and dangling refs fail, "
          "review-backed passes are listed not failed, honest gaps stay quiet, "
          "and main() returns the exit codes those verdicts call for")


SYNTHETIC_EPIC = {
    "epic": "NOTE",
    "stories": [{
        "id": "US-NOTE-03",
        "acceptance_criteria": [
            {"id": "AC-NOTE-03.1", "status": "pass",
             "evidence": "vitest: src/notes/noteCreate.test.ts > creates it"},
            {"id": "AC-NOTE-03.2", "status": "pass",
             "evidence": "code review: the folder walk is top down"},
            {"id": "AC-NOTE-03.3", "status": "unverified", "evidence": None},
        ],
    }],
}


def vitest_report(*titles):
    """A report in the shape vitest --reporter=json really emits."""
    return {"testResults": [{"assertionResults":
                             [{"fullName": x} for x in titles]}]}


def end_to_end_check():
    """Drive main() itself, not only the classifier it calls.

    The classifier was well covered and the thing feeding it was not, so this
    ran green while title collection returned nothing or while normal mode
    always exited 0. Each case below asserts the process exit code, because
    that is the only part of this script CI reads.
    """
    import contextlib
    import io

    def run(report, *flags):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            (tmp / "NOTE.json").write_text(json.dumps(SYNTHETIC_EPIC))
            (tmp / "report.json").write_text(json.dumps(report))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = main(["--epics-dir", str(tmp),
                             "--vitest-json", str(tmp / "report.json"), *flags])
            return code, out.getvalue()

    named = vitest_report("noteCreate > AC-NOTE-03.1: creates it")

    # A tagged test claim and a review-backed verdict together exit 0: rule 2
    # is listed, and listing must not fail the build.
    code, out = run(named)
    assert code == 0, (code, out)
    assert "AC-NOTE-03.2" in out and "NO REGRESSION" in out, out

    # The same catalogue with the id missing from the title exits 1. Without
    # this, `return 1 if ...` could become `return 0` and nothing would notice.
    code, out = run(vitest_report("noteCreate > creates it"))
    assert code == 1, (code, out)
    assert "UNBACKED TEST CLAIMS (1)" in out, out

    # --report-only prints the same finding and still exits 0.
    code, out = run(vitest_report("noteCreate > creates it"), "--report-only")
    assert code == 0, (code, out)
    assert "UNBACKED TEST CLAIMS (1)" in out, out
    assert "report-only" in out, out

    # A test naming an id no epic file defines exits 1 on its own.
    code, out = run(vitest_report("noteCreate > AC-NOTE-03.1: creates it",
                                  "stray > AC-ZZZ-01.1: renumbered away"))
    assert code == 1, (code, out)
    assert "DANGLING REFERENCES (1)" in out and "AC-ZZZ-01.1" in out, out

    # Title collection returning nothing must not read as "all clear". Both an
    # empty run and a report whose shape this script cannot read go red.
    for empty in ({"testResults": []}, {}, vitest_report()):
        code, out = run(empty)
        assert code == 1, (empty, code, out)
        assert "0 criteria named by tests" in out, out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--report-only", action="store_true",
                    help="print the findings but always exit 0")
    ap.add_argument("--self-check", action="store_true",
                    help="run this script's own assertions and exit")
    ap.add_argument("--epics-dir", type=pathlib.Path, default=EPICS_DIR,
                    help="catalogue to read (default: ./epics)")
    ap.add_argument("--vitest-json", type=pathlib.Path, default=None,
                    help="read this vitest JSON report instead of running vitest")
    args = ap.parse_args(argv)

    if args.self_check:
        self_check()
        return 0

    criteria = load_criteria(args.epics_dir)
    tagged = tagged_ids(test_titles(REPO_ROOT, args.vitest_json))
    unbacked, no_regression, dangling = check(criteria, tagged)
    report(unbacked, no_regression, dangling, len(tagged))

    if args.report_only:
        print("report-only: not failing the build")
        return 0
    return 1 if (unbacked or dangling) else 0


if __name__ == "__main__":
    sys.exit(main())
