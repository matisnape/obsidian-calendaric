# The tracker: how an agent picks work, branches, and records status

## TL;DR

This directory **is** the issue tracker. There is no Linear, no Jira, no GitHub
issue. Every ticket is a user story in `epics/*.json`, and every status change
is a commit.

One loop, five commands:

```bash
cd docs/backlog
python3 report.py --next                        # 1. what can start now
python3 report.py --story US-CAL-14             # 2. read the ticket
git switch -c cal-14-render-the-month-grid      # 3. branch (name comes from --next)
python3 set_status.py US-CAL-14 in-progress     # 4. claim it
python3 set_status.py US-CAL-14 in-review       # 5. when the PR is open
```

`set_status.py` re-runs the validator and reverts the file if the change is not
legal, so a wrong status cannot land.

## Glossary

| Term | Meaning |
|---|---|
| **Story** | One ticket. `US-CAL-14`. The unit an agent picks up and branches for. |
| **Acceptance criterion** | One Given/When/Then check inside a story. `AC-CAL-14.3`. A story is done when all of them pass. |
| **Epic** | A group of stories. Eight of them: `NOTE`, `FMT`, `TPL`, `CAL`, `SET`, `CMD`, `MIG`, `ARCH`. |
| **Gate** | `build_backlog.py`. It rejects illegal data instead of formatting it. |
| **Icebox** | Behaviour deliberately left out of the first release. `ICE-02`. Not work. |

## Where things are

| Path | What it is |
|---|---|
| `epics/*.json` | The tickets, one file per epic. **The source of truth.** Edit these. |
| `backlog.json` | Generated. Never edit it by hand; `build_backlog.py` writes it. |
| `build_backlog.py` | The gate. Merges the epic files and refuses to write when the data is wrong. |
| `set_status.py` | The only supported way to change a story status. |
| `report.py` | Read the board. `--next`, `--agent`, `--story <id>`. |
| `check_ac_coverage.py` | Checks a `pass` verdict against its own evidence: if the evidence cites a test, a test must name the criterion id. `npm run check:ac`. |
| `../test_gates.py` | 31 cases that each mutate one record and require the gate to reject it. |
| `../calendaric.html` | A read-only browser view of `backlog.json`. |
| `../mapping/` | Where the stories came from: the capability map of the four old plugins. |

## Identifiers

| Shape | Example | Names |
|---|---|---|
| `US-<EPIC>-<nn>` | `US-NOTE-03` | One story |
| `AC-<EPIC>-<nn>.<m>` | `AC-NOTE-03.1` | One criterion inside that story |
| `ICE-<nn>` | `ICE-02` | One deferred feature |
| `DEC-<nn>` | `DEC-03` | One recorded decision |

Ids are permanent. Nothing is renumbered, because these ids appear in reports,
branch names and commit messages. The gate fails a sequence that gains a gap or
reuses an id.

## Statuses

A story moves along this line:

```
todo  ->  in-progress  ->  in-review  ->  done
                 \
                  ->  blocked
```

| Status | What it means | Who sets it |
|---|---|---|
| `todo` | Not started. Every story starts here. | — |
| `in-progress` | An agent has a branch open and is writing code. | The building agent, before its first commit. |
| `in-review` | The pull request is open and waiting on a review. | The building agent, right after it opens the PR. |
| `blocked` | Work cannot continue. Record why in the commit message. | Whoever hits the wall. |
| `done` | Merged, and every criterion is `pass` or `n-a`. | The agent that merges. |

Each criterion carries its own verdict: `unverified`, `pass`, `fail` or `n-a`,
plus an `evidence` string naming the test or the observation behind it.

**`done` is gated.** `set_status.py US-CAL-14 done` fails while any criterion is
still `unverified` or `fail`. Record the verdicts first.

## Branch names

`report.py --next` prints the branch name for every story it lists. Use that
name verbatim.

The shape is the story id without its `US-` prefix, lowercased, plus a slug of
the title, cut at a word boundary at 60 characters:

```
cal-14-open-the-monthly-note-from-the-month-header
fmt-03-parse-a-date-back-out-of-a-filename
note-07-create-a-missing-weekly-note-on-demand
```

One story, one branch, one pull request. A branch that carries two stories
cannot be reviewed against either story's criteria.

## The loop, in full

1. **Pick.** `python3 report.py --next` lists every story whose own status is
   `todo` and whose `depends_on` stories are all `done`. Take one. If the list
   is empty, say so and stop — do not start a story that waits on another.
2. **Read.** `python3 report.py --story US-CAL-14` prints the story, every
   acceptance criterion, the capabilities it covers, and what it comes after.
3. **Branch.** `git switch -c <the branch name --next printed>`.
4. **Claim.** `python3 set_status.py US-CAL-14 in-progress`, and commit that
   change on the branch. The status now says who owns the story.
5. **Build.** The acceptance criteria are the specification. Do not widen the
   scope past them.
6. **Record verdicts.** Edit the story in `epics/<EPIC>.json`. For each
   criterion set `status` to `pass`, `fail` or `n-a`, and set `evidence` to the
   test name or the observation that settles it. Then run
   `python3 build_backlog.py`. A judged criterion with no evidence fails the
   gate.

   When the evidence cites a test, name the criterion's id in that test's
   title, so the verdict has something holding it in place:
   `it("AC-NOTE-03.5: creates every missing intermediate folder, top down")`.
   `npm run check:ac` fails on a `pass` whose evidence claims a test no test
   title names. A `pass` resting on `code review:` or an observed run instead
   is listed separately and does not fail — there is nothing to tag for it.
7. **Review.** Open the pull request, then
   `python3 set_status.py US-CAL-14 in-review`.
8. **Close.** After the merge, `python3 set_status.py US-CAL-14 done`.

## Rules the gate enforces

`build_backlog.py` exits non-zero and writes nothing when:

- a story is `done` while a criterion is still `unverified` or `fail`
- a judged criterion carries no evidence
- a story id, a criterion id, or a status is malformed or unknown
- a story depends on a story id that does not exist
- a mapped capability marked `build` has neither a story nor a stated reason
- a story has no criterion marked `failure_path`

Run `python3 ../test_gates.py` after changing any of these scripts. It mutates
one record per case and requires the gate to reject it. All 31 must pass.

## What this tracker does not do

- **No assignee field.** One person and her agents work here; the branch says
  who has it.
- **No due dates, no estimates, no cycles.** Priority is `must` / `should` /
  `could`, and that is the whole ordering.
- **No comments.** Discussion belongs in the pull request. A durable decision
  belongs in `record_decision.py`, which records it on every story it settles.
- **No creating tickets on the fly.** The 71 stories came from a mapped survey
  of the four plugins being merged. New work means a new story plus the
  coverage entry that justifies it, which `build_backlog.py` will demand.
