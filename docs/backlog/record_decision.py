#!/usr/bin/env python3
"""Record an answered open question against the stories it settles.

The question moves out of `open_questions` and into `decisions`, so the
building agent sees a decision rather than an unresolved choice, and the
reasoning stays next to the story instead of in a chat log.

A decision names the exact question ids it answers, in `resolves`. Only those
are removed. Clearing the whole array was how DEC-01 deleted a question it
never answered, and how applying DEC-14 alone erased the question DEC-15 was
written for.

Re-running is safe: a decision already on a story is updated in place, so
editing the text here and running again propagates the edit instead of
leaving the old copy behind.

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
                     "no existing note is affected. This settles which rule is correct; the "
                     "Sunday-start case is verified by AC-TPL-03.2 against a live Sunday-first "
                     "vault, and that criterion stays unverified until someone runs it.",
        "resolves": ["Q-ARCH-08.1", "Q-TPL-03.1", "Q-TPL-03.2"],
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
        "resolves": ["Q-FMT-07.1"],
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
        "resolves": ["Q-SET-04.1"],
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
        "resolves": ["Q-CAL-02.1"],
        "stories": {"CAL": ["US-CAL-02"]},
    },
    "DEC-06": {
        "title": "Every gesture on a week-number cell resolves the same date",
        "decision": "Click, hover and right-click on a week-number cell all resolve to the same "
                    "reference date for that week, whatever the configured week-start day.",
        "rationale": "The old behaviour could resolve a different date for click than for hover, "
                     "so the preview showed one note and the click opened another. That is a "
                     "defect, not a feature worth preserving.",
        "resolves": ["Q-CAL-04.1"],
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
        "resolves": ["Q-CAL-05.1"],
        "stories": {"CAL": ["US-CAL-05"]},
    },
    "DEC-08": {
        "title": "One overlay-positioning mechanism, shared by every overlay",
        "decision": "The calendar's hover popover and the settings screen's autocomplete use the "
                    "same positioning behaviour and the same implementation.",
        "rationale": "Two implementations of the same edge-avoidance and anchoring rules is exactly "
                     "the duplication this rewrite exists to remove. It also means one place to fix "
                     "when a popover is clipped.",
        "resolves": ["Q-CAL-12.1"],
        "stories": {"CAL": ["US-CAL-12"]},
    },
    "DEC-09": {
        "title": "A command that cannot act says so",
        "decision": "Running a command whose precondition is not met shows a brief notice naming "
                    "what was missing. It never fails silently.",
        "rationale": "A command that does nothing and says nothing is indistinguishable from a "
                     "broken plugin. The old behaviour taught users to stop trusting the command.",
        "resolves": ["Q-CMD-03.1"],
        "stories": {"CMD": ["US-CMD-03"]},
    },
    "DEC-10": {
        "title": "Retire the standalone weekly-note command",
        "decision": "There is no separate 'Open Weekly Note' command. The generated per-granularity "
                    "command set covers it, as it covers every other granularity.",
        "rationale": "It existed because weekly notes predated the generated command set. Keeping "
                     "both means two command-palette entries doing the same thing, and one of them "
                     "special-cased in the code.",
        "resolves": ["Q-CMD-04.1"],
        "stories": {"CMD": ["US-CMD-04"]},
    },
    "DEC-11": {
        "title": "The startup note is created for whichever granularity is configured",
        "decision": "If the note configured to open at startup does not exist, it is created, for "
                    "every granularity that can be configured to open at startup.",
        "rationale": "One source plugin created it for day and week and silently did nothing for "
                     "the rest. That is an oversight, not a design: a user who asks for the "
                     "monthly note at startup means it the same way as the daily one.",
        "resolves": ["Q-CMD-09.1"],
        "stories": {"CMD": ["US-CMD-09"]},
    },
    "DEC-12": {
        "title": "Opening and creating a note share one entry point",
        "decision": "Every caller goes through open-or-create, which checks existence first. There "
                    "is no separate create path that skips that check.",
        "rationale": "Two entry points means two places where the file-already-exists case can be "
                     "handled differently, which is how the old code ended up with three different "
                     "answers to the same question.",
        "resolves": ["Q-NOTE-04.1"],
        "stories": {"NOTE": ["US-NOTE-04"]},
    },
    "DEC-13": {
        "title": "Startup indexes without templating; anything appearing later is templated",
        "decision": "A matching empty file found while the index is first built is "
                    "indexed and left untouched. A matching empty file that appears "
                    "while Calendaric is running is templated, whoever created it: "
                    "Calendaric itself, the user, or another plugin.",
        "rationale": "The line is drawn at startup, not at authorship. Templating "
                     "everything found at startup would write into files the plugin has "
                     "never seen, as a side effect of installing it. Refusing to "
                     "template anything the user creates by hand would break the "
                     "ordinary case of making tomorrow's note in the file explorer and "
                     "expecting the template to fill it.",
        "resolves": ["Q-NOTE-10.1"],
        "stories": {
            "NOTE": ["US-NOTE-10"],
        },
    },
    "DEC-14": {
        "title": "The configured format is tried before the basename-only format derived from it",
        "decision": "The user configures one format per granularity. Calendaric derives "
                    "at most two candidates from it: the format as configured, which "
                    "may contain path segments, and its basename segment on its own. "
                    "The configured format is tried first. The derived basename-only "
                    "format is tried only when the first does not match.",
        "rationale": "Today the winner depends on an unspecified list order, so the "
                     "same vault can resolve differently after an unrelated change. "
                     "Naming a declaration order would not fix that, because the user "
                     "declares one format, not a list. Stating which derived candidate "
                     "is tried first is the rule a user can predict from what they "
                     "typed.",
        "resolves": ["Q-FMT-08.1"],
        "stories": {
            "FMT": ["US-FMT-08"],
        },
    },
    "DEC-15": {
        "title": "Week-number precedence applies to weekly formats that also carry a month or day token",
        "decision": "For a weekly format containing a week-number token, week-number "
                    "precedence applies when the format also carries a month token or a "
                    "day token. A format with no week-number token is never affected by "
                    "this rule.",
        "rationale": "The ambiguity exists only when a week number sits next to a month "
                     "or day value in the same name. Wording the rule as whenever a day "
                     "token is present described a case that cannot arise, and the "
                     "source it cited already treats month and day as alternatives, not "
                     "as a pair. AC-FMT-04.5 already states the correct rule; this text "
                     "now agrees with it.",
        "resolves": ["Q-FMT-04.2"],
        "stories": {
            "FMT": ["US-FMT-04"],
        },
    },
    "DEC-16": {
        "title": "Format warnings inform, they do not block",
        "decision": "A format flagged as fragile or non-identifying shows a warning the user can "
                    "read and dismiss. The value still saves.",
        "rationale": "The check is a heuristic. A user with a deliberate nested-path scheme should "
                     "not be locked out by it, and a blocked save gives them nowhere to go.",
        "resolves": ["Q-FMT-05.1"],
        "stories": {"FMT": ["US-FMT-05"]},
    },
    "DEC-17": {
        "title": "An import is offered when any field it would read carries a value",
        "decision": "A predecessor's import is offered when at least one field the "
                    "importer reads carries a value, counting display and behaviour "
                    "settings such as the week-start day, the create-confirmation "
                    "toggle, the word-count threshold and the locale override, not only "
                    "note format, folder and template. The import is suppressed only "
                    "when every field it reads is unset.",
        "rationale": "In this vault the Calendar plugin's weekly format, folder and "
                     "template are blank because weekly configuration lives in Periodic "
                     "Notes, but week start, create confirmation, words per dot and "
                     "locale override all carry real values. Suppressing the import "
                     "there would silently drop settings the user chose. Offering to "
                     "import literally nothing stays suppressed, which is the noise the "
                     "original decision was aimed at.",
        "resolves": ["Q-MIG-03.1"],
        "stories": {
            "MIG": ["US-MIG-03"],
        },
    },
    "DEC-18": {
        "title": "Prefix matching is carried across on import",
        "decision": "The per-granularity allow-prefix-matching flag transfers from the Periodic "
                    "Notes configuration into the imported configuration. It is not dropped.",
        "rationale": "The field has a direct equivalent in the new model. Dropping it silently "
                     "turns off prefix matching for a vault that depends on it, and this vault "
                     "does depend on it: its weekly notes are renamed to a longer title after "
                     "creation and only resolve through a prefix match.",
        "resolves": ["Q-MIG-04.1"],
        "stories": {"MIG": ["US-MIG-04"]},
    },
    "DEC-19": {
        "title": "Unrecognised configuration fields survive a round trip",
        "decision": "Configuration written by a newer version keeps its unrecognised fields when an "
                    "older version loads and saves the file.",
        "rationale": "Same principle as preserving an unused named configuration group: running an "
                     "older build once must not silently destroy settings, so that downgrading and "
                     "upgrading again is safe.",
        "resolves": ["Q-MIG-07.1"],
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
        "resolves": ["Q-ARCH-05.1"],
        "stories": {"ARCH": ["US-ARCH-05"]},
    },
    "DEC-04": {
        "title": "Detect each predecessor by both its published id and its development-build id",
        "decision": "Calendaric detects the core Daily Notes plugin, the Calendar "
                    "plugin and the Periodic Notes plugin to offer a one-time import "
                    "and to warn when a predecessor is still managing the same notes. "
                    "Detection covers both ids for each: calendar and calendar-anks, "
                    "periodic-notes and periodic-notes-anks. Whether a predecessor owns "
                    "a granularity is decided by its own enabled flag, checked the same "
                    "way for every granularity. The development-build ids may be "
                    "dropped once no vault still runs one of those builds.",
        "rationale": "Calendaric has one id of its own, but the plugins it replaces do "
                     "not. This vault runs calendar-anks and periodic-notes-anks, not "
                     "the published ids. Probing only the published id would make both "
                     "the import and the coexistence warning blind to the exact "
                     "installations this rewrite replaces. The old asymmetry, where the "
                     "mere presence of the Calendar plugin counted as proof that weekly "
                     "notes were externally managed, does go.",
        "resolves": ["Q-MIG-05.1", "Q-MIG-06.1"],
        "stories": {
            "MIG": ["US-MIG-05", "US-MIG-06"],
        },
    },
    "DEC-21": {
        "title": "An unrecognised weekday token stays literal and raises a warning, not an error",
        "decision": "A {{name:fmt}} token whose name is not one of the seven weekday "
                    "names is written into the filename as literal text, exactly as "
                    "typed. Saving the format is not blocked. The format editor shows a "
                    "warning naming the token it did not recognise, so a typo such as "
                    "{{funday:DD}} is visible before it reaches a filename.",
        "rationale": "This question was open on US-FMT-01 and DEC-01 answered a "
                     "different one, about which week start valid weekday tokens "
                     "follow. Leaving text alone is what every other unrecognised "
                     "sequence in a format string already does, so rejecting only this "
                     "one would be inconsistent. DEC-16 already settled that format "
                     "warnings inform rather than block.",
        "resolves": ["Q-FMT-01.1"],
        "stories": {
            "FMT": ["US-FMT-01"],
        },
    },
    "DEC-22": {
        "title": "Words per dot is a global setting with a default of 250",
        "decision": "Calendaric keeps the word-count threshold that decides how many "
                    "dots a day shows. It is one global number, default 250, editable "
                    "in settings. A value that is not a positive whole number falls "
                    "back to the default and the settings field says so. The Calendar "
                    "import carries the existing wordsPerDot value across.",
        "rationale": "US-CAL-07 requires configured word-count thresholds while SET "
                     "named no control and no default, and MIG dropped the existing "
                     "value on the claim that Calendaric has no equivalent field. An "
                     "implementation could satisfy every criterion and still leave the "
                     "user no way to configure the behaviour CAL promises. This vault's "
                     "Calendar plugin has wordsPerDot 250, so the default matches what "
                     "the user already sees.",
        "stories": {
            "CAL": ["US-CAL-07"],
            "SET": ["US-SET-02"],
            "MIG": ["US-MIG-03"],
        },
    },
    "DEC-23": {
        "title": "The first release supports day, week, month and year; quarter is reserved",
        "decision": "The set of granularities the first release supports is day, week, "
                    "month and year. Quarter is a reserved value: the type may name it "
                    "and configuration may round-trip it, but no command is generated "
                    "for it, no note is created for it, and no view offers it. Anything "
                    "asking for quarter behaves the same way as any other granularity "
                    "that is not enabled.",
        "rationale": "ARCH called quarter supported, NOTE used it as the example of an "
                     "unsupported granularity, ICE-01 deferred it, and CMD still listed "
                     "it for generated commands and startup opening. An agent reading "
                     "the backlog could not tell whether quarter paths must work. This "
                     "vault has quarter disabled, so nothing is lost by reserving it.",
        "stories": {
            "ARCH": ["US-ARCH-02"],
            "NOTE": ["US-NOTE-01", "US-NOTE-04"],
            "CMD": ["US-CMD-05", "US-CMD-09"],
        },
    },
    "DEC-24": {
        "title": "The first release is desktop only, and says so in the manifest",
        "decision": "manifest.json declares isDesktopOnly true, which means Obsidian "
                    "will not install Calendaric on a phone or tablet. No story may "
                    "promise phone behaviour while that stands. Hover-dependent "
                    "surfaces still need a pointer-free path, because a desktop user "
                    "can be on a keyboard or a touchscreen laptop, but that is an "
                    "accessibility requirement, not a mobile one. Mobile support is an "
                    "icebox entry, gated on replacing the desktop-only call behind "
                    "DEC-03's adapter.",
        "rationale": "DEC-03 already declared desktop only, and US-CAL-08 was written "
                     "for a laptop and a phone. Both cannot hold: isDesktopOnly true "
                     "blocks installation on mobile outright, so a phone criterion "
                     "could never be run, let alone passed. Desktop first without "
                     "closing the door is the stated position, and one adapter plus an "
                     "icebox entry is what keeps the door open.",
        "stories": {
            "CAL": ["US-CAL-08"],
            "SET": ["US-SET-04"],
        },
    },
    "DEC-25": {
        "title": "Calendaric does not manage a granularity a predecessor still owns",
        "decision": "When a predecessor plugin is enabled and has the same granularity "
                    "enabled, Calendaric shows a notice and does not create, template "
                    "or modify notes for that granularity. It still indexes and "
                    "displays them. Management resumes only once that predecessor no "
                    "longer has the granularity enabled. Choosing Calendaric in the "
                    "notice is what performs that change: the notice disables the "
                    "granularity in the predecessor's own configuration, and Calendaric "
                    "resumes only after re-reading it and finding the granularity off.",
        "rationale": "Two plugins creating the same daily note race each other and the "
                     "loser's template output is lost. An earlier wording let the user "
                     "pick Calendaric as owner without anything changing in the "
                     "predecessor, which re-opens exactly that race. Ownership has to "
                     "be a fact about the predecessor's configuration, not a preference "
                     "stored on our side.",
        "stories": {
            "MIG": ["US-MIG-06"],
        },
    },
}


def plan(dec_id: str, loaded: dict):
    """Resolve a decision's targets against `loaded`, returning (targets, problems)."""
    dec = DECISIONS.get(dec_id)
    if not dec:
        return [], [f"unknown decision: {dec_id}"]

    problems, targets = [], []
    for epic, story_ids in dec["stories"].items():
        path = EPICS / f"{epic}.json"
        if not path.exists():
            problems.append(f"{dec_id} names epic {epic}, which has no file at {path.name}")
            continue
        data = loaded.setdefault(epic, json.loads(path.read_text()))
        by_id = {s["id"]: s for s in data["stories"]}
        for sid in story_ids:
            if sid not in by_id:
                problems.append(f"{dec_id} names story {sid}, which is not in {path.name}")
            else:
                targets.append((epic, by_id[sid]))

    resolved = list(dec.get("resolves") or [])
    # A question id is legitimate if it is open now, or if this same decision
    # already closed it on a previous run. Anything else is a typo, including on
    # a re-run that only updates the text.
    open_ids = {q["id"] for _, story in targets for q in story.get("open_questions") or []}
    closed_by_us = {qid for _, story in targets
                    for x in story.get("decisions") or [] if x["id"] == dec_id
                    for qid in x.get("resolves") or []}
    for qid in resolved:
        if qid not in open_ids and qid not in closed_by_us:
            problems.append(f"{dec_id} resolves {qid}, which is not an open question on "
                            f"{', '.join(s['id'] for _, s in targets)} and was not closed "
                            f"by {dec_id} before")

    return targets, problems


def apply(dec_id: str, targets):
    dec = DECISIONS[dec_id]
    resolved = list(dec.get("resolves") or [])
    for _, story in targets:
        existing = story.setdefault("decisions", [])
        record = {
            "id": dec_id,
            "title": dec["title"],
            "decision": dec["decision"],
            "rationale": dec["rationale"],
            "resolves": resolved,
        }
        prior = next((x for x in existing if x["id"] == dec_id), None)
        if prior:
            prior.update(record)
        else:
            existing.append({**record, "decided_on": date.today().isoformat()})
        story["open_questions"] = [q for q in story.get("open_questions") or []
                                   if q["id"] not in set(resolved)]

    print(f"{dec_id}: recorded against {len(targets)} stories")


def main(*dec_ids: str) -> int:
    """Validate every named decision first, then write. All or nothing."""
    loaded, plans, problems = {}, [], []
    for dec_id in dec_ids:
        targets, found = plan(dec_id, loaded)
        problems += found
        plans.append((dec_id, targets))

    if problems:
        for text in problems:
            print(f"  {text}")
        print(f"nothing recorded: {len(problems)} problems")
        return 1

    for dec_id, targets in plans:
        apply(dec_id, targets)
    for epic, data in loaded.items():
        (EPICS / f"{epic}.json").write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(*(sys.argv[1:] or list(DECISIONS))))
