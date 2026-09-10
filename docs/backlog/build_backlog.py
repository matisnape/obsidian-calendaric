#!/usr/bin/env python3
"""Merge the per-epic story files into one backlog.json, and validate it.

Validation is the point. A backlog that silently drops a capability, reuses an
id, or leaves a gap in a numbering sequence is worse than no backlog, because
the coverage report will look green.

Run after editing anything in epics/:

    python3 build_backlog.py
"""
import json
import pathlib
import re
import sys
from collections import Counter, defaultdict
from datetime import date

HERE = pathlib.Path(__file__).parent
EPICS_DIR = HERE / "epics"
MAP_DIR = HERE.parent / "mapping"

STORY_EPICS = ["NOTE", "FMT", "TPL", "CAL", "SET", "CMD", "MIG", "ARCH"]
STORY_STATUSES = ["todo", "in-progress", "blocked", "done"]
AC_STATUSES = ["unverified", "pass", "fail", "n-a"]

US_RE = re.compile(r"^US-([A-Z]+)-(\d{2})$")
AC_RE = re.compile(r"^AC-([A-Z]+)-(\d{2})\.(\d+)$")
ICE_RE = re.compile(r"^ICE-(\d{2})$")


def load(name):
    path = EPICS_DIR / f"{name}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def main() -> int:
    assignment = json.loads((MAP_DIR / "epic-assignment.json").read_text())
    epic_titles = assignment["epics"]
    by_uid = {r["uid"]: r for r in assignment["assignment"]}
    build_uids = {r["uid"] for r in assignment["assignment"] if r["role"] == "build"}
    ice_uids = {r["uid"] for r in assignment["assignment"] if r["role"] == "icebox"}

    problems, warnings, missing = [], [], []
    stories, icebox = [], []
    epic_meta = {}

    for epic in STORY_EPICS:
        data = load(epic)
        if data is None:
            missing.append(epic)
            continue
        epic_meta[epic] = {
            "id": epic,
            "title": data.get("epic_title") or epic_titles.get(epic, ""),
            "summary": data.get("summary", ""),
            "notes": data.get("notes") or [],
            "uncovered": data.get("uncovered") or [],
        }
        seen_nums = []
        for story in data.get("stories") or []:
            sid = story.get("id", "")
            m = US_RE.match(sid)
            if not m:
                problems.append(f"{epic}: story id {sid!r} does not match US-<EPIC>-<nn>")
                continue
            if m.group(1) != epic:
                problems.append(f"{epic}: story {sid} carries the wrong epic prefix")
            seen_nums.append(int(m.group(2)))
            story["epic"] = epic
            story.setdefault("status", "todo")
            if story["status"] not in STORY_STATUSES:
                problems.append(f"{sid}: status {story['status']!r} is not one of {STORY_STATUSES}")

            ac_nums = []
            for ac in story.get("acceptance_criteria") or []:
                aid = ac.get("id", "")
                am = AC_RE.match(aid)
                if not am:
                    problems.append(f"{sid}: criterion id {aid!r} does not match AC-<EPIC>-<nn>.<m>")
                    continue
                if f"US-{am.group(1)}-{am.group(2)}" != sid:
                    problems.append(f"{aid} does not belong to its parent story {sid}")
                ac_nums.append(int(am.group(3)))
                ac.setdefault("status", "unverified")
                ac.setdefault("evidence", None)
                if ac["status"] not in AC_STATUSES:
                    problems.append(f"{aid}: status {ac['status']!r} is not one of {AC_STATUSES}")
                if not ac.get("then"):
                    problems.append(f"{aid}: empty then[]")
            if not ac_nums:
                problems.append(f"{sid}: no acceptance criteria")
            elif sorted(ac_nums) != list(range(1, len(ac_nums) + 1)):
                problems.append(f"{sid}: criterion numbers are not 1..n without gaps ({sorted(ac_nums)})")
            stories.append(story)

        if seen_nums and sorted(seen_nums) != list(range(1, len(seen_nums) + 1)):
            problems.append(f"{epic}: story numbers are not 01..nn without gaps ({sorted(seen_nums)})")

    ice = load("ICE")
    if ice is None:
        missing.append("ICE")
    else:
        nums = []
        for entry in ice.get("entries") or []:
            m = ICE_RE.match(entry.get("id", ""))
            if not m:
                problems.append(f"ICE: entry id {entry.get('id')!r} does not match ICE-<nn>")
                continue
            nums.append(int(m.group(1)))
            entry.setdefault("kind", "deferred-feature")
            icebox.append(entry)
        if nums and sorted(nums) != list(range(1, len(nums) + 1)):
            problems.append(f"ICE: entry numbers are not 01..nn without gaps ({sorted(nums)})")

    # --- coverage -----------------------------------------------------------
    covered = defaultdict(list)
    for story in stories:
        for uid in story.get("covers") or []:
            covered[uid].append(story["id"])
    for entry in icebox:
        for uid in entry.get("covers") or []:
            covered[uid].append(entry["id"])

    for uid, owners in covered.items():
        if uid not in by_uid:
            problems.append(f"{owners[0]} covers {uid}, which is not a mapped capability")

    excused = {}
    for epic, meta in epic_meta.items():
        for row in meta["uncovered"]:
            excused[row.get("uid")] = row.get("reason", "")

    uncovered_build = sorted(build_uids - set(covered) - set(excused))
    for uid in uncovered_build:
        problems.append(f"capability {uid} has no story and no stated reason")

    uncovered_ice = sorted(ice_uids - set(covered))
    for uid in uncovered_ice:
        problems.append(f"icebox capability {uid} appears in no ICE entry")

    for uid, owners in covered.items():
        role = by_uid.get(uid, {}).get("role")
        if role == "build" and len(owners) > 2:
            warnings.append(f"{uid} is claimed by {len(owners)} stories: {', '.join(owners)}")
        if role == "evidence":
            warnings.append(f"{uid} is evidence but appears in covers[] of {', '.join(owners)}")

    # --- dependencies -------------------------------------------------------
    story_ids = {s["id"] for s in stories}
    for story in stories:
        for dep in story.get("depends_on") or []:
            if dep not in story_ids:
                problems.append(f"{story['id']} depends on {dep}, which does not exist")
        for uid in story.get("constrained_by") or []:
            if uid not in by_uid:
                problems.append(f"{story['id']} is constrained_by {uid}, which is not a mapped capability")

    out = {
        "meta": {
            "generated": date.today().isoformat(),
            "purpose": "User stories and acceptance criteria for the Calendaric rewrite. "
                       "Acceptance criteria are the contract a building agent is validated against.",
            "schema": "../mapping/BACKLOG-SCHEMA.md",
            "map": "../mapping/calendaric-map.json",
            "story_statuses": STORY_STATUSES,
            "ac_statuses": AC_STATUSES,
        },
        "epics": [epic_meta[e] for e in STORY_EPICS if e in epic_meta],
        "stories": stories,
        "icebox": icebox,
        "assignment": {r["uid"]: {"epic": r["epic"], "role": r["role"]}
                       for r in assignment["assignment"]},
        "coverage": {
            "build_total": len(build_uids),
            "build_covered": len(build_uids & set(covered)),
            "build_excused": len(set(excused) & build_uids),
            "icebox_total": len(ice_uids),
            "icebox_covered": len(ice_uids & set(covered)),
            "excused": [{"uid": u, "reason": r} for u, r in sorted(excused.items())],
        },
    }
    (HERE / "backlog.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    ac_total = sum(len(s.get("acceptance_criteria") or []) for s in stories)
    print(f"wrote {HERE / 'backlog.json'}")
    if missing:
        print(f"MISSING EPIC FILES: {', '.join(missing)}")
    print(f"\n{'epic':<6} {'stories':>7} {'AC':>4}  priorities")
    for epic in STORY_EPICS:
        es = [s for s in stories if s["epic"] == epic]
        if not es:
            continue
        acs = sum(len(s.get("acceptance_criteria") or []) for s in es)
        pri = Counter(s.get("priority", "?") for s in es)
        print(f"{epic:<6} {len(es):>7} {acs:>4}  {dict(pri)}")
    print(f"{'TOTAL':<6} {len(stories):>7} {ac_total:>4}   icebox entries: {len(icebox)}")

    c = out["coverage"]
    print(f"\ncoverage: {c['build_covered']}/{c['build_total']} build capabilities have a story, "
          f"{c['build_excused']} excused with a reason; "
          f"icebox {c['icebox_covered']}/{c['icebox_total']}")

    if warnings:
        print(f"\n{len(warnings)} WARNINGS:")
        for w in warnings[:20]:
            print(f"  - {w}")
    if problems:
        print(f"\n{len(problems)} PROBLEMS:")
        for p in problems[:40]:
            print(f"  - {p}")
    else:
        print("\nno problems")
    return 1 if (problems or missing) else 0


if __name__ == "__main__":
    sys.exit(main())
