# Verdict

The round-four re-review is not clean: citation validation and shared-coverage validation still fail open under mutation. DEC-01 also overstates its provenance because it marks Q-TPL-03.1 resolved without performing the live Sunday-start verification that the question asks for. Batch atomicity, observation ID validation, US-CAL-14 granularity, and ICE-05 wording are fixed; because functional findings remain, the approved W1 to W16 writing-style pass was not run.

## Findings

### 1. High — citation validation accepts evidence outside its source boundary

**Location:** `docs/mapping/merge.py:239`, `docs/mapping/merge.py:275`, `docs/mapping/merge.py:287`, `docs/mapping/merge.py:304`

Six independent mutations returned 0 and printed `no reference problems`:

- a DNI observation accepted `src:index.ts:118-124`, although `src` is neither a module ID nor a sibling repository
- the same observation accepted `/etc/hosts:1`
- it accepted `../obsidian-periodic-notes/src/main.ts:1`
- it accepted `pn-main:src/index.ts:118-124`; `pn-main` belongs to another source, but the global module-ID set caused the prefix to be discarded before the DNI path was checked
- DNI capability `create-daily-note` accepted `defined_in.path: "obsidian-periodic-notes/src/main.ts"`, so parent-directory fallback hid a cross-source ownership error
- DNI setting `daily-notes.format` accepted numeric `path: 7`, because settings, commands, and API entries still skip non-string paths

The parent fallback is too broad because it applies to every citation-bearing record, not only an explicitly qualified cross-repository observation. Absolute paths and `..` traversal also escape both documented resolution roots.

**Required correction:** Reject absolute paths and traversal; resolve module prefixes against the cited source rather than the global module set; accept only declared sibling-repository prefixes; keep `defined_in`, settings, commands, and API paths inside their own source root; and reject every non-string citation path.

### 2. Medium — shared coverage can be manufactured without multiple owners or a visible reason

**Location:** `docs/backlog/build_backlog.py:243`

Two mutations returned 0 and printed `no problems`. Replacing both reasons for `cal:persist-plugin-settings` with a zero-width character satisfied `reason.strip()`. Separately, repeating the uniquely owned `cal:settings-tab-ui` UID twice in US-SET-02's `covers[]` and adding one reason made the one story count as two owners.

The gate therefore does not establish either part of its contract: that two distinct owners exist or that each owner has a visible explanation. It also lets a duplicate UID inside one story hide as intentional shared coverage.

**Required correction:** Reject duplicate UIDs within every `covers[]`, count distinct owner IDs, and require a reason containing visible non-whitespace characters after Unicode format controls are removed.

### 3. Medium — DEC-01 did not settle the live verification in Q-TPL-03.1

**Location:** DEC-01 / Q-TPL-03.1; `docs/backlog/record_decision.py:28`

Q-TPL-03.1 asks for the Sunday-first token rule to be verified against a live `Start week on: Sunday` configuration before shipping. DEC-01 chooses the intended rule, but its rationale explicitly says the available vault is Monday-first; it records no Sunday-start verification. The policy is settled, but the empirical check is not, so `resolves: ["Q-TPL-03.1"]` closes more than the decision establishes.

**Required correction:** Keep the Sunday-start verification as an open question or convert it to an explicit unverified acceptance criterion; do not list Q-TPL-03.1 as resolved until that check has been run.

## Round-three finding disposition

1. **Resolved — batch decision recording.** Retargeting DEC-25 to `US-MIG-99` made both single and batch invocation exit 1; hashes for all nine epic files stayed unchanged after each invocation.

2. **Partial — citation validation.** Empty roots, capability-path types, observation citations, and directories are now checked, but the six mutations in finding 1 still pass.

3. **Resolved — US-CAL-14 scope.** The story and AC-CAL-14.1 declare day, week, month, and year, and the split capability has one owner.

4. **Partial — shared coverage.** Explicit reasons exist for the current shared capabilities, but duplicate covers and invisible reasons bypass the new gate.

5. **Partial — question provenance.** All 24 original IDs are represented in decision `resolves` lists, but Q-TPL-03.1 is closed without its requested verification.

6. **Resolved — observation ID form.** Changing `OBS-dni-01` to `banana` made `merge.py` exit 1 and report the required `OBS-dni-<nn>` form without writing the merged map.

7. **Resolved — ICE-05 evidence.** Its risk now says direct date jumping remains available and names only the related-note count and Tab hand-off as missing.
