# Backlog: user stories and acceptance criteria

## TL;DR

67 user stories, 309 acceptance criteria. They describe what Calendaric must do
for a user, not how the old plugins did it. An agent that builds a feature is
judged against the acceptance criteria; an agent that validates the work reads
them and records a verdict.

Browse it at `docs/calendaric.html`. Work with `backlog.json`. Report on it with
`report.py`.

```bash
cd docs && python3 -m http.server 8973
open http://localhost:8973/calendaric.html
```

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

Plus `ICE`, the icebox: 7 entries covering 26 capabilities that are deliberately
not in the first release. They are kept with the evidence for deferring them,
what it would cost to add them later, and — most usefully — what the first
release must not preclude.

## Statuses

A story moves through `todo` → `in-progress` → `done`, or sits in `blocked`.
Each criterion carries its own verdict: `unverified`, `pass`, `fail` or `n-a`,
plus an `evidence` string naming the test or the observation behind it.

Statuses live in the epic files under `epics/`, so they are plain data in git —
an agent records a verdict by editing the epic file and re-running
`build_backlog.py`. Nothing depends on clicking in a browser.

## Working with it

```bash
python3 build_backlog.py         # merge epics/ into backlog.json, and validate
python3 report.py                # progress per epic, failures, blocked, open questions
python3 report.py --agent        # every criterion still outstanding, grouped by epic
python3 report.py --story US-NOTE-03
```

`build_backlog.py` is a gate, not a formatter. It fails when:

- a story or criterion id is malformed, duplicated, or leaves a gap in its sequence
- a story has no acceptance criteria, or a criterion has no `then`
- a mapped capability marked `build` has neither a story nor a stated reason
- an icebox capability appears in no `ICE` entry
- a story depends on a story id that does not exist

## How this connects to the map

Every story names the capabilities it carries, by `uid`, in `covers[]`. That is
the join between this backlog and `../mapping/calendaric-map.json`, and it is
what the Coverage tab renders. The split of capabilities across epics lives in
`../mapping/epic-assignment.json`; change that file and the coverage gate
changes with it.

Capabilities from the `vault` source are marked `evidence`, not `build`. They
are how the user's real vault uses these features today — constraints the
stories must not break, cited in `constrained_by[]`. They are deliberately not
turned into stories.

## Known limits

- Every criterion starts `unverified`. Nothing here has been checked against code yet.
- 24 open questions are recorded across the stories. They are real design decisions, not placeholders — `report.py` lists them.
- Three of those questions are the same disagreement seen from three epics: whether week-based tokens follow ISO weeks or the user's configured week-start day. `FMT` and `TPL` both decided in favour of the configured setting; `ARCH` flagged it as unresolved. It needs one answer, recorded once.
- This epic split is a judgement, not a fact. `CAL` and `CMD` in particular both touch "open the note for this date" from different sides.
