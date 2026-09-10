#!/usr/bin/env python3
"""Set a story's status, then re-run the validator.

The HTML board only reads status. This is the write side:

    python3 set_status.py US-NOTE-03 in-progress

Marking a story done requires every criterion to be pass or n-a, which
build_backlog.py enforces — so a premature done fails here rather than
appearing on the board.
"""
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
EPICS = HERE / "epics"
STATUSES = ["todo", "in-progress", "blocked", "done"]


def main(sid: str, status: str) -> int:
    if status not in STATUSES:
        print(f"status must be one of {', '.join(STATUSES)}")
        return 1
    m = re.fullmatch(r"US-([A-Z]+)-\d{2}", sid)
    if not m:
        print(f"{sid} is not a story id like US-NOTE-03")
        return 1
    path = EPICS / f"{m.group(1)}.json"
    if not path.exists():
        print(f"no epic file at {path}")
        return 1
    data = json.loads(path.read_text())
    story = next((s for s in data["stories"] if s["id"] == sid), None)
    if story is None:
        print(f"{sid} is not in {path.name}")
        return 1
    was = story.get("status", "todo")
    before = path.read_text()
    story["status"] = status
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"{sid}: {was} -> {status}")
    rc = subprocess.call([sys.executable, str(HERE / "build_backlog.py")])
    if rc:
        path.write_text(before)
        print(f"\nvalidation failed — {sid} left at {was}")
    return rc


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1], sys.argv[2]))
