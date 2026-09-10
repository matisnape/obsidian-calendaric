# Merge map: the calendar / periodic-notes family

## TL;DR

`calendaric-map.json` describes every feature of the four plugins and libraries
that Calendaric is meant to absorb, plus what Calendaric already implements and
how the live vault actually uses them. It exists so an agent can port a feature
without reading the original repository.

Open `docs/calendaric.html` to browse it. Read `calendaric-map.json` to work with it.
That page also carries the backlog built on top of this map.

```bash
cd docs && python3 -m http.server 8973
open http://localhost:8973/calendaric.html
```

## Glossary

| Term | Meaning |
|---|---|
| **Granularity** | One period length: `day`, `week`, `month`, `quarter`, `year`. |
| **Periodic note** | A note that stands for one period, e.g. one day's note. |
| **Calendar set** | A Periodic Notes concept: a named bundle holding one config per granularity. Only that plugin has it. |
| **DNI** | `obsidian-daily-notes-interface`, the shared library that resolves and creates periodic notes. |
| **PN** | `obsidian-periodic-notes`, the plugin. |
| **Dev plugin id** | `periodic-notes-anks` / `calendar-anks` — the ids the local dev builds install under, so store updates keep arriving for the originals. |
| **Prefix matching** | Treating `2026-W07, 09.02 - 15.02` as a match for the format `gggg-[W]ww`, because the formatted date is a prefix of the filename. |

## The seven sources

| id | What it is |
|---|---|
| `dni` | `obsidian-daily-notes-interface` — shared note-resolution library. |
| `calui` | `obsidian-calendar-ui` — Svelte components for the calendar grid. |
| `cal` | `obsidian-calendar-plugin` — the Calendar sidebar plugin. |
| `pn` | `obsidian-periodic-notes` — the Periodic Notes plugin. |
| `calendaric` | This repository, as it stands today. The merge target. |
| `vault` | The live Obsidian vault: which features are actually used. |
| `forks` | The local changes these forks carry over their upstreams. |

## What is in the JSON

`SCHEMA.md` is the full contract. In short, seven arrays, each record stamped
with its `source`:

- `capabilities` — the port checklist. One discrete behaviour per record, with `path:line`.
- `flows` — ordered end-to-end paths, as `{from, to, action, payload}` steps between modules.
- `settings` — every user-configurable key, with its default and what reads it.
- `commands` — command-palette entries, ribbon items, context menus.
- `api_surface` — what other code can reach, with `stability` judged honestly.
- `modules` — one record per source file, for the dependency graph.
- `observations` — merge hazards, ranked `P1` / `P2` / `P3`, each with a permanent `OBS-<source>-<nn>` id.

Ids are unique inside one source only, so `merge.py` stamps every capability and
every module with a `uid` of `<source>:<id>`. A bare reference resolves to the
writer's own source; anything still ambiguous is an error, not a guess. It also
checks that every `path:line` citation points at a file that exists and a line
that exists, and refuses to write the map when any of that fails.

`docs/test_gates.py` is how those checks are trusted: 31 cases, each mutating one
record and requiring the validator to reject it for the stated reason. Every case
came from an adversarial review that broke an earlier version of the gate. Run it
after changing either script.

Start with `observations` filtered to `P1`. Those are the things that break a
naive merge.

## How it was built

Seven agents read the repositories in parallel, each writing one file under
`sources/`. `merge.py` concatenates them, folds the per-agent ids for external
systems onto one id each, and fails when any reference does not resolve. A
review pass verified the load-bearing claims against the code and added its own
findings under `source: "review"`.

Regenerate after editing anything in `sources/`:

```bash
python3 merge.py
```

## Known limits

- A capability marked `confidence: "inferred"` was not read in the source. Treat it as a lead, not a fact.
- `calui` is mapped at version `0.4.0`, which is **not** what `cal` builds against — `cal` pins `0.3.12`. The contract differences are recorded as `P1` observations.
- Periodic Notes registers five commands per active granularity from one template. `commands` lists the template once, under its `day` instance, and says so in `condition`.
- Nothing here mechanically joins a source capability to its Calendaric equivalent. The backlog in `docs/backlog/` does that job instead, by capability uid.
- `epic-assignment.json` splits every capability across the backlog epics. Change it and the backlog's coverage check changes with it.
