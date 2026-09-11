# Orchestrator handoff — Calendaric

## TL;DR

Calendaric merges four ageing Obsidian plugins into one. The survey and the
backlog are finished; no feature work has started. You are the orchestrator:
you dispatch agents into worktrees, gate what they produce, and move one story
at a time forward. You do not write feature code.

Your process is `/anks:ticket-loop`. This file is only the project context that
loop cannot derive on its own.

Start here:

```bash
cd /Users/anna.nowak/projects/obsidian/obsidian-calendaric
cat .claude/stack.json            # what is resolved per project
cat docs/backlog/AGENT.md         # the tracker contract — the authority
python3 docs/backlog/report.py    # the board
```

## Glossary

| Term | Meaning |
|---|---|
| **Calendaric** | This plugin. The merge target. |
| **The four sources** | `obsidian-calendar-plugin`, `obsidian-calendar-ui`, `obsidian-daily-notes-interface`, `obsidian-periodic-notes` — the plugins being merged, plus this repo's own partial code and a survey of Anna's live vault. |
| **The map** | `docs/mapping/` — 197 capabilities found across those sources, with a file:line citation for each. |
| **The backlog** | `docs/backlog/` — 71 user stories and 352 acceptance criteria derived from the map. This is the issue tracker. |
| **Story / ticket** | The same thing. `US-CAL-14`. |
| **Gate** | A script that rejects bad data rather than formatting it. `build_backlog.py` for the backlog, `merge.py` for the map. |
| **repo-backlog** | The `issue_tracker.tool` value meaning "the tracker is a directory in git, not a service". |

## What the project is

Anna runs four Obsidian plugins that overlap: two calendars, a daily-notes
interface library, and a periodic-notes plugin. Three of them are unmaintained
upstream. Calendaric replaces all four with one plugin she owns.

The work so far was a survey, not a build:

1. Seven agents mapped every capability of the four plugins, plus this repo's
   existing code and Anna's live vault, into `docs/mapping/calendaric-map.json`.
2. Those capabilities became 71 user stories with 352 Given/When/Then criteria.
3. Seven adversarial review rounds with Codex hardened the data and the gates.
   33 findings in round 1, down to 2 in round 7.

Nothing has been implemented against the backlog. Every criterion reads
`unverified`.

## The state of the code — read this before you plan anything

`src/` is **not empty**. It carries about 1,850 lines of TypeScript from an
earlier pass: a calendar view, a settings screen, and create/open for daily and
weekly notes, in commits tagged `[M1]`.

That code is one of the mapped sources — `docs/mapping/sources/calendaric.json`,
31 capabilities — so the backlog knows it exists. What the backlog does not say
plainly is whether a story that covers one of those capabilities means *keep and
extend* or *rewrite*. Settle that before dispatching anything that touches
`src/ui/calendar.ts`, `src/settings.ts` or `src/notes/`.

`node_modules/` is absent, so `npm test` fails with `vitest: command not found`.
The first worktree dispatch has to install before it can run a gate.

## Resolved project shape

From `.claude/stack.json`:

| What | Value | What it changes |
|---|---|---|
| `issue_tracker.tool` | `repo-backlog` | Phases 0, 1, 4 and 8. The recipes in the config are the tracker's API. |
| `issue_tracker.reference` | `docs/backlog/AGENT.md` | **The authority.** Read it before touching a story. |
| `review_agent.tool` | `codex` | Phase 3. `codex-<ticket-id>` pane, `-s read-only -a never -C <worktree>`. |
| `review_agent.crit_gate` | `on-request` | Phases 5 and 6. No crit round before the first push unless Anna asks — and every phase-6 report must say that none ran. |
| `vcs.host` | `github` | Pull requests, `gh`. Push to `origin` only; `upstream` is the Obsidian sample plugin and is never a push target. |
| `build` | `npm test` / `npm run lint` / `npm run build` | `build` is `tsc -noEmit` plus esbuild. There is no formatter. |
| `ci.gates` | `["build"]`, **provisional** | Derived from a local YAML parse because no pipeline has ever run. Re-run `detect-ci-gates.sh` after the first pull request and correct it. |

There is no stack. Stories branch off `master` and are ordered by `depends_on`,
not by chaining onto each other. 48 of the 71 are startable right now. Skip the
restacking half of `/anks:ticket-loop` rather than performing it.

## The review flow Anna wants

Two separate checks, and they are not interchangeable:

1. **Code quality — Codex, phase 3.** `/anks:herdr-review-send <id>` puts Codex
   in a read-only pane next to the implementing agent. Correctness,
   readability, boundaries. The implementing agent orders the next round, not
   you.
2. **Story and criteria — you, phase 4.** Every acceptance criterion checked
   one by one against the diff, cited `file:line`. This is yours and no agent
   does it for you.

On this tracker phase 4 also *writes*: each criterion carries a `status`
verdict and an `evidence` string, and `build_backlog.py` refuses to close a
story while a verdict is unset. Write a verdict only after the check that
settles it actually ran. Never mark a criterion `pass` to turn a gate green —
that single move turns the whole tracker into decoration.

## Constraints that are not in the loop skill

1. **Never push to `upstream`.** `origin` is `matisnape/obsidian-calendaric`;
   `upstream` is `obsidianmd/obsidian-sample-plugin`. No force-push, no tags,
   no new forks.
2. **Never modify anything under a vault's `.obsidian/` directory**, and never
   write to any `data.json` in Anna's vault. The mapping pass had read access
   for that survey; that permission is spent.
3. **Do not create branches in this main checkout.** One story, one herdr
   worktree, one pane labelled with the bare lowercase story id — `cal-14`, not
   `US-CAL-14` and nothing appended.
4. **Artifacts in English.** Commits, pull requests, code comments, docs. Chat
   with Anna in Polish.
5. **Do not add attribution lines** to commit messages or pull request bodies.

## Your first task

Do not dispatch anything yet. Produce two things:

**1. A proposed order of work.** `python3 docs/backlog/report.py --next` gives
you the 48 startable stories with their branch names, ordered by priority. That
ordering is mechanical and it is not a plan. Propose a real one: which stories
go first, why, what they unblock, and which can safely run in parallel without
two agents touching the same file. `FMT` looks like the foundation — `NOTE`,
`CAL` and `CMD` all depend on filename formats and date parsing — but verify
that against `depends_on` rather than taking it from this sentence.

**2. The questions that must be answered before the first dispatch.** Real
blockers, not a survey. At least these, plus whatever you find:

- Existing `src/` code: extend it, or rewrite it story by story? The answer
  changes the shape of nearly every `CAL`, `SET` and `NOTE` story.
- `crit_gate` is `on-request`, so nothing gates the first push except your own
  phase-4 check. Is that what Anna wants for this project?
- `ci.gates` is a guess from a local YAML parse. Does the `build` job in
  `.github/workflows/lint.yml` actually block a merge?
- How many agents run at once, and does Anna want to see each pull request
  before the next story starts?

If `/anks:ticket-loop`, `/anks:herdr-send` or `/anks:herdr-review-send` turns
out to handle a `repo-backlog` project badly — a step that assumes an MCP
tracker, a phase that assumes a stack — **say so instead of working around it
silently.** Anna extended those skills for side projects like this one and
wants the gaps reported. Log each one per the skill's own *Self-evolution*
section: a block in the project's `evolution-log.md` with
`sink: skill:anks/ticket-loop`.

## Where things are

| Path | What |
|---|---|
| `docs/backlog/AGENT.md` | The tracker contract. Ids, statuses, branch names, the loop, what the gate rejects. |
| `docs/backlog/README.md` | What the backlog is and how it was built. |
| `docs/backlog/epics/*.json` | The stories. The source of truth. |
| `docs/mapping/README.md` | The survey: sources, citation grammar, what the merge gate checks. |
| `docs/reviews/*.md` | Seven rounds of adversarial review, and the responses. |
| `docs/calendaric.html` | A browser view. `cd docs && python3 -m http.server 8973`. |
| `AGENTS.md` | Obsidian plugin conventions — file layout, manifest rules, release artifacts. |
| `.claude/stack.json` | The resolved project shape. Git-ignored, per-machine. |
