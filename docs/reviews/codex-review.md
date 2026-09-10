# Verdict

This backlog is not safe to use as an implementation or validation contract. It defers two features that are active in the live vault, contains decisions that contradict the criteria they supposedly settle, and can report a broken story as done. The source map is useful evidence, but its duplicate module IDs, false vault inference, and unchecked citations make its claimed coverage stronger than the data supports.

## Findings

`US-*` is a user story, `AC-*` is an acceptance criterion, `DEC-*` is a decision, and `ICE-*` is a deferred item.

### 1. Critical — ICE-05 defers an enabled workflow on false evidence

**Location:** `docs/backlog/epics/ICE.json:106-126`, especially ICE-05; live vault `.obsidian/community-plugins.json:14`; Periodic Notes `src/main.ts:90-101`

ICE-05 says `nldates-obsidian` is absent and that the command can never appear. The live enabled-plugin list contains `nldates-obsidian`, and Periodic Notes registers **Show date switcher...** when that plugin exists. This is not a speculative capability: the prerequisites are enabled in the vault.

**Required correction:** Move `pn:nl-date-navigator` into a build story. Treat `pn:get-periodic-notes-related` and the Tab hand-off separately if Anna wants to defer those parts; do not defer all three on the false claim that the dependency is absent.

### 2. Critical — ICE-04 mistakes an injected runtime feature for unused template syntax

**Location:** `docs/backlog/epics/ICE.json:86-103`, ICE-04; map observation `vault: enableTimelineComplication=true ... enabled but unused`; Periodic Notes `src/main.ts:80-82`, `src/timeline/manager.ts:14-60`, `src/timeline/Timeline.svelte:26-30`

The evidence test is wrong. `TimelineManager` is constructed on every plugin load, mounts `Timeline.svelte` into open Markdown views, and the component reads `enableTimelineComplication`. Templates and note content do not need to reference it. With the live setting set to `true`, this is active runtime behaviour.

**Required correction:** Replace “enabled but unused” with “enabled and mounted on open periodic notes.” Move the Timeline capability into the build backlog unless Anna explicitly chooses to remove an active feature. This map observation should be P1, not P3.

### 3. Critical — DEC-04 makes migration blind to the actual predecessor plugins

**Location:** `docs/backlog/record_decision.py:210-224`, DEC-04; AC-MIG-06.3; live vault `.obsidian/community-plugins.json:2,17`

DEC-04 requires one canonical ID and drops the `calendar-anks` and `periodic-notes-anks` probes. Those are the enabled Calendar and Periodic Notes IDs in the live vault. The decision therefore prevents the one-time import and coexistence warning from detecting the exact installations this rewrite is replacing.

**Required correction:** State: “During migration and coexistence checks, detect both the published IDs and the known `-anks` IDs present in this vault. Remove the migration aliases only after those predecessors no longer need to be detected.” Delete AC-MIG-06.3’s single-ID implementation constraint.

### 4. Critical — Prefix-matched weekly notes can be indexed but still fail lookup and open

**Location:** map capabilities `pn:allow-prefix-match-gate` and `pn:get-periodic-note`; Periodic Notes `src/cache.ts:205-224,270-289`; live setting `.obsidian/plugins/periodic-notes-anks/data.json:17-23`; AC-FMT-04.4, AC-NOTE-01.1, AC-NOTE-07.2, AC-NOTE-11.3

The map records both halves but never raises the contradiction as a P1 observation. `resolve()` accepts the live vault’s renamed weekly files as inexact prefix matches, but `getPeriodicNote()` returns only entries with `matchData.exact === true`. A pretty weekly file can therefore appear indexed while open-or-create fails to find it and tries to create another note. None of the criteria requires an open or lookup operation to return the existing prefix-matched file.

**Required correction:** Add a P1 observation and an end-to-end criterion: “Given the existing weekly file `YYYY-Wnn, DD.MM - DD.MM.md` and prefix matching enabled, when that week is opened, the existing pretty-named file opens and no raw `YYYY-Wnn.md` duplicate is created.”

### 5. Critical — US-CMD-04 and DEC-10 require opposite products

**Location:** US-CMD-04, AC-CMD-04.1 to AC-CMD-04.3, DEC-10

The story requires a standalone **Open Weekly Note** command. DEC-10 says that command must not exist because the generated weekly command replaces it. Both are recorded on the same story, so no implementation can satisfy the contract.

**Required correction:** Keep the permanent story ID but rename it to “Avoid a duplicate weekly-note command.” Require exactly one generated command that opens the current week and require the legacy standalone command to be absent.

### 6. Critical — A broken story can be marked done

**Location:** `docs/backlog/build_backlog.py:72-99`; `docs/backlog/report.py:37-57`; `docs/calendaric.html:132-136,235-249`

Story status and criterion status are independent. The validator accepts `status: "done"` while criteria are `unverified` or `fail`, and it accepts `pass`, `fail`, or `n-a` with `evidence: null`. The report then counts the story as done even when its card also says criteria are failing.

**Required correction:** Reject `done` unless every criterion is `pass` or a justified `n-a`. Require non-empty evidence for `pass`, `fail`, and `n-a`. Derive the board’s done count from that rule instead of trusting the story field alone.

### 7. Critical — The coverage denominator is editable and is not checked against the map

**Location:** `docs/backlog/build_backlog.py:40-44,141-147`; `docs/mapping/assign_epics.py:128-137`

`build_backlog.py` never loads `calendaric-map.json`. It treats `epic-assignment.json` as the complete universe, so deleting a capability from the assignment deletes it from the denominator. A new map capability with no assignment also passes unnoticed. The displayed percentage is assignment coverage, not map coverage.

**Required correction:** Load `calendaric-map.json` and fail unless the set of assigned UIDs equals the set of mapped capability UIDs exactly, with no duplicate UIDs. Report map total, assigned total, built total, deferred total, and evidence total separately.

### 8. High — Fork module IDs are duplicated, so capability links are ambiguous

**Location:** map modules `dni-index`, `dni-parse`, `dni-settings`, `dni-types`, `pn-cache`, `pn-settings-index`, `pn-types`, and `pn-utils`; fork capabilities such as `forks:dev-plugin-id-fallback`; `docs/mapping/merge.py:207-241`

Each listed module ID occurs once under its source repository and again under `forks`. The fork source root is `/Users/anna.nowak/projects/obsidian`, but fork paths such as `src/index.ts` do not exist relative to that root and do not identify which repository owns the file. `merge.py` converts module IDs to a set and therefore hides the collisions. A link from `forks:dev-plugin-id-fallback` to `dni-index` has two possible targets.

**Required correction:** Use globally unique IDs such as `forks-dni-index` and repository-qualified paths such as `obsidian-daily-notes-interface/src/index.ts`. Make `merge.py` fail on duplicate module IDs before validating references.

### 9. High — Coverage accepts the wrong kind of owner and arbitrary excuses

**Location:** `docs/backlog/build_backlog.py:123-154`

Any owner satisfies `covered`: an ICE entry can cover a build capability, a story can cover an icebox capability, and using an evidence capability in `covers[]` is only a warning. An `uncovered` row can excuse a capability with an empty reason, from the wrong epic, or without naming the story that supposedly carries it.

**Required correction:** Require a build UID to be covered by a story in its assigned epic, an icebox UID to be covered only by ICE, and an evidence UID to appear only in `constrained_by`. Validate non-empty excuse text, the assigned epic, and the referenced carrying story.

### 10. High — “100% capability coverage” ignores settings, commands, flows, and P1 observations

**Location:** `docs/backlog/build_backlog.py:40-44`; `docs/mapping/epic-assignment.json`; US-SET-02

The gate covers only `capabilities[]`. It does not require every mapped setting, command, flow, or P1 observation to affect a story or an explicit deferral. This is how the backlog can claim full coverage while failing to enumerate global settings and while a false P3 vault observation sends an active Timeline feature to the icebox.

**Required correction:** Either promote every user-visible setting, command, and flow to a capability or add separate assignment and coverage checks for them. Require every P1 observation to name the story or ICE decision that resolves it.

### 11. High — Invalid generated data is written before validation fails

**Location:** `docs/backlog/build_backlog.py:193-224`

The script writes `backlog.json` before returning failure. `report.py` and the HTML viewer can then display invalid data from a failed build, which defeats the claim that the build script is a gate.

**Required correction:** Build the output in memory, run all validation, and write `backlog.json` only when there are no problems or missing epic files.

### 12. High — Applying one decision deletes unrelated questions and cannot update its own text

**Location:** `docs/backlog/record_decision.py:241-253`

The recorder clears the entire `open_questions` array for every touched story. US-FMT-04 originally had two independent questions; applying DEC-14 alone erased the question later answered by DEC-15. The early `continue` also means changing a decision in `record_decision.py` and rerunning it leaves the old copy in every story.

**Required correction:** Give questions stable IDs, list the exact resolved question IDs on each decision, and remove only those IDs. Upsert the decision by ID so title, decision, rationale, and date remain synchronized.

### 13. High — DEC-01 erased the question it did not answer

**Location:** original US-FMT-01 question at commit `2298b5d`; current US-FMT-01; DEC-01

US-FMT-01 asked whether an unknown weekday token should remain literal or make format validation reject the format. DEC-01 answers which week-start rule valid weekday tokens use. `record_decision.py` attached DEC-01 and deleted the actual unknown-token question without settling it. AC-FMT-01.4 covers valid weekday tokens in the wrong granularity, not an unknown weekday name.

**Required correction:** Restore the question and decide it explicitly. Add an AC for a token such as `{{funday:DD.MM}}`, with either a specified validation error or specified literal preservation.

### 14. High — DEC-13 contradicts the story it is attached to

**Location:** US-NOTE-10, AC-NOTE-10.1, DEC-13

AC-NOTE-10.1 requires Calendaric to template a matching empty file created manually while the plugin is running. DEC-13 says template application is limited to files Calendaric creates. That forbids the story’s core behaviour.

**Required correction:** State: “A matching empty file discovered during startup is indexed without modification. A matching empty file created while Calendaric is running is templated, regardless of which actor created it.”

### 15. High — DEC-02 is absent from the criteria that are meant to enforce it

**Location:** US-FMT-07, AC-FMT-07.1 to AC-FMT-07.4, DEC-02

DEC-02 requires both filename and configured folder to match. Every FMT-07 criterion speaks only about the filename. An implementation that recognizes same-named files anywhere in the vault passes all four criteria while violating the decision.

**Required correction:** Replace AC-FMT-07.1 with: “Given a Markdown file whose filename matches the daily format and whose path is under the configured daily folder, when its period is resolved, it is recognized as that day’s note.” Add the negative case for the same filename outside that folder.

### 16. High — DEC-09 requires a notice, but AC-CMD-03.2 permits silence

**Location:** US-CMD-03, AC-CMD-03.2, DEC-09

DEC-09 says a command that cannot act must name the missing precondition. AC-CMD-03.2 requires only no exception and no calendar movement. The old silent no-op passes.

**Required correction:** Add: “A notice says that **Reveal active note** needs an open daily or weekly note.”

### 17. High — Desktop-only DEC-03 contradicts the mobile story

**Location:** DEC-03; US-CAL-08 and AC-CAL-08.3; current Calendaric `src/settings.ts:303-311`

DEC-03 makes the whole plugin desktop-only because one guide link calls Electron. US-CAL-08 is explicitly for “a laptop and a phone” and requires a no-hover mobile fallback. The source problem is one replaceable guide-opening call, not evidence that the product must drop mobile.

**Required correction:** Either keep mobile support and replace the Electron-specific guide opener, or remove the phone story and move `calui:popover-mobile-fallback` to an explicit mobile icebox. Do not keep both contracts.

### 18. High — CAL promises third-party indicators that ICE-03 defers

**Location:** AC-CAL-07.4 and AC-CAL-07.5; ICE-03

CAL requires another installed plugin to register an indicator source and requires multiple sources to render together. ICE-03 defers `cal:extend-metadata-sources-via-event` and all non-word-count sources. An external source cannot satisfy CAL if the registration surface is deliberately absent.

**Required correction:** Either move `cal:extend-metadata-sources-via-event` into CAL or narrow AC-CAL-07.4 and AC-CAL-07.5 to multiple built-in sources that actually ship in the release.

### 19. High — The live-vault compatibility criterion states a false file count

**Location:** AC-FMT-04.6 and AC-FMT-04.7; map P3 vault observation beginning “211 of 219 files…”

AC-FMT-04.6 says all 219 daily files have the current `YYYY-MM-DD, dddd` shape and all must resolve. The map itself says only 211 match; seven use the old bare date and one uses an en dash in the date. The criterion is impossible. AC-FMT-04.7 accounts for only seven of the eight non-matching files.

**Required correction:** AC-FMT-04.6 should say “211 current-format daily notes, 60 weekly notes, 21 monthly notes, and 25 monthly-work notes are recognized.” AC-FMT-04.7 should identify all eight exceptional daily files and state the chosen result for each group.

### 20. High — Word-count configuration contradicts itself across epics

**Location:** US-CAL-07 and AC-CAL-07.3; US-SET-02; AC-MIG-03.4; mapped setting `cal:wordsPerDot`

CAL requires configured word-count thresholds. SET never names a control or default for them. MIG then explicitly drops the existing `wordsPerDot` value because Calendaric allegedly has no equivalent field. An implementation can pass SET while providing no way to configure the behaviour CAL requires.

**Required correction:** Add `wordsPerDot` to Calendaric’s global settings with a stated default and invalid-value behaviour, and import it from Calendar. If the setting is intentionally removed, rewrite CAL to specify the fixed threshold and document that product change.

### 21. High — Several UI criteria validate dispatch, not the user-visible result

**Location:** AC-CAL-03.1, AC-CAL-03.2, AC-CAL-03.4, AC-CAL-04.1, AC-CAL-04.3, AC-CAL-05.1, AC-CAL-05.2

These criteria require that a “request is issued.” A handler can emit a request that is dropped, opens the wrong file, or opens in the wrong pane and still pass. This violates `BACKLOG-SCHEMA.md`’s observable-outcome rule.

**Required correction:** Replace “the request is issued” with the final result: “the existing note opens in the active pane,” “the note is created and opens in the active pane,” or “the note opens in a new split,” as applicable.

### 22. High — US-NOTE-11 mandates an index instead of current lookup behaviour

**Location:** US-NOTE-11 and AC-NOTE-11.1 to AC-NOTE-11.7

The whole story requires an internal index outside the permitted ARCH exception. A correct event-driven or on-demand implementation would fail even if every lookup, dot, and navigation result stayed current and fast.

**Required correction:** Rename it to “Keep periodic-note lookup current as vault files change.” Replace internal outcomes with observable ones, for example: “After a matching file is created, the next lookup returns it without a full-vault scan,” and “After it is deleted, the next lookup returns no note.”

### 23. High — Coexistence is not defined strongly enough to prevent double management

**Location:** US-MIG-06 and AC-MIG-06.1

“Calendaric does not silently let both plugins create or manage notes” is satisfied by showing a warning and then allowing both plugins to proceed. That does not meet the story title, which says Calendaric avoids double management.

**Required correction:** Choose and state one enforceable result. For example: “Calendaric does not create or modify notes for an affected granularity until the user disables the predecessor or explicitly chooses Calendaric as the owner.”

### 24. Medium — Implementation constraints leak outside the two allowed places

**Location:** AC-NOTE-04.2 and AC-NOTE-04.3 (“generic entry point”); AC-CAL-01.4 (“not from this view’s own calculation”); AC-MIG-05.5 (“one shared resolution routine”); AC-MIG-06.3 (“probes that single id only”); DEC-08 and DEC-12

These dictate call structure, ownership, or implementation outside ARCH and AC-CAL-05.5. They constrain the rewrite to shapes derived from old code instead of testing behaviour.

**Required correction:** Express equivalent outcomes instead: all supported granularities create notes with the same collision and error behaviour; all displayed week numbers agree for the same date and settings; all predecessors use the same documented precedence. Move shared-routine, adapter, and single-entry-point requirements to ARCH.

### 25. Medium — Quarter is both supported and unsupported

**Location:** AC-ARCH-02.1; AC-NOTE-01.4; AC-NOTE-04.3; ICE-01; US-CMD-05 and US-CMD-09 granularity lists

ARCH calls day, week, month, quarter, and year “the set of supported period granularities.” NOTE uses quarter as the example of an unsupported granularity, and ICE-01 defers it. CMD still lists quarter as in scope for generated commands and startup opening. Agents cannot tell whether quarter paths must work in this release.

**Required correction:** Define the release set once as day, week, month, and year. If the type reserves `quarter` for later, call it a known deferred value and require commands and startup behaviour only for enabled release granularities.

### 26. Medium — DEC-14 invents a user-visible declaration order that does not exist

**Location:** DEC-14; original US-FMT-04 question; Periodic Notes `src/utils.ts:176-189`

The user configures one format. The code derives two candidates from it: the full path format and its basename segment. There is no user-declared candidate list, so “first in declaration order” does not answer the actual tie-break question and is not predictable from the UI.

**Required correction:** State the real order: “Try the full configured path format first. If it does not match, try the derived basename-only format.” Add a criterion for a filename that both derived candidates could parse.

### 27. Medium — DEC-15 drops the condition that makes its rule meaningful

**Location:** DEC-15; AC-FMT-04.5; Daily Notes Interface `src/parse.ts:36-44`

DEC-15 says disambiguation applies whenever a day token is present. The ambiguity exists only when a week-number token is also present. Its rationale claims a `DD`-only format was parsed as a week number, but the source check requires a week token plus a month or day token.

**Required correction:** State: “For weekly formats containing a week-number token, apply week-number precedence when either a month token or a day token is also present.”

### 28. Medium — DEC-17 does not change the live Calendar import case

**Location:** DEC-17; US-MIG-03; live `.obsidian/plugins/calendar-anks/data.json:2-9`

The rationale says the Calendar import would import nothing because its weekly folder, format, and template are blank. AC-MIG-03.3 also imports week start, confirmation, week-number display, and locale, and those live values are not blank. Under DEC-17’s own wording the import remains offered, so the decision does not settle the question it was meant to answer.

**Required correction:** Decide whether display settings alone justify showing the Calendar import. State that answer directly instead of using “every field is empty,” which is false for this vault.

### 29. Medium — Failure-path validation promised by the schema is not enforced or met

**Location:** `docs/mapping/BACKLOG-SCHEMA.md`, acceptance-criteria rule 4; US-FMT-02, US-FMT-06, US-CAL-02, US-CAL-12, US-SET-02, US-SET-05, US-CMD-01, US-CMD-02, US-MIG-03, US-MIG-04, US-ARCH-02

The schema requires at least one failure path per story. These stories contain none, and `build_backlog.py` never checks the rule. The gap matters for imports, overlays, commands, and locale-sensitive calculations because a happy-path-only implementation can pass.

**Required correction:** Add one relevant failure or boundary criterion to each story, or amend the schema to exempt stories for which failure has no meaningful observable result. Make the validator require an explicit `failure_path` marker rather than guessing from prose.

### 30. Medium — Verified Periodic Notes citations include lines that do not exist

**Location:** `docs/mapping/sources/pn.json` citations for Dashboard, Timeline, and five settings components

Seven verified ranges extend one line beyond end of file: Dashboard is 152 lines but is cited as `1-153`; Timeline is 213 but cited as `1-214`; the five settings components have the same off-by-one error. `merge.py` checks neither file existence nor line bounds.

**Required correction:** Correct the seven ranges and make source validation fail when a verified citation path is absent or its maximum cited line exceeds the file length.

### 31. Medium — A P1 observation treats the rewrite’s purpose as a blocker

**Location:** map observation beginning “All UI in this repo ... is plain TypeScript ... not Svelte” in `docs/mapping/sources/calendaric.json`

The observation says reimplementing UI or choosing a framework conflicts with a from-scratch rewrite. Reimplementation is the stated goal. The evidence supports “the old Svelte components are not directly portable,” but not a P1 blocker or a requirement to keep the current hand-built DOM style.

**Required correction:** Downgrade it to P2 and say: “The old Svelte UI cannot be copied into the current DOM-based UI. Choose the new UI boundary deliberately; preserve behaviour, not either repository’s component structure.”

### 32. Medium — The Kanban board cannot tick anything off

**Location:** `docs/calendaric.html:235-249,378-380`

Kanban cards only navigate to story details. There is no status control, checkbox, persistence, or generated edit command. This is a read-only dashboard, not the board Anna asked to tick items off on.

**Required correction:** Either label it “read-only status dashboard” and provide a small status-update command, or add a real control that writes the epic source file and reruns validation. Do not imply that clicking the board records progress.

### 33. Medium — AC-ARCH-06.2 cannot prove its own claims as a unit test

**Location:** AC-ARCH-06.2

“`minAppVersion` is accurate for the Obsidian APIs that release actually uses” has no named source or check, and release-tag equality cannot be tested before a tag exists. Marking the criterion `unit` gives a validator no executable oracle.

**Required correction:** Split it: a static check compares manifest and `versions.json`; a release check compares `manifest.json.version` with the actual tag; an API compatibility check cites the minimum-version source used to justify `minAppVersion`.

## Writing-style findings

### W1. Medium — The mapping schema frames a rewrite as a merge

**Location:** `docs/mapping/SCHEMA.md:3-6`

**Current:** “The end goal ... merge them into a single plugin repo ... Your output must be mechanical enough that another agent can port a feature from it without re-reading the original repo.”

**Replacement:** “The goal is to preserve the useful behaviour in a new plugin, not to merge the old code. Record enough source evidence for an agent to reimplement and verify each behaviour.”

### W2. Medium — The backlog README has no glossary

**Location:** `docs/backlog/README.md`

**Current:** “67 user stories, 309 acceptance criteria”; later sections use “epic,” “granularity,” “coverage,” and “icebox” without defining them.

**Replacement:** Add four one-line definitions after the TL;DR: “Epic — a group of related stories. Granularity — day, week, month, quarter, or year. Coverage — mapped behaviour accounted for by a story or explicit deferral. Icebox — behaviour deliberately excluded from this release.”

### W3. Medium — “Canonical identity” is invented terminology

**Location:** US-FMT-06

**Current:** “Canonical identity for a date and granularity”

**Replacement:** “Treat dates in the same period as the same note date”

### W4. Medium — The ARCH summary is a single overloaded sentence

**Location:** `docs/backlog/epics/ARCH.json:4`

**Current:** The summary combines dependency direction, UI isolation, pure logic, type checking, extensibility, build gates, host failures, and documentation in one sentence.

**Replacement:** “ARCH defines module boundaries, test seams, and release gates. User-visible behaviour belongs to the other epics.”

### W5. Medium — The ICE summary is padded and hides the decision

**Location:** `docs/backlog/epics/ICE.json:4`

**Current:** “26 capabilities ... grouped into seven decision units: a disabled note granularity, a config mechanism with no current second use, three low-traffic calendar indicators...”

**Replacement:** “ICE lists behaviour excluded from the first release and the evidence for each exclusion. Recheck ICE-04 and ICE-05 because their current evidence is false.”

### W6. Low — “Periodic-shaped file” is opaque

**Location:** US-NOTE-10, AC-NOTE-10.3, DEC-13

**Current:** “periodic-shaped file”

**Replacement:** “file whose folder and filename match a configured periodic-note folder and format”

### W7. Low — The template hand-off title says nothing concrete

**Location:** US-TPL-05

**Current:** “Guarantee what happens to a created note's content once an external template engine takes over”

**Replacement:** “Do not reapply a template after note creation”

### W8. Low — “Surface” obscures the thing being protected

**Location:** US-ARCH-07 and DEC-03

**Current:** “Resilient to surfaces the plugin does not own”; “platform-specific surface”

**Replacement:** “Handle changes to Obsidian UI and other plugin APIs”; “desktop-only API”

### W9. Low — “Composition root” and “port interfaces” are unexplained jargon

**Location:** AC-ARCH-01.1 and AC-ARCH-01.3

**Current:** “port interfaces”; “composition root”

**Replacement:** “interfaces used by date, note, and settings logic”; “the plugin lifecycle module where dependencies are connected”

### W10. Low — “Reactive store” assumes framework knowledge

**Location:** US-ARCH-07 rationale and AC-ARCH-07.2

**Current:** “a reactive store rather than a plain value”

**Replacement:** “a state container that must be read through its accessor or subscription API, not as a plain object”

### W11. Low — “Clear, actionable error” is not a test oracle

**Location:** AC-NOTE-01.4, AC-NOTE-04.3, AC-NOTE-04.6, AC-NOTE-07.5

**Current:** “a clear, actionable error is reported”

**Replacement:** Name the required content. For AC-NOTE-04.3: “The error says `Quarter notes are not supported in this release` and no file is created.” Apply the same pattern to the other criteria.

### W12. Low — “Shortly after” is not measurable

**Location:** AC-CAL-08.2

**Current:** “the detail view closes shortly after”

**Replacement:** “the detail view closes within the agreed dismissal delay of ___ ms”

### W13. Low — “Folded into another story” is unexplained report jargon

**Location:** `docs/backlog/report.py:88-90`; `docs/calendaric.html:285`

**Current:** “folded into another story”; “folded in”

**Replacement:** “accounted for without a separate story”

### W14. Low — US-MIG-05 hides its subject behind a 16-word title

**Location:** US-MIG-05

**Current:** “Choose which predecessor plugin's configuration governs a granularity when more than one is active”

**Replacement:** “Choose one import source per granularity”

### W15. Low — US-ARCH-06 repeats the same claim three times

**Location:** US-ARCH-06 story

**Current:** “I want one build to reliably produce the exact release artefacts on a clean checkout while running every quality gate every time, so that a release is never assembled from an inconsistent local state or from a check that quietly stopped running.”

**Replacement:** “As a release owner, I want one clean build to run every gate and produce every release artifact, so that releases are reproducible.”

### W16. Low — ICE-04 uses an unexplained product term

**Location:** ICE-04 title and prose

**Current:** “Timeline complication”

**Replacement:** “Timeline badge and seven-day navigator”
