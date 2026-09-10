# Verdict

The round-three fixes close most of the re-review, but the result is not clean. `record_decision.py` batch mode still exits successfully after a failed decision, citation validation still has bypasses, and the Timeline split drops behaviour. The writing-style pass was therefore not run.

## Findings

### 1. Critical — batch decision recording reports success after a decision fails

**Location:** `docs/backlog/record_decision.py:440-444`

The single-decision path now fails correctly, but the no-argument path ignores every return code. Changing DEC-25's target from `US-MIG-06` to `US-MIG-99` reproduced both outcomes: `python3 record_decision.py DEC-25` returned 1, while `python3 record_decision.py` printed the same failure and returned 0. Decisions before and after the failure are still written, so batch mode is neither atomic nor a gate.

**Required correction:** Prevalidate every decision before writing any epic file, then apply all of them only if the complete batch validates. At minimum, aggregate return codes and exit non-zero, but that alone does not prevent partial writes.

### 2. High — citation validation still has three fail-open paths

**Location:** `docs/mapping/merge.py:215-258`; `docs/mapping/README.md:55-59`

The range parser is fixed, but the surrounding citation collector silently skips malformed records:

- setting a source's `source.path` to `""` disabled every citation check for that source; `merge.py` returned 0 and printed `no reference problems`
- setting `dni:create-daily-note.defined_in[0].path` to the number `7` also returned 0 because non-string paths are skipped
- changing `observations[0].where[0]` to `src/does-not-exist.ts:999` returned 0 because observation citations are never collected

A path ending in `/` is also accepted without checking that the directory exists. The README's claim that every `path:line` is checked remains false.

**Required correction:** Validate every source root before checking records; reject missing or non-string citation paths; validate `observations[].where`; and either check directory citations or represent them with an explicit, validated directory field. Use `api_surface.export`, not the nonexistent `api_surface.id`, in diagnostics.

### 3. High — US-CAL-14 drops navigation from non-daily periodic notes

**Location:** US-CAL-14 and AC-CAL-14.1; `obsidian-periodic-notes/src/timeline/Timeline.svelte:101-128`; mapped capability `pn:timeline-complication-render`

The source renders and opens the seven-day strip whenever `periodicData` exists; it has no daily-granularity guard. The mapped capability likewise says the strip appears on any open periodic note. The split story declares only `day`, and AC-CAL-14.1 requires an open daily note, so weekly, monthly, and yearly notes lose a working navigation path.

**Required correction:** Put day, week, month, and year in US-CAL-14's granularity list. Require the strip and its day navigation to work when the label belongs to any supported periodic-note granularity.

### 4. Medium — the Timeline split leaves one capability owned twice, and duplicate ownership cannot fail validation

**Location:** US-CAL-13 `covers[]`; US-CAL-14 `covers[]`; `docs/backlog/build_backlog.py:241-243`

Both stories claim `pn:timeline-complication-render`, because that mapped capability still combines the label and day strip that the backlog split apart. The validator is silent for two owners. Adding a third owner produced only `is claimed by 3 stories`, then `no problems`, with exit code 0.

This makes the reporting owner ambiguous and gives an accidental duplicate claim no failing gate. Other capabilities are legitimately shared, so rejecting every duplicate without context would be too blunt.

**Required correction:** Split the mapped capability into label-render and day-strip-navigation capabilities, then give one to each story. For genuinely shared capabilities, require an explicit shared-coverage reason; reject unmarked duplicate owners instead of warning only above an arbitrary count of two.

### 5. Medium — decision-to-question provenance is still absent for 24 decisions

**Location:** `docs/backlog/record_decision.py` DEC-01 to DEC-25; `docs/backlog/README.md:104-114`

At commit `2298b5d`, the stories contained 24 open questions. Only DEC-21 now has a non-empty `resolves`; the other 24 decisions record `resolves: []`. Adding an empty field does not identify which question a decision answered.

The README now says the stories surfaced 25 questions and that every decision names exact question IDs. Both claims are false: the original backlog had 24 questions, DEC-21 repaired one of those answers, and DEC-22 to DEC-25 were later review decisions rather than new question objects.

**Required correction:** Assign stable IDs to the 24 original questions and map each applicable decision to the IDs it answered. Keep an empty `resolves` only for later decisions that did not answer a recorded question, and make the README distinguish the 24 questions from the 25 total decisions.

### 6. Medium — source-qualified observation IDs are not part of the schema or validation contract

**Location:** `docs/mapping/merge.py:294-302`; `docs/mapping/SCHEMA.md:159-172`; `docs/mapping/README.md:53`

Current observation IDs are stable and duplicates fail, but any non-empty unique string passes. Replacing `OBS-dni-01` with `banana` returned 0 and printed `no reference problems`. The schema's observation example has no `id`, while the README still describes positional `OBS-nn` IDs; an agent following the documented contract will produce data that the merger rejects or identifiers that do not support source-based reporting.

**Required correction:** Add required `id: "OBS-<source>-<nn>"` to the schema, update the README, and make `merge.py` reject an ID whose prefix does not match the record's source or whose suffix is not the required stable form.

### 7. Medium — ICE-05 still repeats the false plugin-absence claim

**Location:** ICE-05 `risk_of_deferring`, `docs/backlog/epics/ICE.json:123`

The entry now correctly says `nldates-obsidian` is installed and enabled, but its risk still says the deferred feature “would depend on a plugin she doesn't run.” That is the exact false evidence the reversal was meant to remove.

**Required correction:** Replace it with: “Minor — direct date jumping remains available, but the switcher does not show related-note counts or provide the Tab hand-off to the related-note list.”

## Re-review finding disposition

1. **Resolved** — invalid assignment roles and epic IDs fail before coverage sets are built, and `constrained_by[]` accepts only evidence capabilities.
2. **Resolved** — non-boolean `failure_path` values fail, and the story gate requires a literal `true`.
3. **Partial** — valid line forms and bounds are checked, but malformed paths, empty source roots, directory paths, and observation citations still bypass the gate.
4. **Resolved** — duplicate module UIDs and invalid `depends_on` references fail; the four external modules are declared.
5. **Partial** — current observation IDs are stable and duplicate-checked, but their required source-qualified form is undocumented and unenforced.
6. **Resolved** — quarter is removed from the command stories and reserved quarter configuration has a negative criterion.
7. **Resolved** — the mobile fallback capability is assigned to ICE-08 and no longer covered by US-CAL-08.
8. **Resolved** — Calendaric resumes only after re-reading the predecessor configuration and confirming the granularity is disabled.
9. **Partial** — the missing label and day-strip cases were added, but US-CAL-14 narrows source behaviour to daily notes and shares one unsplit capability with US-CAL-13.
10. **Resolved** — US-CMD-10 includes the active-leaf and split-pane cases, and the related-note badge and lookup are explicitly deferred.
11. **Resolved** — AC-ARCH-08.2 no longer permits fixed week numbering.
12. **Partial** — a single decision validates before writing, but batch mode ignores failures and most decisions still do not identify the questions they answered.
13. **Resolved** — creation confirmation and both preview paths state visible outcomes.
14. **Resolved** — AC-CAL-07.3 states the source's threshold boundaries with worked examples.
15. **Partial** — the summary, ICE-03, and most of ICE-05 are corrected, but ICE-05's risk repeats the false dependency claim.
16. **Resolved** — AC-ARCH-01.6 enforces the desktop-only adapter boundary and its dependency direction.
