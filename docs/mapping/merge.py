#!/usr/bin/env python3
"""Merge the per-source mapping JSONs into one calendaric-map.json.

Each agent writes <source-id>.json following SCHEMA.md. This script stamps every
record with its source id, concatenates the arrays, and validates the cross
references (module ids used by flows and capabilities must exist).
"""
import json
import pathlib
import re
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
    {"id": "external-moment", "name": "moment.js", "path": "—", "loc": 0,
     "role": "Date library Obsidian bundles and re-exports; every format, parse and week "
             "calculation in these repos goes through it.",
     "category": "external", "depends_on": [], "external": True},
    {"id": "external-obsidian-daily-notes-interface", "name": "obsidian-daily-notes-interface (published)",
     "path": "—", "loc": 0,
     "role": "The published package, as consumed from npm by the Calendar plugin. Distinct from "
             "the dni-* modules, which map the local checkout of its source.",
     "category": "external", "depends_on": [], "external": True},
    {"id": "external-popperjs-svelte", "name": "@popperjs/core", "path": "—", "loc": 0,
     "role": "Positions the hover popovers in obsidian-calendar-ui.",
     "category": "external", "depends_on": [], "external": True},
    {"id": "external-svelte-portal", "name": "svelte-portal", "path": "—", "loc": 0,
     "role": "Renders a component into a DOM node outside its parent, used for the popovers.",
     "category": "external", "depends_on": [], "external": True},
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
     "id": "OBS-review-01",
     "what": "obsidian-calendaric defines the Granularity type three times, independently.",
     "where": ["obsidian-calendaric/src/notes/noteCreate.ts:7",
               "obsidian-calendaric/src/notes/templateTokens.ts:5",
               "obsidian-calendaric/src/settings.ts:59-60"],
     "why_it_matters": "Widening the type to month/quarter/year means editing three places, and "
                       "settings.ts already splits it into ActiveGranularity vs Granularity while "
                       "the other two do not. A partial widening compiles and fails at runtime."},
    {"severity": "P2", "kind": "duplication",
     "id": "OBS-review-02",
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
     "id": "OBS-review-03",
     "what": "appHasPeriodicNotesPluginLoaded() reads periodicNotes.settings?.weekly?.enabled — the "
             "same Svelte-store-as-plain-object bug that commit 39040cd fixed for the monthly path, "
             "compounded by 'weekly' being a key Periodic Notes no longer stores.",
     "where": ["obsidian-calendar-plugin/src/settings.ts:55",
               "obsidian-calendar-plugin/src/settings.ts:147"],
     "why_it_matters": "It always returns falsy, so the Calendar plugin keeps rendering its own "
                       "Weekly Note Settings section instead of deferring to Periodic Notes. This "
                       "is live in the vault today, not only a merge concern."},
    {"severity": "P1", "kind": "bug",
     "id": "OBS-review-04",
     "what": "A prefix-matched note is indexed but cannot be looked up. resolve() stores an entry "
             "with matchData.exact false when the strict parse fails and the loose one succeeds, "
             "but getPeriodicNote() returns only entries with matchData.exact === true.",
     "where": ["obsidian-periodic-notes/src/cache.ts:205-224",
               "obsidian-periodic-notes/src/cache.ts:270-289",
               "obsidian-periodic-notes/src/main.ts:276-282"],
     "why_it_matters": "This is live in the vault: week format gggg-[W]ww with allowPrefixMatch on, "
                       "and 60 weekly files named 'YYYY-Wnn, DD.MM - DD.MM.md'. Opening such a week "
                       "finds nothing and creates a second, raw-named file next to the existing one. "
                       "Prefix matching is only half-wired, so the rewrite must carry the match "
                       "through lookup and open, not only through indexing."},
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


ROOTS = {}
OBS_PROBLEMS = []


LINE_SPEC = re.compile(r"\s*(\d+)\s*(?:-\s*(\d+)\s*)?\Z")


def parse_line_spec(lines):
    """Return [(start, end)] for '17', '17-72' or '38-44, 300-322'; None if unparseable.

    An empty or 'n/a' value means the record deliberately cites no line.
    """
    if lines is None:
        return []
    text = str(lines).strip()
    if not text or text.lower() in ("n/a", "—", "-"):
        return []
    spans = []
    for part in text.split(","):
        m = LINE_SPEC.match(part)
        if not m:
            return None
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else start
        spans.append((start, end))
    return spans


GIT_REFS = {"HEAD", "ORIG_HEAD", "FETCH_HEAD"}


def cite(owner, source, text, problems, module_ids=()):
    """Split one observation `where` entry into a checkable (path, lines) pair.

    The real grammar in the sources is
    `[<module-id>|<repo-dir>:]<path>[:<lines>][@<sha>][ (prose)]`.
    Prose and sha are dropped; the module id is dropped; a repo directory
    becomes the first path segment. A git ref stands for the repository, so it
    is checked as that directory rather than as a file.
    """
    if not isinstance(text, str) or not text.strip():
        problems.append(f"{owner} has a citation that is not a path: {text!r}")
        return []
    text = text.strip()
    if text in ("—", "-", "n/a"):
        return []
    if text.endswith(")") and "(" in text:
        text = text[:text.index("(")].strip()
    text = re.sub(r"@[0-9a-f]{6,40}$", "", text).strip()
    if not text:
        return []

    root = pathlib.Path(ROOTS.get(source) or ".")
    parts = text.split(":")
    prefix = ""
    if len(parts) > 1:
        head = parts[0].strip()
        if head in module_ids:
            parts = parts[1:]
        elif (root / head).is_dir() or (root.parent / head).is_dir():
            prefix, parts = head + "/", parts[1:]

    lines = None
    if len(parts) > 1:
        # "125-171, specifically line 142" — take the spec, drop the aside.
        m = re.match(r"\s*([\d\s-]+(?:,\s*[\d\s-]+)*)\s*(?:,.*)?$", parts[-1])
        if m and re.search(r"\d", m.group(1)):
            lines = m.group(1)
            parts = parts[:-1]
    path = ":".join(parts).strip()
    if not path:
        problems.append(f"{owner} cites {text!r}, which names no file")
        return []
    if path in GIT_REFS:
        # Names the repository at a revision, not a file in it.
        return [(owner, source, prefix or "./", None)] if prefix else []
    return [(owner, source, prefix + path, lines)]


def check_citations(out):
    """Every path:line citation must point at a real file and real lines."""
    problems = []
    # An unreadable source root used to disable every check for that source.
    for src in out["sources"]:
        root = src.get("path")
        if not isinstance(root, str) or not root or not pathlib.Path(root).is_dir():
            problems.append(f"source {src['id']} has no readable root path: {root!r}")
    # Every record type that carries a path, not only capabilities.
    module_ids = {m["id"] for m in out["modules"]}
    records = []
    for c in out["capabilities"]:
        for d in c.get("defined_in") or []:
            path, lines = d.get("path"), d.get("lines")
            if not isinstance(path, str):
                problems.append(f"capability {c['uid']} defined_in path is not a string: {path!r}")
                continue
            records.append((c["uid"], c["source"], path, lines))
    for obs in out["observations"]:
        for where in obs.get("where") or []:
            records += cite(obs.get("id", "?"), obs["source"], where, problems, module_ids)
    for key, field in (("settings", "key"), ("commands", "id"), ("api_surface", "export")):
        for rec in out.get(key) or []:
            path = rec.get("path")
            owner = f"{rec['source']}:{rec.get(field, '?')}"
            if not isinstance(path, str):
                continue
            # One record may cite several files, separated by ';'.
            for segment in path.split(";"):
                segment = segment.strip()
                if not segment:
                    continue
                head, sep, tail = segment.rpartition(":")
                if sep and re.fullmatch(r"[\d,\s-]+", tail):
                    records.append((owner, rec["source"], head.strip(), tail))
                else:
                    records.append((owner, rec["source"], segment, None))

    for owner, source, path, lines in records:
        root = ROOTS.get(source)
        if not root or not isinstance(path, str) or not path or path in ("—", "-"):
            continue
        # A citation may name a sibling repository, so try the shared parent too.
        candidates = [pathlib.Path(root) / path, pathlib.Path(root).parent / path]
        if path.endswith("/") or path == "./":
            if not any(c.is_dir() for c in candidates):
                problems.append(f"{owner} cites missing directory {path}")
            continue
        fp = next((c for c in candidates if c.is_file()), None)
        if fp is None:
            problems.append(f"{owner} cites missing file {path}")
            continue
        spans = parse_line_spec(lines)
        if spans is None:
            problems.append(f"{owner} cites {path} with an unreadable line spec {lines!r}")
            continue
        n = len(fp.read_text().splitlines())
        for start, end in spans:
            if start < 1 or end < start:
                problems.append(f"{owner} cites {path}:{lines}, which is not a real range")
            elif end > n:
                problems.append(f"{owner} cites {path}:{lines} but the file has {n} lines")
    return problems


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
        ROOTS[sid] = src.get("path")
        for key in ARRAYS:
            for rec in data.get(key) or []:
                rec["source"] = sid
                out[key].append(rec)

    canonicalise(out)

    seen_obs = set()
    for obs in out["observations"]:
        oid = obs.get("id")
        expected = f"OBS-{obs['source']}-"
        if not oid:
            OBS_PROBLEMS.append(f"observation in {obs['source']} has no id: {obs['what'][:60]}")
        elif not (isinstance(oid, str) and oid.startswith(expected)
                  and re.fullmatch(r"\d{2}", oid[len(expected):])):
            OBS_PROBLEMS.append(f"observation id {oid!r} is not {expected}<nn>")
        elif oid in seen_obs:
            OBS_PROBLEMS.append(f"observation id {oid} is used more than once")
        else:
            seen_obs.add(oid)

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
    # Settings and commands name the capabilities they reach the same way.
    for setting in out["settings"]:
        refs = setting.get("affects") or []
        setting["affects"] = [
            f"{setting['source']}:{r}" if f"{setting['source']}:{r}" in by_uid else r for r in refs]
    for command in out["commands"]:
        refs = command.get("calls") or []
        command["calls"] = [
            f"{command['source']}:{r}" if f"{command['source']}:{r}" in by_uid else r for r in refs]

    for mod in out["modules"]:
        mod["uid"] = f"{mod['source']}:{mod['id']}"

    all_module_uids = [m["uid"] for m in out["modules"]]
    module_uids = set(all_module_uids)

    def module_ref(source, ref):
        """A bare module id means "the one in my own source", when that exists."""
        own = f"{source}:{ref}"
        return own if own in module_uids else ref

    for mod in out["modules"]:
        mod["depends_on"] = [module_ref(mod["source"], r) for r in mod.get("depends_on") or []]
    for cap in out["capabilities"]:
        for dfn in cap.get("defined_in") or []:
            if dfn.get("module"):
                dfn["module"] = module_ref(cap["source"], dfn["module"])
        cap["used_by"] = [module_ref(cap["source"], r) for r in cap.get("used_by") or []]
    for flow in out["flows"]:
        for step in flow.get("steps") or []:
            for end in ("from", "to"):
                if step.get(end):
                    step[end] = module_ref(flow["source"], step[end])

    module_ids = {m["id"] for m in out["modules"]}
    duplicate_module_uids = sorted({u for u in all_module_uids if all_module_uids.count(u) > 1})
    ambiguous_modules = {i for i in module_ids
                         if sum(1 for m in out["modules"] if m["id"] == i) > 1}
    cap_ids = {c["id"] for c in out["capabilities"]}
    cap_uids = {c["uid"] for c in out["capabilities"]}
    ambiguous = {i for i in cap_ids if sum(1 for c in out["capabilities"] if c["id"] == i) > 1}
    problems = [f"module uid {u} is declared more than once" for u in duplicate_module_uids]
    problems += OBS_PROBLEMS

    def check_module_ref(ref, where):
        if ref in module_uids:
            return
        if ref not in module_ids:
            problems.append(f"{where} references unknown module {ref}")
        elif ref in ambiguous_modules:
            problems.append(f"{where} references ambiguous module id {ref} "
                            f"— use a source-qualified uid")

    for flow in out["flows"]:
        for i, step in enumerate(flow.get("steps") or [], 1):
            for end in ("from", "to"):
                ref = step.get(end)
                if ref:
                    check_module_ref(ref, f"flow {flow['source']}:{flow['id']} step {i} {end}")
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
            if ref:
                check_module_ref(ref, f"capability {cap['uid']} defined_in")
        for ref in cap.get("used_by") or []:
            check_module_ref(ref, f"capability {cap['uid']} used_by")
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

    for mod in out["modules"]:
        for ref in mod.get("depends_on") or []:
            check_module_ref(ref, f"module {mod['uid']} depends_on")

    known_cats = {c["id"] for c in CATEGORIES}
    for m in out["modules"]:
        if m.get("category") not in known_cats:
            problems.append(f"module {m['uid']} has unknown category {m.get('category')}")

    problems += check_citations(out)

    dest = HERE / "calendaric-map.json"
    if not (problems or missing):
        dest.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    else:
        print("NOT WRITING calendaric-map.json — validation failed\n")

    if not (problems or missing):
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
