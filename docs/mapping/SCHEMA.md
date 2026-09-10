# Source-mapping schema

## TL;DR

The goal is to preserve useful behaviour in a new Calendaric plugin, not to
merge the old code. Record enough source evidence for an agent to reimplement
and verify each behaviour without rereading the original repository.

You are mapping one of several related Obsidian plugins or libraries. Write one
JSON file that follows this schema.

## Glossary

| Term | Meaning |
|---|---|
| **Capability** | One behaviour a user or another piece of code can rely on. |
| **Flow** | An ordered path from a user action to its result. |
| **Module** | The smallest source-code unit worth naming, usually one file or a focused folder. |
| **Observation** | A risk or constraint that does not fit the other record types. |
| **Source root** | The top directory of the repository or vault being mapped. |

Write **one JSON file** to the path given in your assignment. Nothing else is
written anywhere. Do not modify any repository.

## Top-level shape

```json
{
  "source": {
    "id": "<short id given in your assignment>",
    "repo": "<repo folder name, or 'vault' / 'forks'>",
    "path": "<absolute path>",
    "version": "<package.json version or n/a>",
    "role": "<one line: what this unit is for>"
  },
  "modules":      [ ... ],
  "capabilities": [ ... ],
  "flows":        [ ... ],
  "settings":     [ ... ],
  "commands":     [ ... ],
  "api_surface":  [ ... ],
  "observations": [ ... ]
}
```

Every array is required. Use `[]` when a section genuinely does not apply. For
example, a pure library may have no `commands`. Do not invent entries to fill a
section.

## modules[]

A module is the smallest unit worth naming on an architecture diagram — usually
one source file or one tight folder.

```json
{
  "id": "dni-daily",                 // kebab-case, globally unique: "<source id>-<name>"
  "name": "daily.ts",
  "path": "src/daily.ts",            // repo-relative
  "role": "Create/lookup daily notes",   // one line
  "loc": 120,                        // line count
  "category": "notes",               // see Categories below
  "depends_on": ["dni-vault", "dni-settings"],  // other module ids, same or other source
  "external": false                  // true for things outside the code you map (Obsidian API, another plugin)
}
```

## capabilities[]

One discrete piece of behaviour a user or a caller can rely on. This is the
most important array — it becomes the reimplementation checklist.

```json
{
  "id": "create-daily-note",
  "name": "Create a daily note",
  "category": "notes",
  "surface": "api",                  // api | command | ui | setting | event | integration | template-token
  "description": "One or two concrete sentences: what happens and what the caller gets back.",
  "granularity": ["day"],            // day|week|month|quarter|year|any|n-a  (array)
  "defined_in": [
    { "module": "dni-daily", "symbol": "createDailyNote", "path": "src/daily.ts", "lines": "31-73" }
  ],
  "used_by": ["cal-io-daily", "pn-commands"],   // module ids that call it; [] if nothing in scope does
  "depends_on_capability": ["resolve-daily-settings"],  // capability ids
  "behaviour_notes": [
    "Applies the template file if configured.",
    "Throws when the folder does not exist."
  ],
  "edge_cases": ["Locale week start affects the parsed date"],
  "confidence": "verified"           // verified (read the code) | inferred (read docs/types only)
}
```

Rules for `capabilities[]`:
- Split by *behaviour*, not by function count. A 5-line wrapper that adds nothing is not its own capability — fold it into the one it wraps and say so in `behaviour_notes`.
- Do include quiet behaviour: caching, invalidation, error paths, migrations, locale handling, event emission. These are the things a rewrite can miss silently.
- `lines` must be real. If you did not open the file, set `confidence: "inferred"` and omit `lines`.

## flows[]

Ordered end-to-end paths, in the shape the repo-workflows viewer expects.

```json
{
  "id": "open-todays-note-from-ribbon",
  "title": "Open today's note from the ribbon icon",
  "description": "One or two sentences.",
  "trigger": "user clicks the ribbon icon",     // what starts it
  "steps": [
    { "from": "cal-main", "to": "cal-view", "action": "reveal the calendar leaf", "payload": "—" },
    { "from": "cal-view", "to": "dni-daily", "action": "look up today's file", "payload": "moment date" }
  ],
  "capabilities": ["create-daily-note"],        // capability ids this flow exercises
  "confidence": "verified"
}
```

`from` / `to` must be module ids you declared in `modules[]`, or an id from
another source if you are sure of it (prefix it, for example `obsidian-api`). Self-steps
(`from == to`) are allowed for internal state updates.

Aim for the flows a *user* would name, not one flow per function. 6-12 per source
is the useful range; a pure library may have fewer.

## settings[]

Every user-configurable value.

```json
{
  "key": "shouldConfirmBeforeCreate",     // the actual key in data.json / the settings interface
  "label": "Confirm before creating a new note",
  "type": "boolean",                      // boolean | string | number | enum | object | array
  "default": true,
  "scope": "global",                      // global | per-granularity | per-calendar-set
  "path": "src/settings.ts:41",
  "affects": ["create-daily-note"],       // capability ids
  "notes": "Dead in the current build — nothing reads it."   // optional; say so when true
}
```

## commands[]

Obsidian command-palette entries and ribbon items.

```json
{
  "id": "calendar:open-weekly-note",   // the registered id
  "name": "Open weekly note",
  "kind": "command",                   // command | ribbon | file-menu | context-menu | hotkey
  "path": "src/main.ts:58",
  "calls": ["create-weekly-note"],     // capability ids
  "condition": "only when weekly notes are enabled"   // or null
}
```

## api_surface[]

Only for units other code imports (libraries, or a plugin exposing an object on
`app.plugins`). Everything another package can reach.

```json
{
  "export": "getDailyNote",
  "kind": "function",                 // function | class | const | type | svelte-component | store | plugin-instance-field
  "signature": "(date: Moment, allFiles: Record<string, TFile>) => TFile | null",
  "path": "src/daily.ts:80",
  "stability": "public",              // public (documented/used cross-repo) | internal | accidental
  "consumers": ["obsidian-calendar-plugin", "obsidian-periodic-notes"]
}
```

## observations[]

Anything a rewrite should know that does not fit above: duplicated logic between
repos, dead code, version skew, a bug, an API that two repos implement
differently, a place where the fork diverges.

```json
{
  "id": "OBS-dni-01",                 // OBS-<your source id>-<nn>, numbered from 01 within your file
  "severity": "P1",                   // P1 blocks the rewrite | P2 causes rework | P3 worth knowing
  "kind": "duplication",              // duplication | dead-code | version-skew | bug | divergence | gap | coupling
  "what": "Both repos implement week-number parsing, with different locale handling.",
  "where": ["dni-parse:src/parse.ts:20", "pn-parser:src/parser.ts:112"],
  "why_it_matters": "Picking either one silently changes which file an existing note maps to."
}
```

`id` is required and permanent. A story or an icebox entry names it to say which
observation it resolves, so it must not be derived from array position: inserting
one observation would repoint every later reference. `merge.py` rejects a missing
id, a duplicate, and any id whose source or number does not match the required
form.

Every `where` entry is checked. The form is
`[<module-id>|<sibling-repo>:]<path>[:<lines>]`, optionally followed by `@<sha>`
or a parenthetical aside, both of which are ignored.

- a `<module-id>` prefix must name a module **of your own source**. A module id
  from another source, or a bare directory name that happens to exist, is not a
  qualifier and fails.
- a `<sibling-repo>` prefix must name one of the declared source roots. This is
  the only way a citation may leave your own root, and only an observation may
  do it — a `defined_in`, setting, command or api path that names another
  repository is an ownership error.
- absolute paths and `..` fail.
- the file must exist and every line you cite must exist in it.

## Categories

Use exactly these ids so the outputs combine cleanly. Pick the closest fit.

| id | label | what belongs here |
|---|---|---|
| `entry` | Plugin lifecycle | onload/onunload, registration, ribbon, plugin instance |
| `notes` | Note resolution & IO | create / open / find / template application, folder handling |
| `dates` | Dates & parsing | format strings, moment/locale, week numbers, granularity math |
| `config` | Settings & storage | settings interfaces, data.json, migrations, calendar sets |
| `ui` | Views & components | Svelte components, views, modals, menus, popovers |
| `state` | Stores & cache | Svelte stores, in-memory caches, invalidation, file watchers |
| `integration` | Cross-plugin | reading another plugin's settings, plugin detection, Templater |
| `external` | Outside the code | Obsidian API, third-party plugins, the vault filesystem |

## Rules that apply to every agent

1. **Read the code.** A capability marked `verified` means you opened the file and
   read the implementation. Do not paraphrase a README and call it verified.
2. **Cite `path:line`** wherever the schema has a slot for it.
3. **Do not write to any repository.** Your only write is the one JSON file named
   in your assignment.
4. **Ignore `node_modules/`, `dist/`, built `main.js`.** Map source only.
5. **Flag rather than guess.** If two readings are possible, put it in
   `observations[]` with `severity: P3` instead of silently picking one.
6. **Valid JSON.** Verify with `python3 -m json.tool <file>` before you finish.
7. Prose in the JSON is **English**, plain and short.
