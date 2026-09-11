# Backlog: user stories and acceptance criteria

## TL;DR

71 user stories, 352 acceptance criteria. They describe what Calendaric must do
for a user, not how the old plugins did it. An agent that builds a feature is
judged against the acceptance criteria; an agent that validates the work reads
them and records a verdict.

Browse it at `docs/calendaric.html`. Work with `backlog.json`. Report on it with
`report.py`. An agent that picks up a story, opens a branch and records a status
reads `AGENT.md` instead of this file — that is the operating manual, this is
the description.

```bash
cd docs && python3 -m http.server 8973
open http://localhost:8973/calendaric.html
```

## Glossary

| Term | Meaning |
|---|---|
| **Epic** | A group of related stories. |
| **Granularity** | A note period: day, week, month, quarter, or year. |
| **Coverage** | Mapped behaviour accounted for by a story or an explicit deferral. |
| **Icebox** | Behaviour deliberately excluded from the first release. |

## Identifiers

| Shape | Example | What it names |
|---|---|---|
| `US-<EPIC>-<nn>` | `US-NOTE-03` | One user story |
| `AC-<EPIC>-<nn>.<m>` | `AC-NOTE-03.1` | One acceptance criterion inside that story |
| `ICE-<nn>` | `ICE-02` | One deferred feature in the icebox |

Ids are permanent. They appear in validation reports, so nothing is renumbered.
`build_backlog.py` fails if a sequence gains a gap or an id is reused.

## The eight epics

| Epic | Owns |
|---|---|
| `NOTE` | Resolving, creating, opening and navigating periodic notes, and the index behind it |
| `FMT` | Filename formats, parsing a date back out of a filename, week numbers, locale |
| `TPL` | Template files and token substitution in the note body |
| `CAL` | The calendar view: grid, navigation, indicators, interaction |
| `SET` | The configuration model and the settings screen |
| `CMD` | Commands, ribbon, menus and startup behaviour |
| `MIG` | Importing existing configuration and coexisting with other plugins |
| `ARCH` | Architecture, boundaries, testability and release quality |

Plus `ICE`, the icebox: 8 entries covering 23 capabilities that are deliberately
not in the first release. They are kept with the evidence for deferring them,
what it would cost to add them later, and — most usefully — what the first
release must not preclude.

## Statuses

A story moves through `todo` → `in-progress` → `in-review` → `done`, or sits in
`blocked`. `in-review` means the pull request is open and the work is waiting on
a reviewer. Each criterion carries its own verdict: `unverified`, `pass`, `fail` or `n-a`,
plus an `evidence` string naming the test or the observation behind it.

Statuses live in the epic files under `epics/`, so they are plain data in git —
an agent records a verdict by editing the epic file and re-running
`build_backlog.py`. Nothing depends on clicking in a browser.

## Working with it

```bash
python3 build_backlog.py         # merge epics/ into backlog.json, and validate
python3 report.py                # progress per epic, failures, blocked, open questions
python3 report.py --next         # stories that can start now, with the branch name for each
python3 report.py --agent        # every criterion still outstanding, grouped by epic
python3 report.py --story US-NOTE-03
python3 set_status.py US-NOTE-03 in-progress   # the board is read-only; this is the write side
python3 ../test_gates.py                      # every gate, against the case it must reject
```

`build_backlog.py` is a gate, not a formatter. It fails when:

- a story or criterion id is malformed, duplicated, or leaves a gap in its sequence
- a story has no acceptance criteria, or a criterion has no `then`
- a mapped capability marked `build` has neither a story nor a stated reason
- an icebox capability appears in no `ICE` entry
- a story depends on a story id that does not exist
- the epic assignment and the map disagree about which capabilities exist
- a capability is covered by the wrong kind of owner, or by a story in another epic
- a story has no criterion marked `failure_path`
- a story is `done` while a criterion is still unverified or failing
- a judged criterion carries no evidence
- a mapped setting, command, flow or P1 observation has no owner and no excuse

It writes `backlog.json` only when none of that fires, so a failed run cannot
leave stale output for the report and the viewer to render.

## How this connects to the map

Every story names the capabilities it carries, by `uid`, in `covers[]`. That is
the join between this backlog and `../mapping/calendaric-map.json`, and it is
what the Coverage tab renders. The split of capabilities across epics lives in
`../mapping/epic-assignment.json`; change that file and the coverage gate
changes with it.

A story also names anything else it accounts for in `resolves[]`: a mapped
setting, command or flow that no capability of its own reaches, and the `OBS-nn`
id of a P1 observation it settles. Most stories need none — the gate already
treats a setting as covered when the story covers a capability that setting
affects. What `resolves[]` closes is the gap where a setting, a command, a flow
or a P1 hazard had no owner at all and coverage still read 100%.

Capabilities from the `vault` source are marked `evidence`, not `build`. They
are how the user's real vault uses these features today — constraints the
stories must not break, cited in `constrained_by[]`. They are deliberately not
turned into stories.

## Decisions

The stories surfaced 24 open questions. All 24 are now answered. There are 25
decisions, `DEC-01` … `DEC-25`: 21 of them answer one or more of those questions
and name the ids in `resolves`, and four came out of the adversarial review
rather than from a recorded question, so their `resolves` is empty. They are
recorded on the stories they settle rather than in a chat log. A story carrying
one shows the decision, the reasoning and the date; a
decision that settles the same question in several epics is recorded on each of
them, which is why 25 decisions appear on more stories than that.

A decision names the exact question ids it answers, in `resolves`, and removing
a question is limited to those ids. Re-running updates a decision in place, so
editing its text here propagates instead of leaving the old copy behind.

```bash
python3 record_decision.py            # apply every decision; safe to re-run
python3 record_decision.py DEC-07     # apply one
python3 report.py                     # lists them, with the stories each covers
```

`record_decision.py` holds the decision text. Adding one means adding an entry
there and re-running it, so the wording lives in version control next to
everything it affects.

The four with the widest reach:

| Id | Decision |
|---|---|
| `DEC-01` | Week numbers and weekday tokens follow the configured week-start day, not ISO |
| `DEC-02` | A file is a periodic note only when its folder matches too, not its name alone |
| `DEC-03` | Desktop only for now, with every desktop-specific call behind one adapter |
| `DEC-05` | The plugin ships in English only; no localisation layer |

## Known limits

- Every criterion starts `unverified`. Nothing here has been checked against code yet.
- The decisions are recorded, not implemented. A criterion still describes the behaviour; the decision only settles which behaviour.
- This epic split is a judgement, not a fact. `CAL` and `CMD` in particular both touch "open the note for this date" from different sides.
