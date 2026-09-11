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

# The trailing lookahead rejects a further `.<digits>`, so "AC-NOTE-03.1.2" in
# a title yields nothing rather than quietly satisfying the real AC-NOTE-03.1.
# A malformed id must not be able to back a verdict. Yielding nothing is the
# safe direction: the criterion it nearly named stays unbacked and fails.
# build_backlog.py anchors the same shape with `^AC-<EPIC>-<nn>.<m>$` when it
# validates the catalogue; this is the title-side half, where the id is
# embedded in prose and cannot be anchored.
AC_IN_TITLE = re.compile(r"\bAC-[A-Z]+-\d{2}\.\d+\b(?!\.\d)")

# The four verdicts a criterion may carry, per AGENT.md. Kept in step with
# build_backlog.py's AC_STATUSES, which is the gate that enforces them.
AC_STATUSES = ("unverified", "pass", "fail", "n-a")

# Which evidence counts as claiming a test is decided by INVERSION, and the
# inversion is the whole point.
#
# The first two versions of this enumerated the ways prose names a test —
# "vitest:", then also ".test.ts", "suite", "spec", "covered by". Each
# enumeration leaked within a round: first "covered by the noteCreate suite;
# code review of the wiring", then "code review plus the computeNoteDate test:
# does not mutate the input date". Both were real `pass` verdicts resting on
# real tests, and both were classified as review-backed and dropped from the
# failing list. The reason is structural, not a missing pattern: the ways
# English can name a test are unbounded, so any allowlist of them fails OPEN at
# its edge, which is the one direction this gate must never fail.
#
# So the closed set is the other side. These are the prefixes the orchestrator
# writes when a verdict rests on something that is not a test. Everything else
# — every unrecognised wording, every mixed string, empty evidence — claims a
# test by construction and must be backed by a test title naming the id.
# Adding a spelling here can only ever make the gate weaker, so it is a
# deliberate act; forgetting one makes the gate noisier, which is safe.
#
# Anchored at the start, so "code review:" excuses a verdict only when it is
# what the verdict is founded on. A string that merely mentions a review later
# ("... plus code review of the wiring") still claims a test.
NON_TEST_PREFIX = re.compile(
    r"\s*(?:code review:|measured by the orchestrator:)",
    re.IGNORECASE,
)


def claims_a_test(evidence):
    """True unless the evidence opens with a recognised non-test marker.

    Fail closed by construction: the recognised set is small and closed, and
    everything outside it — unfamiliar wording, a mixed string, no evidence at
    all — is treated as claiming a test. A false alarm costs one tagged title.
    A missed unbacked verdict is the thing this gate exists to prevent.

    Sniffing prose at all is not the right long-term shape. The eventual one is
    a validated `evidence_kind` field on the criterion itself, set when the
    verdict is recorded, which removes the guessing entirely. Deferred because
    it is a schema change across 60-plus criteria already recorded in the epic
    files, and those files are held by eleven live branches; it folds into the
    retro-tagging pass, when those evidence strings are being edited anyway.
    """
    if not evidence or not evidence.strip():
        return True
    return not NON_TEST_PREFIX.match(evidence)


def load_criteria(epics_dir):
    """Every criterion, as (epic, story_id, ac_id, status, evidence).

    A catalogue that is missing or holds nothing is a hard error, never an
    empty pass. "No failures" over zero criteria is the worst output this tool
    could produce: it is indistinguishable from a clean run and would certify
    anything.
    """
    if not epics_dir.is_dir():
        sys.exit(f"no catalogue directory at {epics_dir}")
    out = []
    for path in sorted(epics_dir.glob("*.json")):
        data = json.loads(path.read_text())
        if not isinstance(data, dict):
            sys.exit(f"{path} is not an epic object")
        for story in data.get("stories", []):
            for ac in story.get("acceptance_criteria", []):
                status = ac.get("status", "unverified")
                # Every rule here keys on `status == "pass"`, so a typo like
                # "passed" makes a criterion invisible to the gate meant to
                # police it — it is neither reported nor counted, and the run
                # can print "No failures". build_backlog.py:137 is the primary
                # guard and rejects the same typo with a better message; this
                # is a cheap second assertion for the case where the checker
                # runs against a tree where that gate has not been re-run.
                if status not in AC_STATUSES:
                    sys.exit(f"{ac['id']}: status {status!r} is not one of "
                             f"{AC_STATUSES} — run build_backlog.py, which "
                             "validates the catalogue properly")
                out.append((data["epic"], story["id"], ac["id"],
                            status, ac.get("evidence")))
    if not out:
        sys.exit(f"catalogue at {epics_dir} holds no acceptance criteria — "
                 "refusing to report success over an empty catalogue")
    return out


def parse_report(data):
    """Full test titles out of a vitest JSON report.

    The shape is checked rather than `.get`-ed past, because any valid JSON
    would otherwise yield zero titles and read as a clean run. A report with no
    `testResults` key is not a vitest report; say so instead of certifying it.
    """
    if not isinstance(data, dict) or not isinstance(data.get("testResults"), list):
        sys.exit("not a vitest JSON report: no `testResults` list")
    titles = []
    for i, suite in enumerate(data["testResults"]):
        # A suite with no `assertionResults` is not an empty suite, it is a
        # shape this script cannot read. `.get(..., [])` would turn it into
        # zero titles, and zero titles over a review-only catalogue prints
        # "No failures" after checking nothing at all.
        if not isinstance(suite, dict) or not isinstance(
                suite.get("assertionResults"), list):
            sys.exit(f"vitest report: testResults[{i}] has no "
                     "`assertionResults` list; the reporter shape this script "
                     "reads has changed")
        for a in suite["assertionResults"]:
            if not isinstance(a, dict) or not isinstance(a.get("fullName"), str):
                sys.exit(f"vitest report: an assertion in testResults[{i}] has "
                         "no string `fullName`; the reporter shape this script "
                         "reads has changed")
            titles.append(a["fullName"])
    return titles


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
        if proc.returncode != 0:
            sys.exit(f"vitest exited {proc.returncode}, so its titles are not a "
                     "trustworthy picture of the suite:\n"
                     + (proc.stderr or proc.stdout))
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
         "measured by the orchestrator: check 'install, test, build' passed in 19s"),
        ("ARCH", "US-ARCH-03", "AC-ARCH-03.2", "pass",
         "FakeVaultPort covers it (src/notes/noteOpen.test.ts)"),
        ("FMT", "US-FMT-06", "AC-FMT-06.2", "pass",
         "code review plus the computeNoteDate test: does not mutate the input date"),
        ("FMT", "US-FMT-06", "AC-FMT-06.3", "pass",
         "settled while pairing on Thursday"),
        ("CAL", "US-CAL-01", "AC-CAL-01.5", "n-a", "needs a jsdom harness"),
        ("CAL", "US-CAL-01", "AC-CAL-01.6", "fail", "measured by hand: wrong"),
    ]
    tagged = tagged_ids([
        "noteCreate > AC-NOTE-03.1: creates the folder",
        "noteCreate > AC-NOTE-99.9: renumbered away",
        "no criterion in this title at all",
    ])
    assert tagged == {"AC-NOTE-03.1", "AC-NOTE-99.9"}, tagged

    # A malformed id must not back a real criterion. "AC-NOTE-03.1.2" used to
    # yield "AC-NOTE-03.1" and silently satisfy it.
    assert tagged_ids(["suite > AC-NOTE-03.1.2: typo in the id"]) == set()
    assert tagged_ids(["suite > AC-NOTE-03.12: a real twelfth criterion"]) == \
        {"AC-NOTE-03.12"}

    unbacked, no_regression, dangling = check(catalogue, tagged)
    unbacked_ids = [c[2] for c in unbacked]
    no_regression_ids = [c[2] for c in no_regression]

    # Rule 1. A vitest-claiming `pass` with no test naming it is a failure.
    assert "AC-NOTE-03.2" in unbacked_ids, unbacked_ids
    # And so is the unmarked string that only names a .test.ts path.
    assert "AC-ARCH-03.2" in unbacked_ids, unbacked_ids
    # The round 4 leak: a test named after a review marker that has no colon.
    assert "AC-FMT-06.2" in unbacked_ids, unbacked_ids
    # Evidence matching no marker at all must reach the reported list too, not
    # just be classified correctly in isolation.
    assert "AC-FMT-06.3" in unbacked_ids, unbacked_ids
    assert len(unbacked_ids) == 4, unbacked_ids

    # Rule 2. Review- and observation-backed `pass` verdicts never fail, and
    # they must be listed, not dropped. Both markers in the closed set are
    # exercised: "code review:" and "measured by the orchestrator:".
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

    # Fail closed by construction. Anything the closed set does not open with
    # claims a test, so these must all be rule 1.
    assert claims_a_test(None) and claims_a_test("   ")
    # Each of the three strings that leaked past an enumerating classifier.
    # Round 2: a test named in prose the allowlist did not know.
    assert claims_a_test("covered by the noteCreate suite; code review of the wiring")
    # Round 4: "code review" without its colon, then a bare "test:".
    assert claims_a_test(
        "code review plus the computeNoteDate test: does not mutate the input date")
    # And the general case an allowlist can never cover: wording nobody
    # anticipated, matching no marker at all.
    assert claims_a_test("settled while pairing on Thursday")
    assert claims_a_test("vitest: dailyNotesImport.test.ts plus code review")
    # A marker only excuses the verdict when it is what the verdict opens with.
    # This string carries a full "code review:" marker, colon and all, but not
    # at the front — un-anchoring the match would read it as review-backed and
    # drop a real test claim, which is the round 2 leak in a new disguise.
    assert claims_a_test(
        "the computeNoteDate suite settles this; code review: wiring checked too")
    assert claims_a_test("code review of the wiring, plus the noteCreate suite")
    # And the recognised non-test phrasings really are recognised.
    assert not claims_a_test("code review: settings.ts renders the banner")
    assert not claims_a_test("measured by the orchestrator: 19s on the merged PR")
    assert not claims_a_test("  Code Review: leading space, any case")

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
        # The catalogue and the report go in separate directories: --epics-dir
        # globs *.json, so a report sitting beside the epic files would be read
        # as one of them.
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            epics = tmp / "epics"
            epics.mkdir()
            (epics / "NOTE.json").write_text(json.dumps(SYNTHETIC_EPIC))
            (tmp / "report.json").write_text(json.dumps(report))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = main(["--epics-dir", str(epics),
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

    # Title collection returning nothing must not read as "all clear". An
    # empty run is legitimate input and still goes red on the unbacked verdict.
    for empty in ({"testResults": []}, vitest_report()):
        code, out = run(empty)
        assert code == 1, (empty, code, out)
        assert "0 criteria named by tests" in out, out

    # Arbitrary valid JSON is not a vitest report, and must not read as a
    # clean run just because it yields no titles.
    # {"testResults": [{}]} is the dangerous one: it used to parse as zero
    # titles, and zero titles over a catalogue whose only `pass` is
    # review-backed exits 0 having checked nothing.
    for junk in ({}, {"testResults": "nope"}, [],
                 {"testResults": [{"assertionResults": [{}]}]},
                 {"testResults": [{}]},
                 {"testResults": [{"assertionResults": "nope"}]},
                 {"testResults": [{"assertionResults": [{"fullName": 7}]}]}):
        try:
            code, out = run(junk)
        except SystemExit as e:
            assert e.code and "vitest" in str(e.code).lower(), e.code
        else:
            raise AssertionError(f"junk report accepted: {junk} -> {code} {out}")

    # A catalogue that is missing or empty is a hard error, never "No failures".
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        (tmp / "report.json").write_text(json.dumps(named))
        for epics in (tmp / "does-not-exist", tmp / "empty"):
            (tmp / "empty").mkdir(exist_ok=True)
            try:
                main(["--epics-dir", str(epics),
                      "--vitest-json", str(tmp / "report.json")])
            except SystemExit as e:
                assert e.code and "catalogue" in str(e.code), e.code
            else:
                raise AssertionError(f"empty catalogue accepted: {epics}")

    # Everything above calls main() in-process, so the `sys.exit(main())`
    # wiring at the bottom of this file is itself unguarded: swapping it for a
    # bare main() would leave all of it green while the real gate always
    # exited 0. Assert the process exit code the shell actually sees.
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        epics = tmp / "epics"
        epics.mkdir()
        (epics / "NOTE.json").write_text(json.dumps(SYNTHETIC_EPIC))
        base = [sys.executable, str(pathlib.Path(__file__).resolve()),
                "--epics-dir", str(epics), "--vitest-json", str(tmp / "r.json")]

        (tmp / "r.json").write_text(json.dumps(vitest_report("noteCreate > creates it")))
        proc = subprocess.run(base, capture_output=True, text=True)
        assert proc.returncode == 1, (proc.returncode, proc.stdout, proc.stderr)

        proc = subprocess.run([*base, "--report-only"], capture_output=True, text=True)
        assert proc.returncode == 0, (proc.returncode, proc.stdout, proc.stderr)

        (tmp / "r.json").write_text(json.dumps(named))
        proc = subprocess.run(base, capture_output=True, text=True)
        assert proc.returncode == 0, (proc.returncode, proc.stdout, proc.stderr)

    # An out-of-enum status is the hand-written typo that would hide a
    # criterion from the gate policing it: every rule keys on `== "pass"`, so
    # "passed" is neither reported nor counted.
    typo = json.loads(json.dumps(SYNTHETIC_EPIC))
    typo["stories"][0]["acceptance_criteria"][0]["status"] = "passed"
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        epics = tmp / "epics"
        epics.mkdir()
        (epics / "NOTE.json").write_text(json.dumps(typo))
        (tmp / "report.json").write_text(json.dumps(named))
        try:
            main(["--epics-dir", str(epics),
                  "--vitest-json", str(tmp / "report.json")])
        except SystemExit as e:
            assert "passed" in str(e.code) and "build_backlog" in str(e.code), e.code
        else:
            raise AssertionError("out-of-enum status accepted")

    # A review-only catalogue is where an unchecked report is most dangerous:
    # nothing is taggable, so zero titles look exactly like a clean run.
    review_only = json.loads(json.dumps(SYNTHETIC_EPIC))
    review_only["stories"][0]["acceptance_criteria"] = [
        {"id": "AC-NOTE-03.2", "status": "pass",
         "evidence": "code review: the folder walk is top down"},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        epics = tmp / "epics"
        epics.mkdir()
        (epics / "NOTE.json").write_text(json.dumps(review_only))
        (tmp / "report.json").write_text(json.dumps({"testResults": [{}]}))
        try:
            main(["--epics-dir", str(epics),
                  "--vitest-json", str(tmp / "report.json")])
        except SystemExit as e:
            assert "assertionResults" in str(e.code), e.code
        else:
            raise AssertionError("unreadable report over a review-only "
                                 "catalogue reported success")


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
