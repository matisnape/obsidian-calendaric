#!/usr/bin/env python3
"""Record an answered open question against the stories it settles.

The question moves out of `open_questions` and into `decisions`, so the
building agent sees a decision rather than an unresolved choice, and the
reasoning stays next to the story instead of in a chat log.

    python3 record_decision.py DEC-01
"""
import json
import pathlib
import sys
from datetime import date

HERE = pathlib.Path(__file__).parent
EPICS = HERE / "epics"

DECISIONS = {
    "DEC-01": {
        "title": "Week-based tokens and week numbers follow the configured week-start day",
        "decision": "The user's 'Start week on' setting is authoritative for week numbering and "
                    "for the {{monday:fmt}}..{{sunday:fmt}} tokens, in both the filename format "
                    "field and the note body. ISO week numbering is not hard-coded. The two "
                    "surfaces must resolve the same weekday to the same date for the same setting.",
            "rationale": "The existing documentation already promises this and the code contradicts "
                     "it. Keeping the promise is the smaller change and the honest one. In this "
                     "vault the setting is Monday-first, so ISO and configured agree today and "
                     "no existing note is affected.",
        "stories": {
            "FMT": ["US-FMT-01"],
            "TPL": ["US-TPL-03"],
            "ARCH": ["US-ARCH-08"],
        },
    },
    "DEC-02": {
        "title": "A file is the note for a period only when its folder matches too",
        "decision": "Recognising a file as a periodic note requires both the filename to match the "
                    "granularity's format and the file to sit under that granularity's configured "
                    "folder. Filename alone is not sufficient. No vault-wide loose fallback exists.",
        "rationale": "Today only the basename is checked, so two same-named files in different "
                     "folders resolve identically, and an unrelated file whose name loosely "
                     "resembles a date is cached as a periodic note. This also closes ICE-07, the "
                     "icebox entry marked do-not-rebuild.",
        "stories": {
            "FMT": ["US-FMT-07"],
        },
    },
    "DEC-03": {
        "title": "Desktop first, with the platform-specific surface behind one boundary",
        "decision": "manifest.json declares isDesktopOnly: true. Any call into a desktop-only API "
                    "lives behind a single adapter, so supporting mobile later means replacing that "
                    "adapter rather than reworking the views.",
        "rationale": "The repository currently declares isDesktopOnly: false while calling an "
                     "Electron API, which is a lie that fails at runtime on mobile. Declaring the "
                     "truth costs nothing now; isolating the call keeps the option open.",
        "stories": {
            "SET": ["US-SET-04"],
        },
    },
    "DEC-05": {
        "title": "The plugin ships in English only",
        "decision": "All user-facing text is English. No localisation layer, no translated labels, "
                    "no locale-dependent strings. Controls that the previous component library "
                    "labelled with a translated word use an icon with an English tooltip instead.",
        "rationale": "Stated by the owner. It removes a whole class of open question about "
                     "which surfaces need translating, and keeps narrow controls readable in a "
                     "sidebar. Note this is about interface text only: date and weekday names "
                     "still follow the configured locale, because those come from the date "
                     "formatter, not from the plugin's own copy.",
        "stories": {"CAL": ["US-CAL-02"]},
    },
    "DEC-06": {
        "title": "Every gesture on a week-number cell resolves the same date",
        "decision": "Click, hover and right-click on a week-number cell all resolve to the same "
                    "reference date for that week, whatever the configured week-start day.",
        "rationale": "The old behaviour could resolve a different date for click than for hover, "
                     "so the preview showed one note and the click opened another. That is a "
                     "defect, not a feature worth preserving.",
        "stories": {"CAL": ["US-CAL-04"]},
    },
    "DEC-07": {
        "title": "The month header reacts to a configuration change immediately",
        "decision": "When monthly notes stop being available while the calendar is open, the next "
                    "click on the month header already behaves as the fallback. No reopening of "
                    "the view is required, in either direction.",
        "rationale": "The grid is already required to redraw as soon as settings are saved. A "
                     "header that lags behind the grid it sits on would be inconsistent with the "
                     "reactivity the same epic demands everywhere else.",
        "stories": {"CAL": ["US-CAL-05"]},
    },
    "DEC-08": {
        "title": "One overlay-positioning mechanism, shared by every overlay",
        "decision": "The calendar's hover popover and the settings screen's autocomplete use the "
                    "same positioning behaviour and the same implementation.",
        "rationale": "Two implementations of the same edge-avoidance and anchoring rules is exactly "
                     "the duplication this rewrite exists to remove. It also means one place to fix "
                     "when a popover is clipped.",
        "stories": {"CAL": ["US-CAL-12"]},
    },
    "DEC-09": {
        "title": "A command that cannot act says so",
        "decision": "Running a command whose precondition is not met shows a brief notice naming "
                    "what was missing. It never fails silently.",
        "rationale": "A command that does nothing and says nothing is indistinguishable from a "
                     "broken plugin. The old behaviour taught users to stop trusting the command.",
        "stories": {"CMD": ["US-CMD-03"]},
    },
    "DEC-10": {
        "title": "Retire the standalone weekly-note command",
        "decision": "There is no separate 'Open Weekly Note' command. The generated per-granularity "
                    "command set covers it, as it covers every other granularity.",
        "rationale": "It existed because weekly notes predated the generated command set. Keeping "
                     "both means two command-palette entries doing the same thing, and one of them "
                     "special-cased in the code.",
        "stories": {"CMD": ["US-CMD-04"]},
    },
    "DEC-11": {
        "title": "The startup note is created for whichever granularity is configured",
        "decision": "If the note configured to open at startup does not exist, it is created, for "
                    "every granularity that can be configured to open at startup.",
        "rationale": "One source plugin created it for day and week and silently did nothing for "
                     "the rest. That is an oversight, not a design: a user who asks for the "
                     "monthly note at startup means it the same way as the daily one.",
        "stories": {"CMD": ["US-CMD-09"]},
    },
    "DEC-12": {
        "title": "Opening and creating a note share one entry point",
        "decision": "Every caller goes through open-or-create, which checks existence first. There "
                    "is no separate create path that skips that check.",
        "rationale": "Two entry points means two places where the file-already-exists case can be "
                     "handled differently, which is how the old code ended up with three different "
                     "answers to the same question.",
        "stories": {"NOTE": ["US-NOTE-04"]},
    },
    "DEC-13": {
        "title": "Templates are applied only to files the plugin creates",
        "decision": "A periodic-shaped empty file that already existed before the plugin started is "
                    "indexed but never templated. Applying a template is limited to files the "
                    "plugin creates while running.",
        "rationale": "The alternative means the first index build after installing writes into "
                     "files the plugin has never seen. Writing to someone's existing notes as a "
                     "side effect of installing is not a behaviour to reintroduce.",
        "stories": {"NOTE": ["US-NOTE-10"]},
    },
    "DEC-14": {
        "title": "Candidate formats are tried in declaration order, and that order is documented",
        "decision": "When more than one candidate format validly matches the same file, the first "
                    "in declaration order wins. The order is defined and documented rather than "
                    "incidental.",
        "rationale": "Today the winner depends on an unspecified list order, so the same vault can "
                     "resolve differently after an unrelated change. Any deterministic rule beats "
                     "that; declaration order is the one a user can predict.",
        "stories": {"FMT": ["US-FMT-04"]},
    },
    "DEC-15": {
        "title": "Week-number disambiguation applies whenever a day token is present",
        "decision": "The rule that separates a week number from a month-or-day value applies when "
                    "the format carries a day token, whether or not it also carries a month token.",
        "rationale": "The narrower variant only triggered when both were present, so a format like "
                     "DD slipped through and parsed as a week number. The wider rule catches the "
                     "case the narrow one was written to catch.",
        "stories": {"FMT": ["US-FMT-04"]},
    },
    "DEC-16": {
        "title": "Format warnings inform, they do not block",
        "decision": "A format flagged as fragile or non-identifying shows a warning the user can "
                    "read and dismiss. The value still saves.",
        "rationale": "The check is a heuristic. A user with a deliberate nested-path scheme should "
                     "not be locked out by it, and a blocked save gives them nowhere to go.",
        "stories": {"FMT": ["US-FMT-05"]},
    },
    "DEC-17": {
        "title": "An import with nothing to import is not offered",
        "decision": "When a predecessor plugin's configuration is empty for every field the "
                    "importer would read, that import is not offered at all.",
        "rationale": "In this vault the Calendar plugin's weekly fields are blank because weekly "
                     "configuration lives in Periodic Notes. Offering to import nothing is noise "
                     "that teaches users to dismiss the import prompt without reading it.",
        "stories": {"MIG": ["US-MIG-03"]},
    },
    "DEC-18": {
        "title": "Prefix matching is carried across on import",
        "decision": "The per-granularity allow-prefix-matching flag transfers from the Periodic "
                    "Notes configuration into the imported configuration. It is not dropped.",
        "rationale": "The field has a direct equivalent in the new model. Dropping it silently "
                     "turns off prefix matching for a vault that depends on it, and this vault "
                     "does depend on it: its weekly notes are renamed to a longer title after "
                     "creation and only resolve through a prefix match.",
        "stories": {"MIG": ["US-MIG-04"]},
    },
    "DEC-19": {
        "title": "Unrecognised configuration fields survive a round trip",
        "decision": "Configuration written by a newer version keeps its unrecognised fields when an "
                    "older version loads and saves the file.",
        "rationale": "Same principle as preserving an unused named configuration group: running an "
                     "older build once must not silently destroy settings, so that downgrading and "
                     "upgrading again is safe.",
        "stories": {"MIG": ["US-MIG-07"]},
    },
    "DEC-20": {
        "title": "The indicator interface changes additively only",
        "decision": "Once published, the contract a calendar indicator implements only gains "
                    "optional members. Removing or repurposing an existing member is a breaking "
                    "change that requires a new contract alongside the old one.",
        "rationale": "The previous indicator contract was rewritten in a single version bump and "
                     "broke every implementation at once. An additive-only rule is the cheapest "
                     "guarantee that keeps that from repeating.",
        "stories": {"ARCH": ["US-ARCH-05"]},
    },
    "DEC-04": {
        "title": "Probe exactly one canonical plugin id per predecessor",
        "decision": "Calendaric detects the core Daily Notes plugin, the Calendar plugin and the "
                    "Periodic Notes plugin by one canonical id each, to offer a one-time import and "
                    "to warn when a predecessor is still managing the same notes. The paired "
                    "development-build id probe is not carried forward. Whether a predecessor owns "
                    "a granularity is decided by its own enabled flag, checked the same way for "
                    "every granularity.",
        "rationale": "The dual-id probe existed only to let a development build and a store build "
                     "of the same plugin coexist in one vault. The merged plugin removes that "
                     "situation. The old asymmetry, where the mere presence of the Calendar plugin "
                     "counted as proof that weekly notes were externally managed, goes with it.",
        "stories": {
            "MIG": ["US-MIG-05", "US-MIG-06"],
        },
    },
}


def main(dec_id: str) -> int:
    dec = DECISIONS.get(dec_id)
    if not dec:
        print(f"unknown decision: {dec_id}")
        return 1
    touched = 0
    for epic, story_ids in dec["stories"].items():
        path = EPICS / f"{epic}.json"
        data = json.loads(path.read_text())
        for story in data["stories"]:
            if story["id"] not in story_ids:
                continue
            existing = story.setdefault("decisions", [])
            if any(x["id"] == dec_id for x in existing):
                continue
            existing.append({
                "id": dec_id,
                "title": dec["title"],
                "decision": dec["decision"],
                "rationale": dec["rationale"],
                "decided_on": date.today().isoformat(),
            })
            story["open_questions"] = []
            touched += 1
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"{dec_id}: recorded against {touched} stories")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(main(sys.argv[1]))
    for d in DECISIONS:
        main(d)
