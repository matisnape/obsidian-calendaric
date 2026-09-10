#!/usr/bin/env python3
"""Every gate, checked against the thing it is supposed to reject.

A validator that cannot fail is worse than none: it reports success and the
error it was written to catch ships anyway. Each case below mutates one record
in a throwaway copy of docs/, runs the script, and requires a non-zero exit and
the expected message. The mutations are the ones an adversarial review actually
used to break earlier versions of these gates.

    python3 test_gates.py
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).parent


def load(root, rel):
    return json.loads((root / rel).read_text())


def save(root, rel, data):
    (root / rel).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def edit(root, rel, fn):
    data = load(root, rel)
    fn(data)
    save(root, rel, data)


def first_obs(d):
    return d["observations"][0]


def set_where(value):
    return lambda d: first_obs(d).__setitem__("where", [value])


def set_cap_path(value):
    return lambda d: d["capabilities"][0]["defined_in"][0].__setitem__("path", value)


def set_setting_path(value):
    return lambda d: d["settings"][0].__setitem__("path", value)


def shared_reason(value):
    def apply(d):
        for s in d["stories"]:
            if s.get("shared_coverage"):
                s["shared_coverage"] = {k: value for k in s["shared_coverage"]}
    return apply


DNI = "mapping/sources/dni.json"
SET = "backlog/epics/SET.json"
MAP = "mapping/merge.py"
BACKLOG = "backlog/build_backlog.py"

CASES = [
    # script, file, mutation, expected fragment
    (MAP, DNI, set_where("src:index.ts:118-124"), "neither a module of dni"),
    (MAP, DNI, set_where("pn-main:src/index.ts:118-124"), "neither a module of dni"),
    (MAP, DNI, set_where("/etc/hosts:1"), "leaves its source root"),
    (MAP, DNI, set_where("../obsidian-periodic-notes/src/main.ts:1"), "leaves its source root"),
    (MAP, DNI, set_where("obsidian-periodic-notes:does-not-exist.ts:999"), "cites missing file"),
    (MAP, DNI, set_where("obsidian-periodic-notes:obsidian-daily-notes-interface/src/index.ts:1"),
     "cites missing file"),
    (MAP, DNI, set_where("obsidian-periodic-notes/src/main.ts:1"), "cites missing file"),
    (MAP, DNI, set_where("@abcdef"), "names nothing once the revision is removed"),
    (MAP, DNI, set_where("HEAD"), "bare git ref"),
    (MAP, DNI, set_where("—"), "instead of a file"),
    (MAP, DNI, set_cap_path("obsidian-periodic-notes/src/main.ts"), "cites missing file"),
    (MAP, DNI, set_cap_path(""), "citation with no path"),
    (MAP, DNI, set_cap_path(7), "is not a string"),
    (MAP, DNI, set_cap_path("—"), "instead of a file"),
    (MAP, DNI, lambda d: d["capabilities"][0]["defined_in"][0].__setitem__("lines", "999-1"),
     "not a real range"),
    (MAP, DNI, set_setting_path(";;;"), "empty segment"),
    (MAP, DNI, set_setting_path(":1"), "names no file"),
    (MAP, DNI, set_setting_path("src/"), "must name the file"),
    (MAP, DNI, set_setting_path(7), "is not a path"),
    (MAP, DNI, lambda d: first_obs(d).__setitem__("id", "banana"), "is not OBS-dni-"),
    (MAP, DNI, lambda d: first_obs(d).__setitem__("id", d["observations"][1]["id"]),
     "used more than once"),
    (MAP, DNI, lambda d: d["modules"].append(dict(d["modules"][0])), "declared more than once"),
    (MAP, DNI, lambda d: d["modules"][0].__setitem__("depends_on", ["no-such-module"]),
     "references unknown module"),
    (MAP, DNI, lambda d: d["source"].__setitem__("path", ""), "no readable root path"),

    (BACKLOG, SET, shared_reason("​"), "no shared_coverage reason"),
    (BACKLOG, SET, shared_reason("͏"), "no shared_coverage reason"),
    (BACKLOG, SET, shared_reason("ㅤ"), "no shared_coverage reason"),
    (BACKLOG, SET, shared_reason(1), "no shared_coverage reason"),
    (BACKLOG, SET, lambda d: [s.__setitem__("covers", list(s["covers"]) + [s["covers"][0]])
                              for s in d["stories"] if s["id"] == "US-SET-02"],
     "in covers[] 2 times"),
    (BACKLOG, SET, lambda d: [a.__setitem__("failure_path", "false")
                              for s in d["stories"] for a in s["acceptance_criteria"]
                              if a.get("failure_path") is True],
     "which is not true or false"),
    (BACKLOG, SET, lambda d: [s.__setitem__("status", "done") for s in d["stories"]],
     "marked done with"),
]


def run(script, root):
    return subprocess.run([sys.executable, str(root / script)],
                          capture_output=True, text=True, cwd=root)


def main() -> int:
    failures = []
    with tempfile.TemporaryDirectory() as tmp:
        clean = pathlib.Path(tmp) / "clean"
        shutil.copytree(HERE, clean, ignore=shutil.ignore_patterns("__pycache__"))
        for script in (MAP, BACKLOG):
            got = run(script, clean)
            if got.returncode != 0:
                failures.append(f"{script} fails on the unmutated tree:\n{got.stdout[-600:]}")

        for n, (script, target, mutate, expected) in enumerate(CASES, 1):
            work = pathlib.Path(tmp) / f"case{n}"
            shutil.copytree(clean, work)
            edit(work, target, mutate)
            got = run(script, work)
            label = f"{n:>2}. {pathlib.Path(script).name} + {pathlib.Path(target).name}: {expected}"
            if got.returncode == 0:
                failures.append(f"{label}\n     PASSED when it should have failed")
            elif expected not in got.stdout:
                failures.append(f"{label}\n     failed for the wrong reason:\n{got.stdout[-400:]}")
            else:
                print(f"  ok  {label}")
            shutil.rmtree(work)

    print(f"\n{len(CASES) - len([f for f in failures])}/{len(CASES)} gates reject their case")
    for f in failures:
        print(f"\nFAIL {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
