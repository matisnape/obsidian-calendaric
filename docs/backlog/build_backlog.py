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
ROLES = ["build", "icebox", "evidence"]
AC_STATUSES = ["unverified", "pass", "fail", "n-a"]

US_RE = re.compile(r"^US-([A-Z]+)-(\d{2})$")
AC_RE = re.compile(r"^AC-([A-Z]+)-(\d{2})\.(\d+)$")
ICE_RE = re.compile(r"^ICE-(\d{2})$")


def story_ids_early(stories):
    return {s["id"] for s in stories}


def load(name):
    path = EPICS_DIR / f"{name}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def main() -> int:
    assignment = json.loads((MAP_DIR / "epic-assignment.json").read_text())
    epic_titles = assignment["epics"]
    by_uid = {r["uid"]: r for r in assignment["assignment"]}

    role_problems = []
    for r in assignment["assignment"]:
        if r.get("role") not in ROLES:
            role_problems.append(f"{r['uid']} has role {r.get('role')!r}, "
                                 f"which is not one of {ROLES}")
        if r.get("epic") not in epic_titles:
            role_problems.append(f"{r['uid']} is assigned to unknown epic {r.get('epic')!r}")
    build_uids = {r["uid"] for r in assignment["assignment"] if r["role"] == "build"}
    ice_uids = {r["uid"] for r in assignment["assignment"] if r["role"] == "icebox"}
    evidence_uids = {r["uid"] for r in assignment["assignment"] if r["role"] == "evidence"}

    problems, warnings, missing = list(role_problems), [], []

    # The assignment file is not the universe. Deleting a row from it used to
    # delete the capability from the coverage denominator, so the percentage
    # could only ever go up. The map is the universe; the two must agree exactly.
    cap_map = json.loads((MAP_DIR / "calendaric-map.json").read_text())
    map_uids = [c["uid"] for c in cap_map["capabilities"]]
    dupes = sorted({u for u in map_uids if map_uids.count(u) > 1})
    for uid in dupes:
        problems.append(f"the map has {map_uids.count(uid)} capabilities with uid {uid}")
    assigned_uids = [r["uid"] for r in assignment["assignment"]]
    for uid in sorted({u for u in assigned_uids if assigned_uids.count(u) > 1}):
        problems.append(f"the assignment lists {uid} more than once")
    for uid in sorted(set(map_uids) - set(assigned_uids)):
        problems.append(f"mapped capability {uid} has no epic assignment")
    for uid in sorted(set(assigned_uids) - set(map_uids)):
        problems.append(f"the assignment names {uid}, which is not a mapped capability")
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

            qids = []
            for question in story.get("open_questions") or []:
                if not isinstance(question, dict) or not question.get("id") \
                        or not question.get("question"):
                    problems.append(
                        f"{sid}: open_questions entries must be "
                        f"{{'id': ..., 'question': ...}}, got {question!r}")
                    continue
                qids.append(question["id"])
            for qid in {i for i in qids if qids.count(i) > 1}:
                problems.append(f"{sid}: open question id {qid} is used more than once")

            dec_ids = [d.get("id") for d in story.get("decisions") or []]
            for did in set(dec_ids):
                if dec_ids.count(did) > 1:
                    problems.append(f"{sid}: decision {did} is recorded {dec_ids.count(did)} times")

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
                if ac["status"] != "unverified" and not (ac.get("evidence") or "").strip():
                    problems.append(f"{aid}: status {ac['status']} with no evidence")
                if ac["status"] == "n-a" and not (ac.get("not_applicable_because") or "").strip():
                    problems.append(f"{aid}: n-a with no stated reason")
            if not ac_nums:
                problems.append(f"{sid}: no acceptance criteria")
            elif sorted(ac_nums) != list(range(1, len(ac_nums) + 1)):
                problems.append(f"{sid}: criterion numbers are not 1..n without gaps ({sorted(ac_nums)})")

            acs = story.get("acceptance_criteria") or []
            # BACKLOG-SCHEMA.md rule 4. Guessing this from prose is how eleven
            # stories were reported as happy-path only when five were not.
            for a in acs:
                if "failure_path" in a and not isinstance(a["failure_path"], bool):
                    problems.append(f"{a['id']}: failure_path is {a['failure_path']!r}, "
                                    f"which is not true or false")
            if not any(a.get("failure_path") is True for a in acs):
                problems.append(f"{sid}: no criterion marked failure_path")
            if story["status"] == "done":
                open_acs = [a["id"] for a in acs if a.get("status") not in ("pass", "n-a")]
                if open_acs:
                    problems.append(
                        f"{sid}: marked done with {len(open_acs)} criteria not passed "
                        f"({', '.join(open_acs[:4])})")
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

    story_epic = {s["id"]: s["epic"] for s in stories}

    for uid, owners in covered.items():
        if uid not in by_uid:
            problems.append(f"{owners[0]} covers {uid}, which is not a mapped capability")
            continue
        # An owner of the wrong kind is how a capability looks covered without
        # anyone having agreed to build it.
        role = by_uid[uid]["role"]
        epic = by_uid[uid]["epic"]
        for owner in owners:
            if role == "build":
                if owner.startswith("ICE-"):
                    problems.append(f"{uid} is a build capability but is covered by icebox {owner}")
                elif story_epic.get(owner) != epic:
                    problems.append(
                        f"{uid} is assigned to {epic} but is covered by {owner} in "
                        f"{story_epic.get(owner)}")
            elif role == "icebox" and not owner.startswith("ICE-"):
                problems.append(f"{uid} is deferred but is covered by story {owner}")
            elif role == "evidence":
                problems.append(
                    f"{uid} is evidence only and must appear in constrained_by, not in "
                    f"{owner}'s covers[]")

    excused = {}
    for epic, meta in epic_meta.items():
        for row in meta["uncovered"]:
            uid = row.get("uid")
            excused[uid] = row.get("reason", "")
            if not (row.get("reason") or "").strip():
                problems.append(f"{epic}: {uid} is excused with no reason")
            if uid in by_uid and by_uid[uid]["epic"] != epic:
                problems.append(
                    f"{epic} excuses {uid}, which is assigned to {by_uid[uid]['epic']}")
            carried = row.get("carried_by")
            if carried and carried not in story_ids_early(stories):
                problems.append(f"{epic}: {uid} says it is carried by {carried}, which does not exist")

    uncovered_build = sorted(build_uids - set(covered) - set(excused))
    for uid in uncovered_build:
        problems.append(f"capability {uid} has no story and no stated reason")

    uncovered_ice = sorted(ice_uids - set(covered))
    for uid in uncovered_ice:
        problems.append(f"icebox capability {uid} appears in no ICE entry")

    for uid, owners in covered.items():
        if by_uid.get(uid, {}).get("role") == "build" and len(owners) > 2:
            warnings.append(f"{uid} is claimed by {len(owners)} stories: {', '.join(owners)}")

    # --- settings, commands, flows and P1 observations -----------------------
    # Each is covered when a story covers a capability it reaches, or when a
    # story or icebox entry names it in resolves[], or when an epic excuses it.
    resolved = defaultdict(list)
    for owner in stories + icebox:
        for ref in owner.get("resolves") or []:
            resolved[ref].append(owner["id"])

    aux = {"setting": ("settings", "key", "affects"),
           "command": ("commands", "id", "calls"),
           "flow": ("flows", "id", "capabilities")}
    aux_counts = {}
    for kind, (array, id_key, link) in aux.items():
        total = missing_here = 0
        for rec in cap_map[array]:
            total += 1
            ref = f"{rec['source']}:{rec[id_key]}"
            if any(uid in covered for uid in rec.get(link) or []):
                continue
            if ref in resolved or ref in excused:
                continue
            missing_here += 1
            problems.append(f"{kind} {ref} reaches no covered capability, "
                            f"and no story, icebox entry or excuse names it")
        aux_counts[kind] = {"total": total, "uncovered": missing_here}

    p1 = [o for o in cap_map["observations"] if o.get("severity") == "P1"]
    for obs in p1:
        if obs["id"] not in resolved and obs["id"] not in excused:
            problems.append(f"P1 observation {obs['id']} names no story or icebox entry "
                            f"that resolves it: {obs['what'][:80]}")
    aux_counts["p1_observation"] = {
        "total": len(p1),
        "uncovered": sum(1 for o in p1 if o["id"] not in resolved and o["id"] not in excused)}

    for ref in resolved:
        if ref in excused:
            problems.append(f"{ref} is both resolved by {resolved[ref][0]} and excused")

    # --- dependencies -------------------------------------------------------
    story_ids = {s["id"] for s in stories}
    for story in stories:
        for dep in story.get("depends_on") or []:
            if dep not in story_ids:
                problems.append(f"{story['id']} depends on {dep}, which does not exist")
        for uid in story.get("constrained_by") or []:
            if uid not in by_uid:
                problems.append(f"{story['id']} is constrained_by {uid}, which is not a mapped capability")
            elif by_uid[uid]["role"] != "evidence":
                problems.append(
                    f"{story['id']} is constrained_by {uid}, which is a {by_uid[uid]['role']} "
                    f"capability — constrained_by takes evidence capabilities only")

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
        "decisions": sorted(
            {d["id"]: d for s in stories for d in s.get("decisions") or []}.values(),
            key=lambda d: d["id"]),
        "coverage": {
            "build_total": len(build_uids),
            "build_covered": len(build_uids & set(covered)),
            "build_excused": len(set(excused) & build_uids),
            "icebox_total": len(ice_uids),
            "icebox_covered": len(ice_uids & set(covered)),
            "excused": [{"uid": u, "reason": r} for u, r in sorted(excused.items())],
            **aux_counts,
        },
    }
    if not (problems or missing):
        (HERE / "backlog.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {HERE / 'backlog.json'}")
    else:
        print("NOT WRITING backlog.json — validation failed")

    ac_total = sum(len(s.get("acceptance_criteria") or []) for s in stories)
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
    for kind in ("setting", "command", "flow", "p1_observation"):
        k = c[kind]
        print(f"  {kind + 's':<17} {k['total'] - k['uncovered']}/{k['total']} resolved")

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
