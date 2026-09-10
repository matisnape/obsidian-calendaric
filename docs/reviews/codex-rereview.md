# Verdict

The fixes close most original defects, but the backlog is still not safe as an implementation or validation contract. Two new gates accept malformed values, both restored features are incomplete, and several decisions contradict stories that predate them. Stop here: do not perform the writing-style pass until the findings below are fixed.

## Findings

### 1. Critical — an unknown assignment role removes a capability from the coverage denominator

**Location:** `docs/backlog/build_backlog.py:44-49,183-204`

`role` is never checked against `build`, `icebox`, and `evidence`. The coverage sets are created by filtering for those three strings, so an unknown value disappears from every denominator while the UID-set comparison still passes.

The exact mutated assignment record was:

```json
{
  "uid": "dni:create-daily-note",
  "epic": "NOTE",
  "role": "buid",
  "name": "Create a daily note",
  "surface": "api",
  "category": "notes",
  "source": "dni"
}
```

`build_backlog.py` returned 0 and printed `coverage: 155/156 build capabilities have a story, 1 excused with a reason; icebox 22/22` followed by `no problems`. The unmodified baseline is `156/157`, so the malformed role removed this capability from the gate.

Role enforcement is also incomplete at the consumer: replacing US-FMT-04's evidence constraint `vault:create-daily-note` with the build capability `dni:create-daily-note` in `constrained_by[]` returned 0 and printed `no problems`. The committed assignments and constraints do not contain either malformed value, so these are latent gate defects rather than current ownership corruption.

**Required correction:** Reject every assignment whose `role` is not exactly `build`, `icebox`, or `evidence`, reject unknown epic IDs before constructing any coverage set, and require every `constrained_by[]` UID to have role `evidence`.

### 2. High — the failure-path gate accepts the string `"false"` as true

**Location:** `docs/backlog/build_backlog.py:140-144`; AC-NOTE-06.4

The check uses Python truthiness instead of requiring a JSON boolean. US-NOTE-06 has exactly one marked failure criterion. This exact mutation passed:

```json
{
  "id": "AC-NOTE-06.4",
  "given": "the resolved file was deleted or moved between being found and being opened",
  "when": "opening it is attempted",
  "then": [
    "a clear notice is shown",
    "no unrelated file is opened in its place"
  ],
  "verifies": "behaviour",
  "testable_by": "integration",
  "status": "unverified",
  "evidence": null,
  "failure_path": "false"
}
```

`build_backlog.py` returned 0 and printed `no problems`. The committed data uses real booleans, so this is a latent gate defect, not current data corruption.

**Required correction:** Require `failure_path is true` for the marked criterion and reject any present `failure_path` value that is not a JSON boolean.

### 3. High — the citation gate does not validate the citations it claims to validate

**Location:** `docs/mapping/merge.py:171-194`; `docs/mapping/README.md:55-59`

The checker visits only `capabilities[].defined_in`, accepts only a single `N-N` range, checks only the range end, and silently skips every other line syntax. Five real citations are therefore unchecked: `38-44, 300-322`, and the single-line values `33`, `40`, `43`, and `18`.

Changing `dni:create-daily-note.defined_in[0].lines` from `"17-72"` to `"999-1"` reproduced the defect. `merge.py` returned 0, wrote the map, and printed `no reference problems` because it never checks that the start is positive, within the file, or no greater than the end.

**Required correction:** Parse every supported single-line, range, and multi-range form; require positive `start <= end`; check both bounds; reject malformed line specifications; and either validate citations in every mapped record type or narrow the README claim to the exact checked field.

### 4. High — module validation still permits duplicate UIDs and ignores dependency edges

**Location:** `docs/mapping/merge.py:262-340`

The set at line 265 collapses duplicate UIDs before validation. Appending a second copy of the first DNI module made `merge.py` return 0 and write 141 module records with only 140 unique UIDs.

`modules[].depends_on[]` is canonicalised but never passed to `check_module_ref`. The committed map consequently contains nine dependency edges to four module IDs declared nowhere: `external-moment`, `external-obsidian-daily-notes-interface`, `external-popperjs-svelte`, and `external-svelte-portal`.

**Required correction:** Reject duplicate `module.uid` values before building sets, validate every `depends_on` edge with the same reference checker, and either declare those four external modules or point the edges at declared shared external modules.

### 5. High — observation IDs are positional, so coverage can silently resolve a different observation

**Location:** `docs/mapping/merge.py:228-231`; `docs/mapping/README.md:53`; story and ICE `resolves[]` values

`OBS-01`, `OBS-02`, and so on are assigned from concatenation order. Inserting or reordering an observation changes every later ID while stories continue to carry the old strings. A reorder can leave the P1 count at 15/15 and still make a story resolve the wrong problem.

**Required correction:** Give each source observation a permanent source-qualified ID, reject duplicates, and preserve that ID through merging. Do not use array position as a reporting or join key.

### 6. High — DEC-23 still generates quarter behavior in three command stories

**Location:** DEC-23; US-CMD-06; US-CMD-07; US-CMD-08 and AC-CMD-08.1

DEC-23 says the first release generates no quarter command, creates no quarter note, and offers no quarter view. US-CMD-06 and US-CMD-07 still include quarter in their supported granularities, and AC-CMD-08.1 explicitly orders the ribbon as `day, week, month, quarter, year`.

**Required correction:** Remove quarter from US-CMD-06, US-CMD-07, US-CMD-08, and AC-CMD-08.1. If reserved quarter configuration is present, add a negative criterion that it produces no command or ribbon entry.

### 7. High — the mobile deferral still claims its mobile capability as built

**Location:** DEC-24; US-CAL-08 `covers[]`; ICE-08; `docs/mapping/epic-assignment.json` record `calui:popover-mobile-fallback`

DEC-24 and ICE-08 defer phone and tablet support. US-CAL-08 nevertheless covers `calui:popover-mobile-fallback`, whose mapped behavior is explicitly the `IS_MOBILE` inline metadata box, and the assignment still marks it `role: "build"`. ICE-08 covers nothing, so coverage reports the deferred mobile behavior as delivered by a desktop keyboard/touchscreen story that cannot exercise it.

**Required correction:** Move `calui:popover-mobile-fallback` to ICE-08 with role `icebox`. If desktop pointer-free access needs its own mapped capability, add one and let US-CAL-08 cover that instead.

### 8. High — DEC-25 can resume Calendaric while the predecessor still writes the same notes

**Location:** DEC-25; AC-MIG-06.5

The decision says management resumes when the user “picks Calendaric as the owner in the notice,” but it does not disable the predecessor or require the predecessor's granularity setting to be disabled. Both plugins can therefore resume writing the same note, which is the race DEC-25 says it prevents.

**Required correction:** Say: “Calendaric resumes management only after the predecessor is disabled for that granularity.” If the notice performs that change itself, AC-MIG-06.5 must verify the predecessor is disabled before Calendaric writes.

### 9. High — US-CAL-13 does not carry all behavior in the Timeline capability it claims

**Location:** US-CAL-13; `obsidian-periodic-notes/src/timeline/Timeline.svelte:52-65,67-69,87-107,109-128`

The source shows an arrow for an inexact prefix match, updates already-open panes when the setting changes, and opens an existing neighboring daily note as well as creating a missing one. US-CAL-13 tests none of those: AC-CAL-13.5 covers only a missing neighboring note, and AC-CAL-13.3 can pass if the setting is disabled before the note opens.

**Required correction:** Add criteria that an inexactly matched note shows the marker; toggling the setting updates notes already open; and selecting a neighboring day with an existing note opens that file without creating another.

### 10. High — US-CMD-10 claims the whole date-switcher capability but omits three source behaviors

**Location:** US-CMD-10; `obsidian-periodic-notes/src/main.ts:90-101`; `src/switcher/switcher.ts:194-235`; mapped capability `pn:nl-date-navigator`

The command is available only when the natural-language plugin exists and an active leaf exists. Cmd/Ctrl+Enter opens the selected result in a new split. Suggestions also show a `+N` badge from `getPeriodicNotes`, which US-CMD-10 explicitly leaves deferred with the related-files lookup. None of these behaviors has a criterion, although the story covers the unsplit `pn:nl-date-navigator` capability.

**Required correction:** Add the active-leaf and split-pane criteria. Either build the related-note count and test its badge, or split the mapped capability so the badge and its lookup are explicitly carried by ICE-05 rather than falsely covered by US-CMD-10.

### 11. High — AC-ARCH-08.2 still permits the behavior DEC-01 forbids

**Location:** DEC-01; AC-ARCH-08.2

DEC-01 makes the configured week-start day authoritative and forbids fixed ISO numbering. AC-ARCH-08.2 says fixed numbering may be kept if the guide is edited. An implementation can therefore pass the criterion while violating the decision.

**Required correction:** Delete the alternative. The criterion should say only: “Week-based tokens and week numbers use the configured Start week on day, and the guide states that behavior.”

### 12. Medium — decision recording is selective but not validating or atomic

**Location:** `docs/backlog/record_decision.py:368-405`; `docs/backlog/README.md:104-114`

The tool prints an unknown resolved question as a warning and still returns 0. A temporary new `DEC-99` resolving closed `Q-FMT-01.1` printed `claims to resolve ... but no such question is open`, then `recorded against 1 stories`, with exit code 0. Pointing DEC-21 at nonexistent `US-FMT-99` printed `recorded against 0 stories` and also returned 0.

Only DEC-21 of the 25 canonical decisions contains `resolves`, and copied decision records omit the field entirely, despite the README saying a decision names the exact question IDs it answers. The tool can therefore lose the decision-to-question audit trail and certify a typo that applied nothing.

**Required correction:** Prevalidate all target epics, stories, and question IDs before writing; fail on an unknown or already-closed question unless explicitly declared as a text-only update; fail when any named story is missing; persist `resolves`; and write no epic file unless the complete operation validates.

### 13. Medium — three CAL criteria still validate dispatch instead of a visible result

**Location:** AC-CAL-03.3; AC-CAL-03.5; AC-CAL-04.4

AC-CAL-03.3 accepts a confirmation if it “issues the create-and-open request,” even when no file opens. The preview criteria pass when a native preview is merely “requested,” even if no preview appears or the wrong note is shown.

**Required correction:** AC-CAL-03.3 should require that accepting creates the note and opens it in the requested pane. Split each preview criterion into observable existing-note and missing-note outcomes: require the correct preview to appear without navigation for an existing note, and state explicitly what the user sees and that no file is created when the note is absent.

### 14. Medium — AC-CAL-07.3 gives the wrong word-count threshold rule

**Location:** AC-CAL-07.3; `obsidian-calendar-plugin/src/ui/sources/wordCount.ts:14-23`

The source computes `clamp(floor(wordCount / threshold), 1, 5)`. With a threshold of 250, counts from 1 through 499 show one filled dot and 500 shows two. “One additional dot segment ... for each multiple ... crossed” implies an additional segment at 250 and does not define the boundary precisely enough to preserve the mapped behavior.

**Required correction:** Replace the prose with examples that fix the boundary: `1`, `249`, `250`, and `499` words produce one segment; `500` produces two; and `1250` or more produces five when the threshold is 250.

### 15. Medium — the icebox still contains the evidence and scope errors its reversals were meant to remove

**Location:** `docs/backlog/epics/ICE.json:4`; ICE-03; ICE-05

The summary still says 26 capabilities in seven units, calls Timeline “on but unused,” and says two switchers depend on a plugin the user does not run. The current icebox has 22 assigned capabilities and eight entries; Timeline and the date jump were restored because those two claims were false.

ICE-03 still says the deferred sources include the plain has-note dot, which US-CAL-07 now builds, while omitting the deferred streak source from its description. ICE-05 still describes the built natural-language date jump, says to revisit when the user installs an already enabled plugin, says the plugin is not run, and requires NOTE to build the lookup that ICE-05 itself defers.

**Required correction:** Recount and rewrite the summary from the current assignments. Describe ICE-03 as streak, tag, task, and extension sources only. Describe ICE-05 as only the related-note count/list and Tab hand-off; remove the false install condition and either defer its lookup consistently or move that lookup into a build story.

### 16. Medium — DEC-03's adapter requirement has no acceptance criterion

**Location:** DEC-03; US-SET-04; AC-SET-04.6; AC-ARCH-08.3

DEC-03 requires every desktop-only API call to sit behind one adapter. AC-SET-04.6 checks only `isDesktopOnly: true`; AC-ARCH-08.3 constrains the guide opener only if mobile support is declared. An implementation can call Electron directly from a view and pass every criterion while making ICE-08's stated path to mobile false.

**Required correction:** Add an architecture criterion that all desktop-only imports and calls are confined to one named adapter boundary and that views and settings code depend only on its interface.

## Original finding disposition

1. **Partial** — the date jump moved to CMD, but US-CMD-10 is incomplete and ICE-05 remains stale.
2. **Partial** — Timeline moved to CAL, but US-CAL-13 is incomplete and the ICE summary repeats the false inference.
3. **Resolved** — DEC-04 now detects published and `-anks` predecessor IDs.
4. **Resolved** — the prefix-match contradiction is P1 and the lookup/open contract carries it.
5. **Resolved** — US-CMD-04 and DEC-10 now require one product.
6. **Resolved** — `done`, judged evidence, and justified `n-a` are gated; current data has no invalid status.
7. **Partial** — UID-set equality is enforced, but an unknown role still removes a UID from the denominator.
8. **Partial** — current module UIDs are unique and fork paths identify their repositories, but duplicate UIDs and dependency references are not gated.
9. **Partial** — ordinary owner-kind errors are rejected, but unknown assignment roles and build capabilities in `constrained_by[]` still pass.
10. **Resolved** — settings, commands, flows, and P1 observations are included in coverage.
11. **Resolved** — generated backlog output is written only after successful validation.
12. **Partial** — question removal is selective and decisions upsert, but invalid question/story targets remain successful and provenance is not preserved.
13. **Resolved** — DEC-21 answers the unknown-token question and adds criteria.
14. **Resolved** — DEC-13 and US-NOTE-10 now draw the same startup boundary.
15. **Resolved** — FMT-07 now requires the configured folder as well as the filename.
16. **Resolved** — the unavailable reveal command now gives the required notice.
17. **Partial** — the phone promise was removed, but the mobile capability is still assigned to and covered by CAL, and the adapter is unenforced.
18. **Resolved** — CAL now promises only the two built-in sources that ship.
19. **Resolved** — the vault counts and all eight exceptional daily notes are stated correctly.
20. **Resolved** — words-per-dot is now a setting and an imported value; AC-CAL-07.3 has a separate boundary defect.
21. **Partial** — the seven cited request-only criteria were corrected, but three other CAL criteria retain the same defect.
22. **Resolved** — US-NOTE-11 and its criteria now specify current lookup behavior without requiring an index.
23. **Partial** — Calendaric refuses writes initially, but the owner-selection path can restore double management.
24. **Resolved** — the three criteria in the corrected scope no longer dictate the old implementation; architecture-marked MIG criteria remain schema-exempt.
25. **Partial** — DEC-23 fixes NOTE, ARCH, CMD-05, and CMD-09, but CMD-06 through CMD-08 still include quarter.
26. **Resolved** — DEC-14 and US-FMT-08 state the actual full-format-first order.
27. **Resolved** — DEC-15 now matches AC-FMT-04.5 and the source precondition.
28. **Resolved** — DEC-17 now treats non-empty display and behavior settings as importable values.
29. **Partial** — all stories carry a marked failure path, but the validator accepts a string `"false"` as the marker.
30. **Partial** — the seven ranges were corrected, but the new citation gate skips valid syntaxes and accepts invalid ranges.
31. **Resolved** — the Svelte observation is P2 and states the planning consequence accurately.
32. **Resolved** — the board is labelled read-only and `set_status.py` supplies a validated write path with rollback.
33. **Resolved** — release metadata, tag, and API-minimum checks are now separate criteria with appropriate checks.

## Evolution note

Validators must reject unknown discriminator values and require literal booleans. Building coverage sets by filtering known values and testing flags by truthiness lets malformed records disappear from gates while validation reports success.
