#!/usr/bin/env python3
"""Print a delivery report from backlog.json.

Two audiences:

  python3 report.py            progress by epic, and what is blocked or failing
  python3 report.py --next     the stories that can start now, with their branch names
  python3 report.py --agent    the criteria a building agent still has to satisfy
  python3 report.py --story US-NOTE-03    one story in full

Statuses live in backlog.json, so a validating agent updates them by editing
the epic file and re-running build_backlog.py.
"""
import json
import pathlib
import re
import sys
from collections import Counter, defaultdict

HERE = pathlib.Path(__file__).parent
BL = json.loads((HERE / "backlog.json").read_text())
BAR = 24


def roll(story):
    acs = story.get("acceptance_criteria") or []
    c = Counter(a.get("status", "unverified") for a in acs)
    return len(acs), c


def bar(pct):
    filled = round(pct / 100 * BAR)
    return "█" * filled + "·" * (BAR - filled)


def overview():
    print(f"Calendaric backlog — generated {BL['meta']['generated']}\n")
    tot_ac = tot_pass = 0
    print(f"{'epic':<6} {'stories':>7} {'done':>5} {'AC':>5} {'pass':>5} {'fail':>5}  progress")
    for epic in BL["epics"]:
        es = [s for s in BL["stories"] if s["epic"] == epic["id"]]
        if not es:
            continue
        n_ac = n_pass = n_fail = 0
        for s in es:
            t, c = roll(s)
            n_ac += t; n_pass += c["pass"]; n_fail += c["fail"]
        done = sum(1 for s in es if s["status"] == "done")
        pct = round(n_pass / n_ac * 100) if n_ac else 0
        tot_ac += n_ac; tot_pass += n_pass
        print(f"{epic['id']:<6} {len(es):>7} {done:>5} {n_ac:>5} {n_pass:>5} {n_fail:>5}  {bar(pct)} {pct:>3}%")
    pct = round(tot_pass / tot_ac * 100) if tot_ac else 0
    print(f"{'TOTAL':<6} {len(BL['stories']):>7} "
          f"{sum(1 for s in BL['stories'] if s['status'] == 'done'):>5} "
          f"{tot_ac:>5} {tot_pass:>5} "
          f"{sum(roll(s)[1]['fail'] for s in BL['stories']):>5}  {bar(pct)} {pct:>3}%")

    st = Counter(s["status"] for s in BL["stories"])
    print("\nboard: " + "   ".join(f"{k} {st.get(k, 0)}" for k in BL["meta"]["story_statuses"]))

    failing = [(s, a) for s in BL["stories"] for a in s.get("acceptance_criteria") or []
               if a.get("status") == "fail"]
    if failing:
        print(f"\nFAILING ({len(failing)}):")
        for s, a in failing:
            print(f"  {a['id']:<16} {s['title']}")
            print(f"    {a.get('evidence') or 'no evidence recorded'}")

    blocked = [s for s in BL["stories"] if s["status"] == "blocked"]
    if blocked:
        print(f"\nBLOCKED ({len(blocked)}):")
        for s in blocked:
            print(f"  {s['id']:<12} {s['title']}")

    decs = BL.get("decisions") or []
    if decs:
        print(f"\nDECISIONS TAKEN ({len(decs)}):")
        for d in decs:
            on = sorted(s["id"] for s in BL["stories"]
                        if any(x["id"] == d["id"] for x in s.get("decisions") or []))
            print(f"  {d['id']}  {d['title']}")
            print(f"    {', '.join(on)}")

    qs = [(s["id"], q) for s in BL["stories"] for q in s.get("open_questions") or []]
    if qs:
        print(f"\nOPEN QUESTIONS ({len(qs)}):")
        for sid, q in qs:
            print(f"  {sid:<12} {q['id']}  {q['question']}")

    c = BL["coverage"]
    print(f"\ncoverage: {c['build_covered']}/{c['build_total']} capabilities carried by a story, "
          f"{c['build_excused']} accounted for without a separate story; "
          f"icebox {c['icebox_covered']}/{c['icebox_total']}")


def agent_view():
    """Everything still to satisfy, grouped so an agent can pick up one epic."""
    todo = defaultdict(list)
    for s in BL["stories"]:
        for a in s.get("acceptance_criteria") or []:
            if a.get("status") in ("unverified", "fail"):
                todo[s["epic"]].append((s, a))
    for epic, items in todo.items():
        print(f"\n## {epic} — {len(items)} criteria outstanding")
        for s, a in items:
            print(f"\n{a['id']}  ({s['id']}: {s['title']})")
            print(f"  Given {a['given']}")
            print(f"  When  {a['when']}")
            for t in a.get("then") or []:
                print(f"  Then  {t}")
            print(f"  [{a.get('testable_by')}] [{a.get('verifies')}] status={a.get('status')}")


def branch_name(story):
    """The branch an agent opens for this story: cal-14-<slug of the title>."""
    name = story["id"].removeprefix("US-").lower()
    for word in re.sub(r"[^a-z0-9]+", " ", story["title"].lower()).split():
        if len(name) + 1 + len(word) > 60:
            break
        name += f"-{word}"
    return name


def ready(story, by_id):
    """A story can start when it is todo and every story it depends on is done."""
    if story["status"] != "todo":
        return False
    return all(by_id.get(d, {}).get("status") == "done" for d in story.get("depends_on") or [])


def next_view():
    by_id = {s["id"]: s for s in BL["stories"]}
    open_now = [s for s in BL["stories"] if ready(s, by_id)]
    order = {"must": 0, "should": 1, "could": 2}
    open_now.sort(key=lambda s: (order.get(s.get("priority"), 9), s["id"]))
    if not open_now:
        print("nothing is ready to start: every todo story waits on an unfinished one")
        return
    print(f"{len(open_now)} stories can start now\n")
    print(f"{'story':<12} {'pri':<7} {'AC':>3}  title")
    for s in open_now:
        n = len(s.get("acceptance_criteria") or [])
        print(f"{s['id']:<12} {s.get('priority', ''):<7} {n:>3}  {s['title']}")
        print(f"{'':<12} branch: {branch_name(s)}")


def one(story_id):
    s = next((x for x in BL["stories"] if x["id"] == story_id), None)
    if not s:
        print(f"no such story: {story_id}")
        return 1
    print(f"{s['id']}  {s['title']}   [{s['status']}] [{s.get('priority')}]")
    print(f"\n{s['story']}\n")
    if s.get("rationale"):
        print(f"Why: {s['rationale']}\n")
    for a in s.get("acceptance_criteria") or []:
        print(f"{a['id']}  [{a.get('status')}]")
        print(f"  Given {a['given']}")
        print(f"  When  {a['when']}")
        for t in a.get("then") or []:
            print(f"  Then  {t}")
        print()
    if s.get("covers"):
        print("covers: " + ", ".join(s["covers"]))
    if s.get("depends_on"):
        print("after: " + ", ".join(s["depends_on"]))
    return 0


if __name__ == "__main__":
    if "--next" in sys.argv:
        next_view()
    elif "--agent" in sys.argv:
        agent_view()
    elif "--story" in sys.argv:
        sys.exit(one(sys.argv[sys.argv.index("--story") + 1]))
    else:
        overview()
