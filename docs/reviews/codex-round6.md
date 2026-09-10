# Verdict

Round six is not clean: although the current records pass and the exact round-five mutations are fixed, citation validation can still be bypassed through a second sibling repository and the global no-citation marker. `shared_coverage` also still accepts U+3164 HANGUL FILLER, which NFKC changes into another invisible filler in category `Lo`. These are validator gaps rather than corrupt current records, but they block the writing-style pass, so W1 to W16 was not run.

## Findings

### 1. High — a citation can cross through two sibling repositories

**Location:** `docs/mapping/merge.py:251`, `docs/mapping/merge.py:331`, `docs/mapping/merge.py:349`

Changing the first DNI observation citation to `obsidian-periodic-notes:obsidian-daily-notes-interface/src/index.ts:1` made `merge.py` exit 0 and print `no reference problems`. The first qualifier correctly changes the record's source to `pn`. The remaining path still begins with another declared repository basename, and `may_cross` lets the candidate builder resolve it from Periodic Notes' parent into Daily Notes Interface.

The citation therefore claims to target Periodic Notes while its evidence is read from a third repository. No current record uses this form; it is a fail-open validator path.

**Required correction:** Resolve the optional sibling qualifier exactly once in `cite()`. After it changes the target source, validate the remaining path only under that source root; do not interpret its first path segment as another sibling qualifier.

### 2. Medium — the no-citation marker bypasses required file evidence

**Location:** `docs/mapping/merge.py:236`, `docs/mapping/merge.py:332`

Replacing the verified DNI capability `create-daily-note` path with `—` made `merge.py` exit 0. Replacing the `daily-notes.format` setting path with the same marker also exited 0. The marker is accepted before record type, confidence, or ownership is considered, so it can suppress a citation that the schema otherwise requires.

The current data has one legitimate-looking capability marker: inferred behavior owned by an external module in `cal:reset-month-to-today-on-header-click`. The gate does not limit the exception to that shape, so verified capabilities, settings, commands, API entries, and observations can use it too.

**Required correction:** Reject `—`, `-`, and `n/a` for settings, commands, API entries, observations, and verified capability definitions. If inferred external behavior needs the marker, allow it only through an explicit schema rule with the external module and rationale validated.

### 3. Medium — NFKC still admits an invisible filler as prose

**Location:** `docs/backlog/build_backlog.py:189`

Replacing both reasons for `cal:persist-plugin-settings` with U+3164 HANGUL FILLER made `build_backlog.py` exit 0 with `no problems`. NFKC changes it to U+1160 HANGUL JUNGSEONG FILLER; that character is still visually empty but has Unicode category `Lo`, so it is not in `INVISIBLE`.

Numeric `1` and U+034F now fail as required, and no current reason contains this filler. The remaining rule still does not guarantee a visible base character.

**Required correction:** After normalization, reject known default-ignorable and filler code points in addition to category filtering. A positive test should require rendered text content rather than treating every letter-category code point as visible.

## Round-five finding disposition

1. **Partial — sibling validation.** The exact nonexistent-file mutation now exits 1 and a missing source root is an error, but chaining a second sibling repository still escapes the selected source.

2. **Partial — vanishing citations.** All six round-five forms now produce validation errors, but the global `—` marker still removes required citations from every record type.

3. **Partial — shared-coverage prose.** Numeric `1` and U+034F now fail, but U+3164 normalizes to an invisible `Lo` filler and passes.
