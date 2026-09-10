#!/usr/bin/env python3
"""Merge the per-source mapping JSONs into one calendaric-map.json.

Each agent writes <source-id>.json following SCHEMA.md. This script stamps every
record with its source id, concatenates the arrays, and validates the cross
references (module ids used by flows and capabilities must exist).
"""
import json
import pathlib
import sys
from datetime import date

HERE = pathlib.Path(__file__).parent
# Per-source files live in sources/ once installed; alongside during drafting.
SRC = HERE / "sources" if (HERE / "sources").is_dir() else HERE
SOURCE_IDS = ["dni", "calui", "cal", "pn", "calendaric", "vault", "forks"]

CATEGORIES = [
    {"id": "entry", "label": "Plugin lifecycle", "color": "#f7b955"},
    {"id": "notes", "label": "Note resolution & IO", "color": "#5fd2aa"},
    {"id": "dates", "label": "Dates & parsing", "color": "#8bd6ff"},
    {"id": "config", "label": "Settings & storage", "color": "#bd8cff"},
    {"id": "ui", "label": "Views & components", "color": "#7c9cff"},
    {"id": "state", "label": "Stores & cache", "color": "#ff8e8e"},
    {"id": "integration", "label": "Cross-plugin", "color": "#ffd166"},
    {"id": "external", "label": "Outside the code", "color": "#8d93a8"},
]

ARRAYS = ["modules", "capabilities", "flows", "settings", "commands",
          "api_surface", "observations"]



# --- Canonicalisation -------------------------------------------------------
# Each agent invented its own ids for things outside its own repo. These maps
# fold them onto one id per real thing, so the merged graph has no dangling
# references and no duplicate external nodes.

EXTERNAL_MODULES = [
    {"id": "pn-settings-primitives", "name": "settings/components/ (presentational)",
     "path": "src/settings/components/", "loc": 430,
     "role": "Generic settings widgets with no periodic-notes logic: Arrow, Breadcrumbs, "
             "Checkmark, Dropdown, Footer, IconButton, SettingItem, Toggle.",
     "category": "ui", "depends_on": [], "external": False},
    {"id": "ext-obsidian-api", "name": "Obsidian API", "path": "—", "loc": 0,
     "role": "App, Vault, Workspace, TFile, metadataCache, Plugin, ItemView.",
     "category": "external", "depends_on": [], "external": True},
    {"id": "ext-plugin-periodic-notes", "name": "Periodic Notes plugin instance", "path": "—", "loc": 0,
     "role": "Reached via app.plugins.getPlugin('periodic-notes-anks' | 'periodic-notes').",
     "category": "external", "depends_on": [], "external": True},
    {"id": "ext-plugin-calendar", "name": "Calendar plugin instance", "path": "—", "loc": 0,
     "role": "Reached via app.plugins.getPlugin('calendar-anks' | 'calendar').",
     "category": "external", "depends_on": [], "external": True},
    {"id": "ext-plugin-daily-notes-core", "name": "Core Daily Notes plugin", "path": "—", "loc": 0,
     "role": "Obsidian's built-in daily notes plugin, read via app.internalPlugins.",
     "category": "external", "depends_on": [], "external": True},
    {"id": "ext-plugin-templater", "name": "Templater plugin", "path": "—", "loc": 0,
     "role": "Runs the vault's templates on file creation and on demand.",
     "category": "external", "depends_on": [], "external": True},
    {"id": "ext-plugin-dataview", "name": "Dataview plugin", "path": "—", "loc": 0,
     "role": "Runs the LIST and dataviewjs queries embedded in the periodic templates.",
     "category": "external", "depends_on": [], "external": True},
]

ALIASES = {
    # externals, as each agent named them
    "obsidian-api": "ext-obsidian-api",
    "external-obsidian": "ext-obsidian-api",
    "cal-ext-obsidian-api": "ext-obsidian-api",
    "pn-ext-obsidian-api": "ext-obsidian-api",
    "periodic-notes-plugin": "ext-plugin-periodic-notes",
    "cal-ext-periodic-notes": "ext-plugin-periodic-notes",
    "external:periodic-notes-anks-plugin": "ext-plugin-periodic-notes",
    "calendar-plugin": "ext-plugin-calendar",
    "obsidian-internal-daily-notes-plugin": "ext-plugin-daily-notes-core",
    "external:templater-plugin": "ext-plugin-templater",
    "external:dataview-plugin": "ext-plugin-dataview",
    # cross-source references to a whole repo -> the module that actually receives them
    "obsidian-calendar-plugin": "cal-view",
    "obsidian-calendar-ui": "cal-ext-calendar-ui",
    "obsidian-daily-notes-interface": "cal-ext-dni",
}

# Capability ids that an agent put in a `used_by` slot, which wants module ids.
USED_BY_IS_CAPABILITY = {"daily-anchor-link-to-work-heading"}

# Findings from the review pass over the agents' output, kept separate from
# what any single agent reported.
REVIEW_OBSERVATIONS = [
    {"severity": "P2", "kind": "duplication",
     "what": "obsidian-calendaric defines the Granularity type three times, independently.",
     "where": ["obsidian-calendaric/src/notes/noteCreate.ts:7",
               "obsidian-calendaric/src/notes/templateTokens.ts:5",
               "obsidian-calendaric/src/settings.ts:59-60"],
     "why_it_matters": "Widening the type to month/quarter/year means editing three places, and "
                       "settings.ts already splits it into ActiveGranularity vs Granularity while "
                       "the other two do not. A partial widening compiles and fails at runtime."},
    {"severity": "P2", "kind": "duplication",
     "what": "The hardcoded dev plugin ids appear at six call sites across four functions in two "
             "repos, not three as first reported.",
     "where": ["obsidian-calendar-plugin/src/settings.ts:53",
               "obsidian-calendar-plugin/src/settings.ts:77",
               "obsidian-daily-notes-interface/src/settings.ts:20",
               "obsidian-daily-notes-interface/src/settings.ts:74",
               "obsidian-daily-notes-interface/src/index.ts:23",
               "obsidian-daily-notes-interface/src/index.ts:38",
               "obsidian-daily-notes-interface/src/index.ts:46"],
     "why_it_matters": "The merged plugin has one id, so every one of these probes must be deleted "
                       "or repointed. Missing one leaves a lookup that silently resolves to null."},
    {"severity": "P1", "kind": "bug",
     "what": "appHasPeriodicNotesPluginLoaded() reads periodicNotes.settings?.weekly?.enabled — the "
             "same Svelte-store-as-plain-object bug that commit 39040cd fixed for the monthly path, "
             "compounded by 'weekly' being a key Periodic Notes no longer stores.",
     "where": ["obsidian-calendar-plugin/src/settings.ts:55",
               "obsidian-calendar-plugin/src/settings.ts:147"],
     "why_it_matters": "It always returns falsy, so the Calendar plugin keeps rendering its own "
                       "Weekly Note Settings section instead of deferring to Periodic Notes. This "
                       "is live in the vault today, not only a merge concern."},
]


def canonicalise(out):
    """Rewrite every module reference through ALIASES and drop duplicate externals."""
    for m in EXTERNAL_MODULES:
        m = dict(m)
        m["source"] = "pn" if m["id"].startswith("pn-") else "shared"
        out["modules"].append(m)

    # Drop the per-agent external stubs that ALIASES folds away.
    out["modules"] = [m for m in out["modules"] if m["id"] not in ALIASES]

    fix = lambda ref: ALIASES.get(ref, ref)

    for flow in out["flows"]:
        for step in flow.get("steps") or []:
            for end in ("from", "to"):
                if step.get(end):
                    step[end] = fix(step[end])
    for cap in out["capabilities"]:
        for d in cap.get("defined_in") or []:
            if d.get("module"):
                d["module"] = fix(d["module"])
        moved = [u for u in (cap.get("used_by") or []) if u in USED_BY_IS_CAPABILITY]
        if moved:
            cap["used_by"] = [u for u in cap["used_by"] if u not in USED_BY_IS_CAPABILITY]
            cap["depends_on_capability"] = (cap.get("depends_on_capability") or []) + moved
        cap["used_by"] = [fix(u) for u in (cap.get("used_by") or [])]
    for m in out["modules"]:
        m["depends_on"] = [fix(x) for x in (m.get("depends_on") or [])]

    for obs in REVIEW_OBSERVATIONS:
        out["observations"].append({**obs, "source": "review"})


def main() -> int:
    out = {
        "meta": {
            "generated": date.today().isoformat(),
            "purpose": "Feature map of the Obsidian calendar / periodic-notes family, "
                       "built to merge them into the obsidian-calendaric plugin.",
            "schema": "docs/mapping/SCHEMA.md",
        },
        "categories": CATEGORIES,
        "sources": [],
    }
    for key in ARRAYS:
        out[key] = []

    missing = []
    for sid in SOURCE_IDS:
        path = SRC / f"{sid}.json"
        if not path.exists():
            missing.append(sid)
            continue
        data = json.loads(path.read_text())
        src = data.get("source", {})
        src.setdefault("id", sid)
        src["counts"] = {k: len(data.get(k) or []) for k in ARRAYS}
        out["sources"].append(src)
        for key in ARRAYS:
            for rec in data.get(key) or []:
                rec["source"] = sid
                out[key].append(rec)

    canonicalise(out)

    # The workflows viewer expects `packages`; modules are the same thing.
    out["packages"] = out["modules"]

    # Capability ids are only unique inside one source, so give every record a
    # globally-unique uid. Everything outside a source must reference the uid.
    for cap in out["capabilities"]:
        cap["uid"] = f"{cap['source']}:{cap['id']}"

    # A bare capability id written by an agent means "the one in my own source".
    # Rewrite every such reference to its uid so nothing stays ambiguous.
    by_uid = {c["uid"]: c for c in out["capabilities"]}
    for cap in out["capabilities"]:
        refs = cap.get("depends_on_capability") or []
        cap["depends_on_capability"] = [
            f"{cap['source']}:{r}" if f"{cap['source']}:{r}" in by_uid else r for r in refs]
    for flow in out["flows"]:
        refs = flow.get("capabilities") or []
        flow["capabilities"] = [
            f"{flow['source']}:{r}" if f"{flow['source']}:{r}" in by_uid else r for r in refs]

    module_ids = {m["id"] for m in out["modules"]}
    cap_ids = {c["id"] for c in out["capabilities"]}
    cap_uids = {c["uid"] for c in out["capabilities"]}
    ambiguous = {i for i in cap_ids if sum(1 for c in out["capabilities"] if c["id"] == i) > 1}
    problems = []

    for flow in out["flows"]:
        for i, step in enumerate(flow.get("steps") or [], 1):
            for end in ("from", "to"):
                ref = step.get(end)
                if ref and ref not in module_ids:
                    problems.append(
                        f"flow {flow['source']}:{flow['id']} step {i} {end}={ref} "
                        f"is not a known module id")
        for ref in flow.get("capabilities") or []:
            if ref in cap_uids:
                continue
            if ref not in cap_ids:
                problems.append(
                    f"flow {flow['source']}:{flow['id']} references unknown capability {ref}")
            elif ref in ambiguous:
                problems.append(
                    f"flow {flow['source']}:{flow['id']} references ambiguous capability id "
                    f"{ref} — use a source-qualified uid")

    for cap in out["capabilities"]:
        for d in cap.get("defined_in") or []:
            ref = d.get("module")
            if ref and ref not in module_ids:
                problems.append(
                    f"capability {cap['source']}:{cap['id']} defined_in module {ref} is unknown")
        for ref in cap.get("used_by") or []:
            if ref not in module_ids:
                problems.append(
                    f"capability {cap['source']}:{cap['id']} used_by {ref} is not a known module id")
        for ref in cap.get("depends_on_capability") or []:
            if ref in cap_uids:
                continue
            if ref not in cap_ids:
                problems.append(
                    f"capability {cap['uid']} depends on unknown capability {ref}")
            elif ref in ambiguous:
                problems.append(
                    f"capability {cap['uid']} depends on ambiguous capability id {ref} "
                    f"— use a source-qualified uid")

    known_cats = {c["id"] for c in CATEGORIES}
    for m in out["modules"]:
        if m.get("category") not in known_cats:
            problems.append(f"module {m['source']}:{m['id']} has unknown category {m.get('category')}")

    dest = HERE / "calendaric-map.json"
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {dest}")
    if missing:
        print(f"MISSING SOURCES: {', '.join(missing)}")
    for src in out["sources"]:
        c = src["counts"]
        print(f"  {src['id']:<11} mod={c['modules']:<4} cap={c['capabilities']:<4} "
              f"flow={c['flows']:<3} set={c['settings']:<4} cmd={c['commands']:<3} "
              f"api={c['api_surface']:<4} obs={c['observations']}")
    print(f"  {'TOTAL':<11} " + " ".join(f"{k}={len(out[k])}" for k in ARRAYS))
    if problems:
        print(f"\n{len(problems)} REFERENCE PROBLEMS:")
        for p in problems:
            print(f"  - {p}")
    else:
        print("\nno reference problems")
    return 1 if (missing or problems) else 0


if __name__ == "__main__":
    sys.exit(main())
