# Response to the review verification

Six corrections are accepted. A1 remains 7 of 7 because its two disputed criteria still require an index in their setup or action. A2 narrows from seven violations to five: the two decisions should be removed, but the two MIG criteria remain violations under Anna's explicit review scope.

## A1. Finding 22 remains 7 of 7

**Determination: Do not accept the 5-of-7 count.**

AC-NOTE-11.3 and AC-NOTE-11.6 have observable `then[]` clauses, but an acceptance criterion is the complete `given`/`when`/`then` contract. AC-NOTE-11.3 starts with “a file already in the index.” AC-NOTE-11.6 runs “when the index resolves that file.” An on-demand implementation with no index cannot establish the first state or perform the second action as written.

`BACKLOG-SCHEMA.md:94` applies the no-implementation rule to criteria, not only to `then[]`. Five criteria require the index in their outcomes; AC-NOTE-11.3 and AC-NOTE-11.6 require it in their setup or action. None of the seven is marked `verifies: "architecture"`. The title and all seven criteria therefore constrain the implementation to an index, so “the whole story” is accurate.

## A2. Finding 24 narrows to five violations

**Determination: Partially accept.**

DEC-08 and DEC-12 should not have been included in Finding 24. They are decisions, while the cited no-implementation rule governs acceptance criteria. If decisions also need a no-implementation rule, that is a separate schema requirement.

AC-MIG-05.5 and AC-MIG-06.3 remain violations. The review request explicitly said that structural criteria are allowed only in the ARCH epic and AC-CAL-05.5. That instruction is narrower than `BACKLOG-SCHEMA.md:94` and governs this review. Marking the two MIG criteria as `verifies: "architecture"` does not put them inside the permitted locations; it exposes a conflict between the schema and Anna's stated rule.

The corrected count is five:

- AC-NOTE-04.2
- AC-NOTE-04.3
- AC-CAL-01.4
- AC-MIG-05.5
- AC-MIG-06.3

Finding 3 still stands on DEC-04 and the live predecessor IDs. Its instruction to remove AC-MIG-06.3's single-ID constraint also remains supported by Anna's explicit scope, although it should not rely on the schema's broader exception.

## A3. Finding 29 covers six stories

**Determination: Accept.**

The five disputed stories already contain a failure, negative, or boundary case:

- AC-ARCH-02.5 checks that a duplicate implementation is rejected
- AC-CMD-02.4 covers the layout-ready signal never firing
- AC-MIG-03.6 covers the Calendar plugin being absent or disabled
- AC-MIG-04.6 covers Periodic Notes being absent or disabled
- AC-SET-05.4 covers invalid stored state with multiple startup flags

The corrected list is US-CAL-02, US-CAL-12, US-CMD-01, US-FMT-02, US-FMT-06, and US-SET-02. The validator defect remains: `build_backlog.py` does not enforce the schema's per-story failure-path rule.

## B1. Finding 27 is a Low decision-text defect

**Determination: Accept.**

AC-FMT-04.5 contains the correct contract: the weekly format must contain a week-number token and a month or day token. An implementation that mishandles the case cannot pass that criterion.

DEC-15 is still defective because its decision text omits the week-token precondition and its rationale invents a `DD`-only failure that `src/parse.ts:36-44` cannot produce. The finding should be Low and should say: “DEC-15's rationale misstates the source, and its decision text is looser than AC-FMT-04.5.” This is misleading explanatory text, not a hole in the pass/fail contract.

## C1. Finding 2 cites the wrong artifact

**Determination: Accept.**

`docs/mapping/sources/vault.json:741-745` reports only that readable templates, queries, and note content do not reference the Timeline view. It also says that the conclusion is pending a UI check outside that agent's scope. The map does not say “enabled but unused.”

`docs/backlog/epics/ICE.json:97` removes that caveat and turns the limited search into a definitive non-use claim. The finding should target ICE-04 for overstating its evidence. The P3 source observation can remain as written; the defect is the icebox decision's unsupported inference, not the observation's severity.

## C2. Finding 31 paraphrases the observation too broadly

**Determination: Accept.**

`docs/mapping/sources/calendaric.json:884-889` says that adopting Svelte conflicts with the target's minimal-dependency direction. It does not say that reimplementation itself conflicts with a from-scratch rewrite.

The P1 rating is still unsupported because the observation records a technology difference without establishing a blocked requirement or a planning decision that must be made now. The finding should use that reason for downgrading it to P2.

## D1. Finding 8 understates the ambiguity

**Determination: Accept.**

The map contains 140 module records, 132 unique module IDs, and eight IDs duplicated between a source and `forks`. The stated 124 ambiguous references reproduce as:

- 48 capability `defined_in.module` references
- 28 capability `used_by` references
- 48 flow `from` or `to` references

There are also 56 `modules[].depends_on[]` references to those duplicated IDs. Counting dependency edges as well gives 180 ambiguous module-ID references. Finding 8 should describe map-wide ambiguity rather than illustrate it with one capability link.

## D2. Findings 6 and 9 are latent gate defects

**Determination: Accept the current-state qualification; retain their severity classes.**

The current data has 67 `todo` stories and 309 `unverified` criteria. No story covers an icebox or evidence UID, no ICE entry covers a build UID, and the only `uncovered[]` row has a substantive reason. There is no existing status or ownership corruption to repair.

Finding 6 remains Critical because the backlog's primary purpose is to judge future implementation. Having no completed story is the expected state before that gate is used, not evidence that the gate is safe. The defect becomes active on the first validation cycle and can certify a broken feature as done.

Finding 9 remains High because it permits future ownership errors even though none exists now. Both fixes are pre-implementation gate work: Finding 6 must be fixed before any story is marked done, and Finding 9 before coverage ownership changes. The qualification changes the remediation description, not the severity ordering.
