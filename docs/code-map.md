# Calendaric code map

## TL;DR

Calendaric is an Obsidian plugin written in TypeScript. esbuild bundles `src/main.ts` into `main.js`.

- `src/main.ts` is the only module that builds things. It creates every adapter, the note index, the commands and the settings tab, then hands them inward as interfaces.
- Everything under `src/notes/`, `src/fmt/`, `src/granularity/` and the non-drawing parts of `src/settings/` is plain logic. It never imports `"obsidian"` at runtime, so vitest runs it in Node without Obsidian.
- `src/adapters/` holds the only code that calls Obsidian's API. Each `*Port.ts` file is an interface, and each `obsidian*Adapter.ts` file implements one against the real app.
- `src/arch.test.ts` fails the test run when a module breaks those rules.

To find the code for a feature, start from the [epic table](#where-each-epic-lives). To follow a click to the disk, read [Data flows](#data-flows). For one function's signature and doc comment, use the [API reference](#api-reference).

<details>
<summary>Glossary</summary>

- **Granularity**: a period length. `day`, `week`, `month`, `quarter`, `year`. Quarter is reserved (decision DEC-23): stored, never acted on.
- **Release granularity**: the four the first release acts on, everything but quarter. `RELEASE_GRANULARITIES` in `src/types.ts`.
- **Periodic note**: the note that stands for one period.
- **Note date**: a string that names one period, used as the index key. Two dates in the same week give the same note date for `week`.
- **Port**: a TypeScript interface for something the host provides, such as reading the vault. Logic depends on the port, never on Obsidian.
- **Adapter**: the class that implements a port with Obsidian's API.
- **Fake**: a test implementation of a port, such as `src/adapters/fakeVaultPort.ts`.
- **Predecessor plugin**: Daily Notes (core), Calendar, or Periodic Notes, the plugins Calendaric replaces.
- **Companion plugin**: any other plugin Calendaric reads settings from. That covers the predecessors and Natural Language Dates.
- **Story, AC**: the backlog in `docs/backlog/` holds user stories (`US-CAL-03`) with acceptance criteria (`AC-CAL-03.1`). Code comments and test names cite them.
- **DEC-n**: a recorded product decision. `python3 docs/backlog/report.py` lists them.
- **moment**: the date library Obsidian ships on `window.moment`. The plugin uses that copy and never bundles its own.

</details>

## Folder layout

```
src/
  main.ts            Plugin lifecycle and wiring: the composition root
  settings.ts        The settings tab (draws the screen)
  types.ts           Granularity type lists and the per-granularity config shape
  indicatorContract.ts  The interface a calendar dot ("indicator") implements
  granularity/       One module per granularity, plus registry.ts that lists them
  fmt/               Dates <-> filenames: parse, validate, locale, note date
  notes/             Find, create, open and template periodic notes
  settings/          Config model, stored-data upgrade, import cards and their logic
  commands/          Palette commands, ribbon icon, date phrases
  ui/                Calendar view, its widgets, overlays, modals, period label
  adapters/          Ports (interfaces), Obsidian adapters, test fakes
  __mocks__/         The test stand-in for the "obsidian" package
scripts/             Release gates: verify.mjs, release-check.mjs, and their tests
docs/guide.md        User guide for formats and tokens (tested by src/guide.test.ts)
docs/backlog/        Stories, criteria, decisions, and the scripts that check them
```

## Modules

Each entry says what the module owns and what it depends on. "Pure" means no runtime import of `"obsidian"`.

### Lifecycle and wiring

- **`src/main.ts`**: owns `onload` and `onunload`.
  - Loads settings through `src/settings/upgrade.ts`, applies the locale (`src/fmt/locale.ts`).
  - Builds the adapters and passes them inward: `CalendarDeps` to the view, `SettingsTabPorts` to the settings tab.
  - Creates the note index (`PeriodicNoteIndex`) and the arrival templater once the workspace layout is ready, because both read the whole vault.
  - Registers the view, the commands, the ribbon icon, the hover source and the period labels.
  - `saveSettings` queues writes; `onSettingsChange` rebuilds everything settings feed.
- **`src/types.ts`**: the granularity lists (`ALL_GRANULARITIES`, `RELEASE_GRANULARITIES`) derived from the registry, and `PeriodicConfig`.

### Granularities

- **`src/granularity/registry.ts`**: the one list of granularities, `GRANULARITY_REGISTRY`, narrowest first.
  - Each entry (`day.ts`, `week.ts`, `month.ts`, `quarter.ts`, `year.ts`) carries its label, default format, and optional facts: `release` (the first release acts on it), `cell` (the calendar draws it), `settings` (the settings screen edits it).
  - Only `day` and `week` carry `settings` today, which is why the settings screen shows Monthly, Quarterly and Yearly Notes (plus a Custom Notes group) as disabled placeholders.
  - Adding a granularity is one module plus one registry entry (US-ARCH-05, tested by `src/registry.test.ts`).

### Dates and filenames (`src/fmt/`, pure)

- **`parseFilename.ts`**: turns a filename back into a date for a format, including `{{weekday:fmt}}` spans and prefix matching. Exports `weekSemantics`, which tells ISO weeks from locale weeks.
- **`resolveFileDate.ts`**: given a path and the active configs, answers which granularity and period the file is. Tries day before week before month before year, and checks the folder.
- **`noteDate.ts`**: `computeNoteDate`, the period key two dates share when they fall in the same period.
- **`validateFormat.ts`**: errors and warnings for a format string, shown under the **Format** field.
- **`locale.ts`**: sets the locale and the week start on the shared `window.moment`, and restores them on unload.

### Notes (`src/notes/`, pure)

- **`noteUtils.ts`**: `computeNotePath` (date + config → path), `formatWithWeekTokens`, folder checks, week-number helpers.
- **`periodicNoteIndex.ts`**: `PeriodicNoteIndex`, the map from note date to file. Built from `VaultIndexPort.listNotes()`, kept current by `onChange`. Finds a note by name, prefix match or frontmatter key. Also answers "closest existing note" for the jump commands.
- **`noteCreate.ts`**: `createPeriodicNote` writes one note: creates missing folders, reads the template, fills its tokens, copies its fold state.
- **`templateTokens.ts`**: `substituteTemplateTokens`, the one function that fills `{{date}}`, `{{title}}`, offsets and per-granularity tokens.
- **`validateTemplatePath.ts`**: the problem message for a template path that does not resolve.
- **`templateOnArrival.ts`**: fills an empty file that appears at a periodic note's exact path (US-NOTE-10).
- **`noteOpen.ts`**: opens a found note in the active pane, a split or a new tab, and reports a note that moved.
- **`periodNoteOpen.ts`**: `openOrCreatePeriodNote` for commands and the ribbon, and `startUp` for **Open on startup**.
- **`predecessorGuard.ts`**: refuses creation for a granularity a predecessor plugin still manages, and builds the hand-over notices (US-MIG-06). `guardCreation` attaches the guard to the vault object so the calendar can find it without a new parameter.
- **`listPeriodicNotes.ts`**: lists every note of one granularity.

### Settings (`src/settings.ts`, `src/settings/`)

- **`src/settings.ts`**: `CalendaricSettingsTab`, the screen. Draws each section inside `renderGuardedSection`, so one section failing on a new Obsidian version leaves the others working.
- **`model.ts`** (pure): the stored shape (`StoredConfig` with named `calendarSets`) and the flattened shape the plugin reads (`CalendaricSettings`). `toSettings` and `applySettings` convert between them. `resolveEffectiveConfig` fills an empty format with the default.
- **`upgrade.ts`** (pure): reads whatever `loadData()` returned, upgrades version 1 to version 2, reports a reset.
- **`dailyNotesImport.ts`, `periodicNotesImport.ts`, `calendarImport.ts`, `importSource.ts`** (pure): what each import would change, and which source wins per granularity.
- **`*Card.ts`, `*Modal.ts`**: draw the import cards and their dialogs. The architecture test classifies these by name as view modules.

### Commands (`src/commands/`)

- **`granularityCommands.ts`**: `GranularityCommands.sync` adds and removes the five commands per active granularity. Ids are `<granularity>-<action>` and never change.
- **`jumpCommands.ts`, `openNeighbourCommands.ts`**: the jump and next/previous actions.
- **`revealActiveNoteCommand.ts`, `dateSwitcherCommand.ts`**: those two palette entries.
- **`ribbonIcon.ts`**: the ribbon icon and its menu.
- **`datePhrase.ts`**: turns a typed phrase into suggested periods for the date switcher.

### User interface (`src/ui/`)

- **`CalendarView.ts`**: the Obsidian `ItemView` in the sidebar. Holds one `CalendarWidget`.
- **`calendar.ts`**: `CalendarWidget`, the grid. Renders cells, wires clicks, hovers and context menus, draws indicators.
- **`cellActions.ts`**: what a cell click does, kept out of the DOM handler so tests can drive it: open, guard, confirm, create, open.
- **`calendarNav.ts`**: which month is shown, and following the clock.
- **`calendarUtils.ts`**: the 6-by-7 month grid, weekday headers, week anchors.
- **`calendarDots.ts`, `indicators/`**: which notes exist in view, word counts, and the two built-in indicators.
- **`indicatorDetail.ts`, `overlay.ts`**: the text detail popup and its positioning.
- **`periodLabel.ts`, `dayStrip.ts`**: the label on open notes and its 7-day strip.
- **`calendarCommand.ts`**: **Open calendar**, and the coordinator that stops two calendar leaves from being created.
- **`modal.ts`, `dateSwitcherModal.ts`**: the create confirmation and the date switcher.

### Adapters (`src/adapters/`)

| Port (interface) | Adapter (real Obsidian) | Fake (tests) |
|---|---|---|
| `vaultPort.ts` (`VaultPort`, `VaultIndexPort`, `VaultWritePort`) | `obsidianVaultAdapter.ts` | `fakeVaultPort.ts` |
| `vaultConfigPort.ts` | `obsidianVaultConfigAdapter.ts` | `fakeVaultConfigPort.ts` |
| `workspacePort.ts` | `obsidianWorkspaceAdapter.ts` | `fakeWorkspacePort.ts` |
| `calendarLeafPort.ts` | `obsidianCalendarLeafAdapter.ts` | `fakeCalendarLeafPort.ts` |
| `desktopShellPort.ts` | `electronDesktopShellAdapter.ts` | none |
| `companionPluginPort.ts` | `obsidianCompanionPluginAdapter.ts`, `obsidianPeriodicNotesAdapter.ts`, `obsidianCalendarPluginAdapter.ts`, `obsidianNaturalDatesAdapter.ts` | none |

- **`calendarDeps.ts`**: `CalendarDeps`, the one object of ports the calendar view chain receives.
- **`communityPluginRegistry.ts`**: the only module that reads Obsidian's internal plugin registry (AC-ARCH-07.4).

## Ports, adapters and why pure modules never import "obsidian"

**The rule:** logic depends on interfaces, and only `src/main.ts` names a real implementation.

```
            src/main.ts  (builds adapters, passes ports in; nothing imports it)
           /     |      \
     view       domain   adapters/*Adapter.ts  ---> Obsidian API
  (src/ui,     (notes, fmt,       ^
  settings.ts,  granularity,      | implements
  *Card/*Modal) settings model)   |
        \         |         adapters/*Port.ts (interfaces)
         `--------+-------------->
```

**Why:**

- The npm `obsidian` package carries type definitions, not a working app. Code that calls it at runtime can only run inside Obsidian.
- Logic that takes a port can be tested against a fake in vitest, in a few milliseconds, without Obsidian.
- When Obsidian changes an API, the fix lands in one adapter, not across the logic.
- `import type { … } from "obsidian"` is allowed anywhere. TypeScript erases it, so it creates no runtime dependency.

**What enforces it:** `src/arch.test.ts` reads every non-test module under `src/`, sorts it into a layer by path, and asserts:

- AC-ARCH-01.1: no module but `src/main.ts` imports a concrete adapter at runtime.
- AC-ARCH-01.2: no domain module imports `"obsidian"` at runtime, or imports an adapter or a view module.
- AC-ARCH-01.3: `src/main.ts` reaches every layer, and nothing imports `src/main.ts` at runtime.
- AC-ARCH-03.4: three named pure modules import nothing from `"obsidian"`, type imports included.
- AC-ARCH-11.1 to 11.3 and 11.5: the calendar view chain (`CalendarView.ts` → `calendar.ts` → `calendarDots.ts`) takes one required `deps: CalendarDeps` parameter and never reads `app.vault`. AC-ARCH-11.4 (the view renders and reacts to a vault change with fake ports only) is asserted in `src/ui/calendarFakes.test.ts`.

**moment follows the same idea.** No module under `src/` imports `"moment"`, not even as a type. The `Moment` type comes from `src/types.ts`, which reads it off `window.moment` (`ReturnType<typeof window.moment>`). At runtime every module reads `window.moment`, the copy Obsidian provides, so the bundle carries no second copy. The Obsidian lint preset warns on a `"moment"` import (`@typescript-eslint/no-restricted-imports`). The one exception is `src/ui/test-setup.ts`, which puts the npm `moment` package on `window.moment` for the tests.

## Data flows

### Click a day cell → note opened or created

```
CalendarWidget.handleNoteClick              src/ui/calendar.ts
  deps.notes.get(granularity, date)         PeriodicNoteIndex.get, wired in src/main.ts
  ├─ found  → openNote                      src/notes/noteOpen.ts
  │            WorkspacePort.openInLeaf     src/adapters/obsidianWorkspaceAdapter.ts
  └─ missing → openOrCreateNote             src/ui/cellActions.ts
       computeNotePath                      src/notes/noteUtils.ts
       creationRefused                      src/notes/predecessorGuard.ts  (stop + notice)
       confirmCreate → ConfirmationModal    src/ui/modal.ts  (when confirmBeforeCreate)
       createNoteInTurn                     src/ui/cellActions.ts  (one write per folder at a time)
         createPeriodicNote                 src/notes/noteCreate.ts
           ensureFolderChain, readTemplate
           substituteTemplateTokens         src/notes/templateTokens.ts
           VaultPort.createFile             src/adapters/obsidianVaultAdapter.ts  → file on disk
       openNote                             src/notes/noteOpen.ts
```

After the write, Obsidian fires a vault `create` event. The adapter's `onChange` passes it to:

- `PeriodicNoteIndex`, which files the new note
- `templateOnArrival`, which sees a non-empty file and does nothing
- `DotScanner` (`src/ui/calendarDots.ts`), which redraws the grid with a dot

### Command → note

```
palette → GranularityCommands callback      src/commands/granularityCommands.ts
  CalendaricPlugin.runGranularityCommand     src/main.ts
  ├─ open-current  → openPeriodNote(today)
  │    index.get → openOrCreatePeriodNote    src/notes/periodNoteOpen.ts
  │      creationRefused → createPeriodicNote → openNoteIn   (no confirmation dialog)
  ├─ open-next / open-previous → openNeighbourNote   src/commands/openNeighbourCommands.ts
  └─ jump-forward / jump-backward → jumpToClosestNote src/commands/jumpCommands.ts
                                     (index.closestTo, never creates)
```

The ribbon icon, the date switcher and the day strip all reach `openPeriodNote` in `src/main.ts` too.

### Settings change → re-render

```
field onChange                               src/settings.ts
  CalendaricSettingsTab.save
    plugin.saveSettings                      src/main.ts  (applySettings → saveData, queued)
    plugin.onSettingsChange
      applyLocaleSettings                    src/fmt/locale.ts
      rebuildFromSettings                    src/main.ts
        index.applySettings                  which files count as notes
        commands.sync                        add/remove palette commands
        ribbon.sync                          tooltip and menu
        periodLabels.sync                    labels on open notes
        CalendarView.refresh → CalendarWidget.refreshSettings → render()
```

A failed save restores the in-memory settings from the last good write and redraws the tab (AC-SET-07.4).

## Where each epic lives

The backlog groups stories into epics. `python3 docs/backlog/report.py` shows their progress. Story text lives in `docs/backlog/epics/<EPIC>.json`.

| Epic | What it covers | Main folders and files |
|---|---|---|
| NOTE | Finding, creating, opening and templating periodic notes | `src/notes/` (`periodicNoteIndex.ts`, `noteCreate.ts`, `noteOpen.ts`, `periodNoteOpen.ts`, `noteUtils.ts`, `templateOnArrival.ts`, `listPeriodicNotes.ts`), `src/ui/cellActions.ts` |
| FMT | Formats, filename parsing, week rules, locale | `src/fmt/` (`parseFilename.ts`, `resolveFileDate.ts`, `noteDate.ts`, `validateFormat.ts`, `locale.ts`), `src/notes/noteUtils.ts` |
| TPL | Template tokens and template path checks | `src/notes/templateTokens.ts`, `src/notes/validateTemplatePath.ts`, `src/notes/noteCreate.ts`, `src/granularity/week.ts` |
| CAL | The calendar view and everything drawn in it | `src/ui/` (`CalendarView.ts`, `calendar.ts`, `calendarNav.ts`, `calendarDots.ts`, `indicators/`, `indicatorDetail.ts`, `overlay.ts`, `periodLabel.ts`, `dayStrip.ts`), `src/indicatorContract.ts` |
| SET | The settings model, screen, persistence | `src/settings.ts`, `src/settings/model.ts`, `src/settings/upgrade.ts`, `src/main.ts` (`loadSettings`, `saveSettings`) |
| CMD | Palette commands, ribbon, startup, date switcher | `src/commands/`, `src/ui/calendarCommand.ts`, `src/ui/dateSwitcherModal.ts`, `src/notes/periodNoteOpen.ts` (`startUp`) |
| MIG | Imports from predecessors, the predecessor guard, stored-data upgrades | `src/settings/` (`dailyNotesImport.ts`, `periodicNotesImport.ts`, `calendarImport.ts`, `importSource.ts`, the `*Card.ts` and `*Modal.ts` files, `upgrade.ts`), `src/notes/predecessorGuard.ts`, `src/adapters/companionPluginPort.ts`, `src/adapters/communityPluginRegistry.ts` |
| ICE | Behaviour kept out of the first release, with the evidence for each exclusion | No code: `docs/backlog/epics/ICE.json` only |
| ARCH | Layering, one registry, testability, build and release gates | `src/arch.test.ts`, `src/arch.duplication.test.ts`, `src/registry.test.ts`, `src/granularity/`, `src/adapters/`, `scripts/verify.mjs`, `scripts/release-check.mjs`, `.github/workflows/ci.yml`, `tsconfig.json` |

To find the code behind one criterion, search for its id: `grep -rn "AC-CAL-05.3" src`.

## Tests

**Where they live:** next to the code, as `<module>.test.ts` or `<module>.<topic>.test.ts`. A few more sit in `scripts/` (`*.test.mjs`, `templateGuard.test.ts`).

**How they run:**

- vitest, configured in `vitest.config.ts`.
- `"obsidian"` is aliased to `src/__mocks__/obsidian.ts`, a small hand-written stand-in.
- `src/ui/test-setup.ts` runs before every file and puts `moment` on `window.moment`.
- Tests that need a DOM start with the comment `// @vitest-environment happy-dom`. `src/__mocks__/obsidianDom.ts` adds Obsidian's element helpers such as `createDiv`.
- Logic tests use the fakes in `src/adapters/fake*.ts` instead of Obsidian.
- Test names start with the criterion they prove, for example `"AC-CMD-05.2: …"`. `npm run check:ac` checks that every passing criterion is backed by a test.

**Commands:**

| Goal | Command |
|---|---|
| Run everything | `npm test` |
| Run one file | `npx vitest run src/ui/calendarNav.test.ts` |
| Run tests whose name matches | `npx vitest run -t "AC-CAL-02"` |
| Watch while editing | `npm run test:watch` |
| Type-check, tests included | `npm run typecheck` |
| Build `main.js` | `npm run build` |
| Typecheck, lint and test as one gate | `npm run verify` |
| Build the API reference | `npm run docs` |

## API reference

TypeDoc turns the doc comments in `src/` into HTML pages, one per module.

- **Published site:** <http://anks.pl/obsidian-calendaric/>. `.github/workflows/docs.yml` rebuilds it on every push to `master`.
- **Local build:** `npm run docs` writes the pages to `dist/docs/`. Open `dist/docs/index.html`. The folder is gitignored.
- **What it covers:** every module under `src/`, except `*.test.ts` files and `src/__mocks__/`. The settings live in `typedoc.json`.
- **Types a module does not export** still get a page, under that module's `<internal>` group. The `typedoc-plugin-missing-exports` plugin adds them, so a signature never names a type you cannot open.
- **Obsidian's own types** are not documented here. A reference to one links to Obsidian's API docs instead.
- **Warnings fail the build** (`treatWarningsAsErrors`). A broken `{@link}` or a bad doc tag stops `npm run docs` with a non-zero exit code.

## Where to look when something breaks

| Symptom | Start here |
|---|---|
| A click opens the wrong note, or creates a second one | `src/notes/periodicNoteIndex.ts`, `src/fmt/resolveFileDate.ts` |
| A filename is wrong | `src/notes/noteUtils.ts` (`computeNotePath`, `formatWithWeekTokens`) |
| A week number or week row is off by one | `src/ui/calendarUtils.ts` (`getWeekAnchor`), `src/fmt/locale.ts`, `src/granularity/week.ts` |
| A template variable is not filled | `src/notes/templateTokens.ts` |
| A command is missing from the palette | `src/commands/granularityCommands.ts` (`sync`, `availability`) |
| "still manages … notes" when you did not expect it | `src/notes/predecessorGuard.ts`, the companion adapters in `src/adapters/` |
| Settings reset after an update | `src/settings/upgrade.ts`, `src/settings/model.ts` |
| A settings section reads "… is unavailable" | the section's render function in `src/settings.ts`; the error is in the developer console |
| A dot is missing | `src/ui/calendarDots.ts` (scans exact format paths only) |
