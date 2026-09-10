# Codex review — round 7

Round seven is not clean: the exact round-six two-hop, ordinary-marker, and U+3164 mutations now fail, but citation validation still has two narrower bypasses. A sibling repository can be reached without the documented sibling qualifier, and an observation containing only `—` disappears before the marker policy runs. The current backlog content remains clean; these are validator-only gaps, so the writing-style pass was not run.

## Findings

### Medium — a sibling repository can still be reached without its qualifier

`docs/mapping/merge.py:278`, `docs/mapping/merge.py:353`

Changing an observation path to either `obsidian-periodic-notes/src/main.ts:1` or `dni-index:obsidian-periodic-notes/src/main.ts:1` made `python3 docs/mapping/merge.py` exit 0. In both forms no sibling qualifier is consumed, so the citation receives permission to hop and the candidate resolver treats the first path segment as a sibling repository basename. This accepts evidence outside the citing source without the schema's required `<sibling-repo>:` qualifier and can silently assign evidence to the wrong owner.

Resolve a sibling repository only while parsing an explicit sibling qualifier. Once parsing has selected a source root, resolve the remaining path only within that root; the qualified form already switches roots and does not need a second basename-driven hop.

### Medium — an observation containing only the em-dash marker bypasses marker validation

`docs/mapping/merge.py:236`, `docs/mapping/merge.py:337`

Changing an observation's `where` value to `—` made `python3 docs/mapping/merge.py` exit 0. `cite` returns no citation records for the marker before `check_citations` can apply its record-type restriction, so the observation vanishes instead of failing. The exact verified-capability and setting mutations from round six now fail, but the claim that every other record type rejects the marker is not yet true.

Do not silently discard marker-only citations in `cite`. Preserve enough record context for the marker policy to reject an observation, while retaining the one documented allowance for an external-module capability.

## Round-six finding disposition

1. **Partially resolved.** The exact two-hop mutation fails, but an unqualified sibling path, including one preceded by the citing source's own module id, still crosses into the sibling repository.
2. **Partially resolved.** The marker now fails for a verified ordinary capability and a setting, but an observation marker is discarded before the restriction runs.
3. **Resolved.** U+3164 fails the shared-coverage reason check.

## Is this loop still paying

No. Fix the two small citation-parser gaps above, add their exact mutation regressions, and stop the open-ended adversarial rounds. The stories, acceptance criteria, and decisions have remained clean since round four; every later finding has required deliberately malformed schema data, and each round is now uncovering narrower variants of validator hardening rather than defects in the deliverable. With trusted agents following the documented schema, the remaining risk is smaller than the cost of another full round; after the targeted fixes, proceed to the W1–W16 writing-style pass.

## Writing-style pass

Files edited:

- `docs/mapping/SCHEMA.md`
- `docs/mapping/BACKLOG-SCHEMA.md`
- `docs/mapping/README.md`
- `docs/backlog/README.md`
- `docs/backlog/epics/ARCH.json`
- `docs/backlog/epics/CAL.json`
- `docs/backlog/epics/CMD.json`
- `docs/backlog/epics/FMT.json`
- `docs/backlog/epics/ICE.json`
- `docs/backlog/epics/MIG.json`
- `docs/backlog/epics/NOTE.json`
- `docs/backlog/epics/SET.json`
- `docs/backlog/epics/TPL.json`
- `docs/backlog/record_decision.py`
- `docs/backlog/report.py`
- `docs/backlog/backlog.json` (regenerated)
- `docs/calendaric.html`
- `docs/reviews/codex-round7.md`

W1. Reframed the mapping schema as evidence for a fresh implementation, not a code merge.

W2. Added an up-front backlog glossary for epic, granularity, coverage, and icebox.

W3. Replaced “canonical identity” in US-FMT-06 with concrete note-date language.

W4. Replaced the overloaded ARCH summary with two short boundary statements.

W5. Reduced the ICE summary to its release decision, reversed deferral, and one data-model constraint.

W6. Defined a matching periodic-note file in US-NOTE-10 and DEC-13 instead of calling it “periodic-shaped.”

W7. Renamed and simplified US-TPL-05 around the observable rule: do not reapply a template.

W8. Named the unstable dependencies in US-ARCH-07 and replaced “platform-specific surface” with “desktop-only API” in DEC-03.

W9. Replaced “port interfaces” and “composition root” with descriptions of what those boundaries do.

W10. Explained state containers through their accessor or subscription API instead of assuming “reactive store” knowledge.

W11. Replaced four vague errors with required messages and explicit no-file outcomes.

W12. Replaced “shortly after” with the mapped 250 ms dismissal delay.

W13. Replaced “folded in” with “accounted for without a separate story” in reports, the viewer, and epic notes.

W14. Shortened US-MIG-05 to “Choose one import source per granularity.”

W15. Reduced the US-ARCH-06 story to one reproducible-build outcome.

W16. Replaced “Timeline complication” in ICE-04 with “Timeline badge and seven-day navigator.”
