# Contract — writing the Calendaric backlog

You are writing user stories and acceptance criteria for **one epic** of a
rewrite. Another agent will later build the feature, and a third will read your
acceptance criteria to decide whether the work is done. Write for that third
agent: it has no project context and cannot ask you anything.

## What this rewrite is, and is not

Calendaric replaces four ageing plugins and libraries with one plugin. The
**behaviour** is being carried over. The **code is not** — the architecture, the
module boundaries and the implementation are all being written fresh.

So: describe what a user gets, never how the old code did it. A story that
names a function, a file or a Svelte component has failed. A story that says
"the note opens in the active pane" has succeeded.

The map at `calendaric-map.json` is your evidence, not your outline. Use it to
learn what the features do, then write what they are for.

## Input

- `calendaric-map.json` — every mapped capability, setting, command, flow and observation.
- `epic-assignment.json` — which capability `uid`s belong to your epic, and with what `role`:
  - `build` — turn it into stories. Every `build` uid must be covered by at least one story.
  - `evidence` — a real-world constraint from the user's vault. Not a story. Your stories must not contradict it, and where it pins behaviour down, cite it.
  - `icebox` — not yours; another agent handles those.

Read a capability's `defined_in` paths when the map's description is not enough.
Reading the old code to understand the behaviour is right. Copying its structure
into a story is not.

## Identifiers

- Story: `US-<EPIC>-<nn>` — `nn` is zero-padded, starts at `01`, no gaps.
- Criterion: `AC-<EPIC>-<nn>.<m>` — `m` starts at `1`, no gaps, scoped to its story.

Ids are permanent. They appear in validation reports, so never renumber.

## Story shape

```json
{
  "id": "US-NOTE-03",
  "epic": "NOTE",
  "title": "Open or create the note for a given date",
  "story": "As someone keeping a periodic journal, I want activating a period to take me straight to its note, so that I never have to create or find the file myself.",
  "rationale": "One sentence: why this matters. Skip restating the title.",
  "priority": "must",
  "status": "todo",
  "covers": ["dni:create-daily-note", "calendaric:create-daily-or-weekly-note"],
  "constrained_by": ["vault:create-weekly-note-rename-move"],
  "granularity": ["day", "week", "month", "year"],
  "depends_on": ["US-FMT-01"],
  "resolves": ["OBS-07", "pn:daily-notes.format"],
  "open_questions": [
    {"id": "Q-NOTE-03.1", "question": "Should an existing empty note be templated, or left alone?"}
  ],
  "acceptance_criteria": [ ... ]
}
```

Field rules:

- `story` — one sentence, "As … I want … so that …". The "so that" must carry real value; if it only repeats the "I want", the story is too small or too vague.
- `priority` — `must` (the vault depends on it today), `should` (a source plugin has it and it is clearly worth keeping), `could` (nice, no evidence of use).
- `status` — always `"todo"`. A later pass sets it from what Calendaric already implements.
- `covers` — capability uids, exactly as written in `epic-assignment.json`. This is how coverage is reported, so it must be exact.
- `constrained_by` — `vault:*` uids whose real-world behaviour this story must not break. Empty array when none apply.
- `granularity` — which periods the story applies to, or `["n-a"]`.
- `depends_on` — story ids, including ids in other epics when you are sure of them (`US-FMT-01` etc.). Leave empty rather than guess a number.
- `resolves` — mapped settings, commands, flows and P1 observations this story accounts for, which no capability of its own reaches. A setting is written `<source>:<key>`, a command and a flow `<source>:<id>`, an observation by its `OBS-nn` id. Most stories need none: the validator already treats a setting as covered when the story covers a capability the setting affects.
- `open_questions` — a real decision a human must make. Do not invent one to fill the field; `[]` is the common case. Each entry is an object with a stable `id` (`Q-<EPIC>-<nn>.<m>`) and the `question` itself, so a decision can name the exact question it answers and remove only that one.

## Acceptance criteria

```json
{
  "id": "AC-NOTE-03.1",
  "given": "no note exists for the chosen date",
  "when": "the user activates that period",
  "then": [
    "a note is created at the configured folder and filename",
    "the configured template is applied to the new note",
    "the note opens in the active pane"
  ],
  "verifies": "behaviour",
  "testable_by": "unit",
  "status": "unverified",
  "evidence": null
}
```

Rules that decide whether an AC is any good:

1. **One `given`, one `when`.** Multiple outcomes go in `then[]`. Two triggers means two criteria.
2. **Observable only.** Every `then` names something a test or a user can see: a file exists, a value is returned, an error is shown, a pane changes. "The service is called" is not observable.
3. **No implementation.** No module names, no function names, no framework names. `verifies: "architecture"` criteria are the single exception — those are allowed to name boundaries and file layout, because that is what they are about. The exception follows the marker, not the epic: an `architecture` criterion is allowed in any epic, and a `behaviour` criterion in ARCH is not exempt. The rule covers criteria only; a `decisions` entry may describe structure freely.
4. **Cover the failure paths.** For every story, at least one criterion covers what happens when it goes wrong: the folder is missing, the format is invalid, the file already exists, the template is absent, the date is unparseable. A story with only happy paths is incomplete. Mark each such criterion `"failure_path": true`. The validator requires at least one marked criterion per story and does not read prose to find them.
5. **`testable_by`** — `unit`, `integration` (needs a vault or the Obsidian API), or `manual` (needs a human to look). Prefer `unit`. If most of an epic is `manual`, say so in `notes`.
6. **`verifies`** — `behaviour` (what the user gets), `data` (what is written to disk or config), `architecture` (structure and boundaries), `compat` (an existing vault keeps working).
7. **`status`** is always `"unverified"` and `evidence` always `null`. The validating agent fills these in later. Once it does, a status other than `unverified` needs non-empty `evidence`, and `n-a` also needs `not_applicable_because`. A story reaches `done` only when every one of its criteria is `pass` or a justified `n-a`.

Aim for 3–6 criteria per story. More than 8 means the story should be split.

## Output

One JSON file at the path your assignment names:

```json
{
  "epic": "NOTE",
  "epic_title": "Resolve, create, open and navigate periodic notes",
  "summary": "2-3 sentences: what this epic is responsible for, and where its boundary with the neighbouring epics runs.",
  "stories": [ ... ],
  "uncovered": [
    { "uid": "dni:get-template-info",
      "reason": "Folded into US-NOTE-04; it has no user-visible behaviour of its own." }
  ],
  "notes": ["Anything the next agent needs and the stories cannot carry."]
}
```

`uncovered[]` is how you account for a `build` uid that got no story of its own.
Every `build` uid must appear either in some story's `covers[]` or in
`uncovered[]` with a reason. A validator checks this, so an omission fails.

## Rules that apply to every agent

1. **English, plain and short.** Active voice. One idea per sentence. No contractions in criteria text.
2. **Do not write to any repository other than your one output file.**
3. **Do not renumber, and do not skip numbers.**
4. **Valid JSON.** Check with `python3 -m json.tool` before you finish.
5. **Flag, do not guess.** An unclear behaviour goes in `open_questions`, never into a criterion phrased as though it were settled.
6. **Prefer fewer, larger stories over many thin ones.** A story is a unit of value someone would ask for by name, not a unit of code.
