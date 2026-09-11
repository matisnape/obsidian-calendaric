#!/usr/bin/env python3
"""Check that every `pass` verdict is held up by a test that names it.

The convention is that a test which settles a criterion names that criterion's
id in its `describe(...)` or `it(...)` title:

    it("AC-NOTE-03.5: creates every missing intermediate folder, top down")

Nothing enforced it, so a criterion could read `pass` while no test named it.
The verdict then had nothing holding it in place, and a later refactor could
delete or rename the test in silence.

    python3 check_ac_coverage.py                 exit 1 when a problem is found
    python3 check_ac_coverage.py --report-only   always exit 0, still print
    python3 check_ac_coverage.py --self-check    prove this script works

Every `pass` must be named by a test title, except the handful listed in
NO_REGRESSION_IDS. Three groups; only the first two fail:

  unbacked verdict      `pass`, not in NO_REGRESSION_IDS, no test title names
                        the id. This is the drift worth failing on: the verdict
                        claims a regression that cannot be found.
  dangling reference    a test title names an id no epic file defines. A typo,
                        or a criterion renumbered out from under the test.
  no regression behind  `pass`, in NO_REGRESSION_IDS, no test. Listed and
                        counted, never failed: nothing can be tagged for it.
                        Auditable, not hidden.

THE EVIDENCE STRING IS NOT PARSED, AND MUST NOT BECOME PARSED AGAIN. Three
successive attempts to decide from it each leaked: enumerating the ways prose
names a test, then inverting to a closed set of non-test markers, then
anchoring that set to the front of the string. Every leak sent a real
test-backed verdict into the group that never fails — the one direction this
gate must not fail — and the last two arrived in opposite word orders
("review, then test" and "test, then review"). Prose has no fixed grammar; an
id does. Exempting a criterion means adding its id to NO_REGRESSION_IDS on
purpose, which is visible in review; it must never again mean wording its
evidence a particular way.

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

# The four criteria settled by observation rather than by a test.
#
# This is an allowlist of IDS, not of prose, and that is the whole design. The
# first three versions classified the evidence string — first by enumerating
# test markers, then by inverting to a closed set of non-test markers anchored
# at the front — and each leaked within a round:
#
#   "covered by the noteCreate suite; code review of the wiring"
#   "code review plus the computeNoteDate test: does not mutate the input date"
#   "code review: wiring checked; vitest: noteDate.test.ts proves immutability"
#
# Every one was a `pass` resting on a real test that the gate excused. Prose
# has no fixed grammar, so any reading of it fails open somewhere; the last
# leak arrived in the opposite word order from the one before it. No string is
# parsed now, so no string can leak in either order.
#
# ADDING AN ENTRY HERE IS A STATEMENT, not a formality: it says this criterion
# has no regression behind it and never will, so nothing can ever be tagged for
# it. That is a real reduction in what the gate protects. Four entries is
# small enough that a fifth should be argued for in review; if this list grows
# quietly, the gate is being hollowed out one criterion at a time.
NO_REGRESSION_IDS = frozenset({
    "AC-ARCH-09.2",   # code review of ci.yml: pull_request-only, no push key
    "AC-ARCH-09.5",   # code review of ci.yml: no lint step, DEC-26 named
    "AC-MIG-01.1",    # code review of settings.ts: testable_by manual
    "AC-MIG-01.5",    # code review of the import modal: testable_by manual
})


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
    unbacked = [c for c in untagged_pass if c[2] not in NO_REGRESSION_IDS]
    no_regression = [c for c in untagged_pass if c[2] in NO_REGRESSION_IDS]
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
        print(f"UNBACKED VERDICTS ({len(unbacked)}) — FAIL. Marked `pass`, "
              "no test names the id.")
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
              "not a failure. Listed in NO_REGRESSION_IDS as settled by "
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
        ("MIG", "US-MIG-01", "AC-MIG-01.1", "pass",
         "code review: settings.ts renders the import banner"),
        ("ARCH", "US-ARCH-03", "AC-ARCH-03.2", "pass",
         "FakeVaultPort covers it (src/notes/noteOpen.test.ts)"),
        ("FMT", "US-FMT-06", "AC-FMT-06.2", "pass",
         "code review plus the computeNoteDate test: does not mutate the input date"),
        ("FMT", "US-FMT-06", "AC-FMT-06.3", "pass",
         "settled while pairing on Thursday"),
        ("FMT", "US-FMT-06", "AC-FMT-06.4", "pass",
         "code review: wiring checked; vitest: noteDate.test.ts proves it"),
        ("FMT", "US-FMT-06", "AC-FMT-06.5", "pass",
         "vitest: noteDate.test.ts proves it; code review: wiring checked"),
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

    # Rule 1. A `pass` not in the allowlist, with no test naming it, fails —
    # whatever its evidence says. Every string below leaked past a previous
    # prose classifier; none of them is read any more.
    assert "AC-NOTE-03.2" in unbacked_ids, unbacked_ids   # plain vitest claim
    assert "AC-ARCH-03.2" in unbacked_ids, unbacked_ids   # bare .test.ts path
    assert "AC-FMT-06.2" in unbacked_ids, unbacked_ids    # review, then test
    assert "AC-FMT-06.3" in unbacked_ids, unbacked_ids    # no marker at all
    # Both orders of mixed evidence, which is what defeated prefix matching:
    # the non-test marker first (round 5's leak) and the test marker first.
    assert "AC-FMT-06.4" in unbacked_ids, unbacked_ids
    assert "AC-FMT-06.5" in unbacked_ids, unbacked_ids
    assert len(unbacked_ids) == 7, unbacked_ids   # the six above, plus AC-ARCH-09.1

    # Rule 2. An allowlisted `pass` with no test does not fail, and is listed
    # rather than dropped. AC-ARCH-09.1 is deliberately NOT in the allowlist
    # even though its evidence reads like an observation: only the id decides.
    assert set(no_regression_ids) == {"AC-ARCH-09.2", "AC-MIG-01.1"}, no_regression_ids
    assert "AC-ARCH-09.1" in unbacked_ids, unbacked_ids
    assert not set(no_regression_ids) & set(unbacked_ids)
    assert set(no_regression_ids) <= NO_REGRESSION_IDS

    # Rule 3. A test naming an id the catalogue does not define is a failure.
    assert dangling == ["AC-NOTE-99.9"], dangling

    # Rule 4. The asymmetry this gate exists for: an untestable criterion with
    # no test is honest, so unverified / n-a / fail never appear anywhere.
    quiet = {"AC-NOTE-03.3", "AC-CAL-01.5", "AC-CAL-01.6"}
    assert quiet.isdisjoint(set(unbacked_ids) | set(no_regression_ids))

    # A `pass` that IS named stays quiet too, or the gate is just noise.
    assert check(catalogue[:1], {"AC-NOTE-03.1"}) == ([], [], [])

    # An allowlisted criterion that DOES get a test stays quiet as well: the
    # allowlist excuses a missing test, it does not silence a present one.
    allow_tagged = [c for c in catalogue if c[2] == "AC-ARCH-09.2"]
    assert check(allow_tagged, {"AC-ARCH-09.2"}) == ([], [], [])

    end_to_end_check()

    print("self-check passed: a `pass` outside NO_REGRESSION_IDS with no test "
          "fails whatever its evidence says, dangling refs fail, listed ones "
          "are reported not failed, honest gaps stay quiet, and main() returns "
          "the exit codes those verdicts call for")


# AC-MIG-01.1 is here because it is in NO_REGRESSION_IDS; AC-NOTE-03.2 carries
# the same "code review:" prose but is NOT allowlisted, so it must still fail.
# The pair is what proves the id decides and the string does not.
SYNTHETIC_EPIC = {
    "epic": "NOTE",
    "stories": [
        {
            "id": "US-NOTE-03",
            "acceptance_criteria": [
                {"id": "AC-NOTE-03.1", "status": "pass",
                 "evidence": "vitest: src/notes/noteCreate.test.ts > creates it"},
                {"id": "AC-NOTE-03.3", "status": "unverified", "evidence": None},
            ],
        },
        {
            "id": "US-MIG-01",
            "acceptance_criteria": [
                {"id": "AC-MIG-01.1", "status": "pass",
                 "evidence": "code review: settings.ts renders the banner"},
            ],
        },
    ],
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

    # A tagged `pass` and an allowlisted one together exit 0: the allowlisted
    # verdict is listed, and listing must not fail the build.
    code, out = run(named)
    assert code == 0, (code, out)
    assert "AC-MIG-01.1" in out and "NO REGRESSION" in out, out

    # The same catalogue with the id missing from the title exits 1. Without
    # this, `return 1 if ...` could become `return 0` and nothing would notice.
    code, out = run(vitest_report("noteCreate > creates it"))
    assert code == 1, (code, out)
    assert "UNBACKED VERDICTS (1)" in out, out

    # --report-only prints the same finding and still exits 0.
    code, out = run(vitest_report("noteCreate > creates it"), "--report-only")
    assert code == 0, (code, out)
    assert "UNBACKED VERDICTS (1)" in out, out
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
    # allowlisted exits 0 having checked nothing.
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
    review_only["stories"] = [{
        "id": "US-MIG-01",
        "acceptance_criteria": [
            {"id": "AC-MIG-01.1", "status": "pass",
             "evidence": "code review: settings.ts renders the banner"},
        ],
    }]
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
    stale = sorted(NO_REGRESSION_IDS - {c[2] for c in criteria})
    if stale and args.epics_dir == EPICS_DIR:
        sys.exit(f"NO_REGRESSION_IDS names criteria the catalogue does not "
                 f"define: {stale}. An exemption for a renumbered or deleted "
                 "criterion protects nothing and hides that the list is stale.")
    tagged = tagged_ids(test_titles(REPO_ROOT, args.vitest_json))
    unbacked, no_regression, dangling = check(criteria, tagged)
    report(unbacked, no_regression, dangling, len(tagged))

    if args.report_only:
        print("report-only: not failing the build")
        return 0
    return 1 if (unbacked or dangling) else 0


if __name__ == "__main__":
    sys.exit(main())
