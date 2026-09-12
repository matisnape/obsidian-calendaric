#!/usr/bin/env python3
"""Build docs/backlog/pull_requests.json: story id -> its pull request(s).

This is a SEPARATE generated file from backlog.json on purpose. backlog.json
is rebuilt from epics/*.json, which every branch edits, so a branch that
carries a regenerated backlog.json conflicts with every sibling branch. This
script instead queries live GitHub state (`gh pr list`), which changes on
every merge anywhere in the repo — baking that into backlog.json would make
the tracker's own source of truth flap on data no branch actually owns.
Keeping it in its own file means it can be regenerated, or left stale, or
gitignored, without ever touching the tracker.

The mapping is inferred from the branch-name shape AGENT.md documents:
`<epic>-<nn>-<slug>`, lowercased, e.g. branch `cal-02-navigate-between-months`
implements `US-CAL-02`. A branch that does not match that shape (a chore
branch, an infra branch) carries no single story and is dropped, not guessed
at. A story with more than one pull request keeps all of them, most recently
updated first.

Usage:

    python3 build_pr_index.py                 # writes pull_requests.json
    python3 build_pr_index.py --repo owner/x   # query a different fork
    python3 build_pr_index.py --dry-run        # print, do not write

Requires the `gh` CLI, authenticated, with network access. Safe to re-run any
time; it only reads GitHub and only writes pull_requests.json.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).parent
DEFAULT_REPO = "matisnape/obsidian-calendaric"
OUT_FILE = HERE / "pull_requests.json"

# Same epic set build_backlog.py enforces (docs/backlog/build_backlog.py:
# STORY_EPICS), lowercased for matching against a branch name.
EPICS = ["note", "fmt", "tpl", "cal", "set", "cmd", "mig", "arch"]
BRANCH_RE = re.compile(rf"^({'|'.join(EPICS)})-(\d{{2}})-[a-z0-9-]+$")


def story_id_for_branch(branch: str):
    """US-NOTE-11 for 'note-11-keep-...', or None if the branch names no story."""
    m = BRANCH_RE.match(branch)
    if not m:
        return None
    return f"US-{m.group(1).upper()}-{m.group(2)}"


def fetch_pull_requests(repo: str, limit: int):
    cmd = [
        "gh", "pr", "list", "-R", repo, "--state", "all", "--limit", str(limit),
        "--json", "number,title,headRefName,state,url,mergedAt",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"gh pr list failed: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def build_index(pull_requests, repo: str):
    stories = {}
    unmatched = []
    for pr in pull_requests:
        sid = story_id_for_branch(pr["headRefName"])
        if sid is None:
            unmatched.append(pr["headRefName"])
            continue
        stories.setdefault(sid, []).append({
            "number": pr["number"],
            "title": pr["title"],
            "url": pr["url"],
            "state": pr["state"],
            "headRefName": pr["headRefName"],
            "mergedAt": pr.get("mergedAt"),
        })

    # Most recently merged first within a story, so the page's "the" pull
    # request for a story is the newest one when there is more than one.
    for sid, prs in stories.items():
        prs.sort(key=lambda p: p.get("mergedAt") or "", reverse=True)

    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": f"gh pr list -R {repo} --state all --limit N",
        "stories": stories,
        "unmatched_branches": sorted(set(unmatched)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Map GitHub pull requests to backlog story ids by branch "
                    "name, and write docs/backlog/pull_requests.json.")
    parser.add_argument("--repo", default=DEFAULT_REPO,
                        help=f"owner/repo to query with gh (default: {DEFAULT_REPO}). "
                             "gh defaults to the upstream parent on a fork, so this "
                             "must be passed explicitly to gh, which this script does.")
    parser.add_argument("--limit", type=int, default=200,
                        help="max pull requests to fetch (default: 200)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the index instead of writing pull_requests.json")
    args = parser.parse_args()

    prs = fetch_pull_requests(args.repo, args.limit)
    index = build_index(prs, args.repo)

    text = json.dumps(index, indent=2, ensure_ascii=False) + "\n"
    if args.dry_run:
        print(text)
    else:
        OUT_FILE.write_text(text)
        print(f"wrote {OUT_FILE} ({len(index['stories'])} stories, "
              f"{len(index['unmatched_branches'])} unmatched branches)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
