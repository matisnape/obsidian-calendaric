# Verdict

Round five is not clean: the six round-four citation mutations are fixed, but the rewritten grammar introduces a sibling lookup bypass and still allows citations to disappear during parsing. `shared_coverage` also accepts values that are not visible prose, including numeric `1` and U+034F. The Q-TPL-03.1 option is implemented correctly as an unverified integration criterion, so I do not recommend reopening the question; because validator findings remain, the W1 to W16 writing-style pass was not run.

## Findings

### 1. High — a declared sibling qualifier disables file validation

**Location:** `docs/mapping/merge.py:246`, `docs/mapping/merge.py:285`, `docs/mapping/merge.py:318`

Changing the first DNI observation citation to `obsidian-periodic-notes:does-not-exist.ts:999` made `merge.py` exit 0 and print `no reference problems`. The qualifier is accepted because `obsidian-periodic-notes` is the basename of a declared source root. `cite()` then stores that basename in the record's `source` field, but `ROOTS` is keyed by source IDs such as `pn`; `ROOTS.get("obsidian-periodic-notes")` returns no root, and line 319 silently skips the record.

This means the new sibling-only boundary recognizes the allowed repository but does not verify any file or line inside it. A sibling citation can therefore support an observation with arbitrary nonexistent evidence.

**Required correction:** Build a basename-to-source-ID or basename-to-root map, and have `cite()` return the declared target's real source ID or root. Treat a missing root during record validation as a problem rather than skipping the record.

### 2. Medium — empty citation forms still vanish instead of failing

**Location:** `docs/mapping/merge.py:232`, `docs/mapping/merge.py:237`, `docs/mapping/merge.py:266`, `docs/mapping/merge.py:307`, `docs/mapping/merge.py:319`, `docs/mapping/merge.py:331`

Six new mutations made `merge.py` exit 0 and print `no reference problems`:

- observation citation `@abcdef` becomes empty after the SHA suffix is removed and returns no record
- observation citation `HEAD` returns no record, although this form is outside the grammar documented in `SCHEMA.md`
- empty `defined_in.path: ""` reaches the generic `not path` skip
- setting path `;;;` produces only empty segments, all of which are skipped
- setting path `:1` produces an empty filename plus a line number, then reaches the generic `not path` skip
- setting path `src/` is accepted as a directory even though a setting path identifies the file that defines the setting

The type and containment checks now work, but a malformed string can still remove a required citation from validation entirely.

**Required correction:** Reject a citation that becomes empty after suffix removal, reject undocumented bare Git refs, require a non-empty path on every citation-bearing record, reject empty semicolon segments and an empty `head` before a line suffix, and allow directory citations only in record types whose schema explicitly permits them.

### 3. Medium — `shared_coverage` still accepts values with no visible prose

**Location:** `docs/backlog/build_backlog.py:187`

Replacing both real reasons for `cal:persist-plugin-settings` with numeric JSON value `1` made `build_backlog.py` exit 0 with `no problems`, because `has_text()` converts every value to a string. Replacing them with U+034F COMBINING GRAPHEME JOINER also exited 0; its Unicode category is `Mn`, which the current category filter treats as visible even though the character has no standalone visible content.

The previous U+200B mutation now fails, and repeating a UID in one `covers[]` now fails independently. The remaining check still does not establish that the reason is a string containing visible text.

**Required correction:** Require `reason` to be a string, then require at least one visible base character after normalization and removal of control, separator, formatting, and combining-mark categories.

## Round-four finding disposition

1. **Partial — citation boundary.** All six round-four mutations now exit 1, but declared sibling citations and empty citation forms introduce the bypasses in findings 1 and 2.

2. **Partial — shared coverage.** Distinct-owner counting, duplicate-cover rejection, and U+200B handling are fixed, but non-string and combining-only reasons still pass.

3. **Resolved — Q-TPL-03.1.** AC-TPL-03.2 requires a live Sunday-start configuration, is `integration`, and remains `unverified`; setting it to `pass` without evidence made the backlog gate exit 1. The decision settles the rule while the criterion retains the pending verification, so the question does not need to reopen.
