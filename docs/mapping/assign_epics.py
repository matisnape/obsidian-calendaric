#!/usr/bin/env python3
"""Assign every mapped capability to a backlog epic.

Each capability lands in exactly one epic, so the story-writing agents cannot
leave a gap or write the same story twice. `role` says how the agent must treat
it:

  build    — becomes one or more user stories in that epic
  evidence — a constraint the epic's stories must respect, not a story itself
             (the vault's Templater layer: how the features are really used)
  icebox   — kept, not built now; becomes an ICE-* entry with its reason
"""
import json, pathlib
from collections import Counter, defaultdict

HERE = pathlib.Path(__file__).parent
CAPS = json.loads((HERE / "calendaric-map.json").read_text())["capabilities"]

EPICS = {
    "NOTE": "Resolve, create, open and navigate periodic notes",
    "FMT":  "Filename formats, date parsing, week numbers, locale",
    "TPL":  "Template files and token substitution in the note body",
    "CAL":  "The calendar view: grid, navigation, indicators, interaction",
    "SET":  "Configuration model and settings UI",
    "CMD":  "Commands, ribbon, menus and startup behaviour",
    "MIG":  "Importing existing configuration and coexisting with other plugins",
    "ARCH": "Architecture, boundaries, testability and release quality",
    "ICE":  "Kept for a later decision, not built now",
}

# Explicit decisions. Everything not listed here falls through to the rules.
OVERRIDE = {
    # --- icebox: quarterly notes are disabled and unconfigured in the vault ---
    **{f"dni:{k}": "ICE" for k in
       ("create-quarterly-note", "get-quarterly-note", "get-all-quarterly-notes",
        "resolve-quarterly-settings", "detect-quarterly-notes-plugin-loaded")},
    # --- icebox: multiple calendar sets; the vault has only "Default" ---
    "pn:create-calendar-set": "ICE", "pn:duplicate-calendar-set": "ICE",
    "pn:rename-calendar-set": "ICE", "pn:delete-calendar-set": "ICE",
    "pn:switch-active-calendar-set": "ICE",
    "pn:calendar-set-quick-switch-modal": "ICE",
    "pn:settings-dashboard-list-and-add": "ICE",
    "pn:settings-details-rename-and-toggle-granularities": "ICE",
    # --- icebox: surfaces nothing in the vault uses ---
    "pn:related-files-switcher-tab-handoff": "ICE",
    "pn:get-periodic-notes-related": "ICE",
    # The Timeline complication is enabled in the live vault and mounts into every
    # open markdown view, so deferring it would remove a feature that runs today.
    "pn:timeline-complication-render": "CAL", "pn:timeline-lifecycle-per-leaf": "CAL",
    "pn:relative-date-humanization": "CAL",
    # nldates-obsidian is installed and enabled, so this command does appear.
    "pn:nl-date-navigator": "CMD",
    "cal:metadata-source-streak": "ICE", "cal:metadata-source-tags": "ICE",
    "cal:metadata-source-tasks": "ICE",
    "cal:extend-metadata-sources-via-event": "ICE",
    "calui:drag-day-or-week-note": "ICE",
    "calendaric:granularity-placeholder-groups": "ICE",
    "pn:loose-date-parsing-fallback-global": "ICE",
    # --- these read as UI but are really about configuration ---
    "cal:settings-tab-ui": "SET", "cal:persist-plugin-settings": "SET",
    "calendaric:open-format-guide-from-settings": "SET",
    "pn:settings-router-navigation": "SET",
    "calendaric:override-locale-setting": "FMT",
    "calendaric:calendar-week-start-resolution": "FMT",
    # week tokens used in the Format field belong to naming, not to the body
    "calendaric:template-token-weekday-format": "FMT",
    "pn:localization-week-start-override": "FMT",
    "pn:localization-locale-override": "FMT",
    "calui:configure-locale-and-week-start": "FMT",
    "pn:format-validation": "FMT", "pn:fragile-basename-detection": "FMT",
    "pn:folder-validation": "NOTE", "pn:template-validation": "TPL",
    "pn:allow-prefix-match-gate": "FMT",
    "forks:periodic-note-prefix-match-setting": "FMT",
    "cal:get-word-count": "CAL",
    "cal:get-date-uid-from-file": "FMT",
    # --- note cache is note resolution infrastructure, not view state ---
    **{f"pn:{k}": "NOTE" for k in
       ("find-note-in-cache", "cache-index-build-on-load", "cache-resolve-on-file-create",
        "cache-resolve-on-rename", "cache-resolve-frontmatter", "cache-reset-on-settings-change")},
    # --- entry points and lifecycle ---
    "cal:open-calendar-view": "CMD", "calendaric:open-calendar-view": "CMD",
    "cal:auto-reveal-view-on-layout-ready": "CMD",
    "cal:reveal-active-note-command": "CMD",
    "cal:open-weekly-note-command": "CMD",
    "pn:dynamic-command-registration": "CMD",
    "pn:ribbon-icon-single-granularity": "CMD",
    "pn:context-menu-open-note": "CMD",
    "pn:jump-to-adjacent-note-command": "CMD",
    "pn:open-adjacent-note-command": "CMD",
    "pn:startup-note-auto-open": "CMD", "calendaric:startup-note-auto-open": "CMD",
    "pn:clear-startup-note-exclusivity": "CMD",
    "calendaric:clear-startup-note-exclusivity": "CMD",
    "cal:day-week-context-menu": "CAL", "cal:file-context-menu": "CAL",
    # --- interop / import ---
    **{f"dni:{k}": "MIG" for k in
       ("detect-periodic-notes-plugin", "detect-daily-notes-plugin-loaded",
        "detect-weekly-notes-plugin-loaded", "detect-monthly-notes-plugin-loaded",
        "detect-yearly-notes-plugin-loaded", "should-use-periodic-notes-settings")},
    "forks:dev-plugin-id-fallback": "MIG",
    "cal:periodic-notes-weekly-detection": "MIG",
    "cal:periodic-notes-monthly-plugin-resolution": "MIG",
    "cal:daily-notes-plugin-warning-banner": "MIG",
    "pn:legacy-settings-migration": "MIG",
    "pn:getting-started-banner-daily-notes-detection": "MIG",
    "forks:settings-tab-crash-guard-1.13": "ARCH",
    "forks:git-dependency-self-build": "ARCH",
    # --- month-header click is a calendar interaction ---
    "cal:month-header-click-open-monthly-note": "CAL",
    "forks:open-monthly-note-from-header": "CAL",
    "cal:reset-month-to-today-on-header-click": "CAL",
    "cal:expose-displayed-month": "CAL",
    "calui:periodic-note-file-cache": "NOTE",
}

def rule(cap):
    src, cat, surf = cap["source"], cap["category"], cap["surface"]
    if surf == "template-token":
        return "TPL"
    if cat == "dates":
        return "FMT"
    if cat == "notes":
        return "NOTE"
    if cat == "config":
        return "SET"
    if cat == "integration":
        return "MIG"
    if cat in ("ui", "state", "entry"):
        return "CAL"
    return "CAL"

rows = []
for cap in CAPS:
    epic = OVERRIDE.get(cap["uid"]) or rule(cap)
    role = "icebox" if epic == "ICE" else ("evidence" if cap["source"] == "vault" else "build")
    rows.append({"uid": cap["uid"], "epic": epic, "role": role,
                 "name": cap["name"], "surface": cap["surface"],
                 "category": cap["category"], "source": cap["source"]})

(HERE / "epic-assignment.json").write_text(
    json.dumps({"epics": EPICS, "assignment": rows}, indent=2, ensure_ascii=False) + "\n")

by_epic = defaultdict(list)
for r in rows:
    by_epic[r["epic"]].append(r)
print(f"{len(rows)} capabilities assigned\n")
for epic in list(EPICS) :
    rs = by_epic.get(epic, [])
    if not rs:
        print(f"{epic:<5} 0")
        continue
    roles = Counter(r["role"] for r in rs)
    print(f"{epic:<5} {len(rs):>3}  {dict(roles)}")
print()
for epic in list(EPICS):
    print(f"\n### {epic} — {EPICS[epic]}")
    for r in sorted(by_epic.get(epic, []), key=lambda r: (r["role"], r["uid"])):
        print(f"  [{r['role'][:4]}] {r['uid']:<52} {r['name'][:58]}")
