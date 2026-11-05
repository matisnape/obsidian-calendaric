# Calendaric — User Guide

Setting and command names are shown in bold type, exactly as Calendaric's
settings and the command palette show them.

## Format Field

The **Format** field controls the filename of created notes. It accepts two syntaxes:

### moment.js format strings

Standard [moment.js format tokens](https://momentjs.com/docs/#/displaying/format/) apply to all granularities:

| Token | Example output for Sun 12 April 2026, **Start week on** Monday |
|---|---|
| `YYYY-MM-DD` | `2026-04-12` |
| `gggg-[W]ww` | `2026-W15` |
| `YYYY-MM` | `2026-04` |

The `gggg-[W]ww` row depends on the **Start week on** day the table names. See
[Which week a token reads](#which-week-a-token-reads).

When Obsidian's built-in Daily Notes plugin stored no format of its own, the
Daily Notes import writes `YYYY-MM-DD` into the **Format** field of Calendaric's
**Daily Notes** group instead of leaving it empty.

### Week tokens (Weekly Notes only)

Calendaric extends the **Format** field with week tokens that insert the date of a specific weekday within the target week. These are only evaluated for Weekly Notes.

Syntax: `{{weekday:format}}` where `weekday` is `monday`–`sunday` and `format` is any moment.js format string.

| Token | Week of Wed 15 April 2026, **Start week on** Monday |
|---|---|
| `{{monday:DD.MM}}` | `13.04` |
| `{{tuesday:DD.MM}}` | `14.04` |
| `{{wednesday:YYYY-MM-DD}}` | `2026-04-15` |
| `{{sunday:DD.MM}}` | `19.04` |

Example, for Wed 15 April 2026 with **Start week on** set to Monday:

Format: `gggg-[W]ww, {{monday:DD.MM}} – {{sunday:DD.MM}}`
→ Filename: `2026-W16, 13.04 – 19.04`

This lets you encode the full date range of the week directly in the filename, without needing the **Allow prefix matching** setting.

### Which week a token reads

- In most formats, week tokens and week numbers (`gggg`, `ww`) follow **Start week on**.
  - With Saturday as the first day, the week of Wed 15 April 2026 runs from Sat 11 to Fri 17 April.
  - Name the days in the order your week runs. With a Saturday start, `{{monday:DD.MM}} – {{sunday:DD.MM}}` writes `13.04 – 12.04`, because that Sunday comes before that Monday.
- A format that uses ISO week tokens (`W`, `WW`, `GGGG`) asked for ISO weeks. ISO weeks always start on Monday, whatever **Start week on** says, and the week tokens in that format follow the ISO week.
- Template variables in a weekly note's body read the same week as its filename.
- The calendar's week number column (**Show week numbers**) numbers weeks the way the weekly note's **Format** does: ISO week numbers for an ISO format, **Start week on** weeks otherwise.
  - The number is the week of the row's first day. With an ISO format and a Saturday start, the row Sat 11 – Fri 17 April 2026 shows 15, although Wed 15 April in that row writes `2026-W16`.

| Format | Filename for Wed 15 April 2026, **Start week on** Saturday |
|---|---|
| `gggg-[W]ww, {{saturday:DD.MM}} – {{friday:DD.MM}}` | `2026-W16, 11.04 – 17.04` |
| `GGGG-[W]WW, {{saturday:DD.MM}}` | `2026-W16, 18.04` |
| `[W]WW, {{saturday:DD.MM}}` | `W16, 18.04` |

---

## Note groups

Each kind of periodic note has its own group under **Periodic notes** in the
settings: **Daily Notes**, **Weekly Notes**, **Monthly Notes** and **Yearly Notes**.
Switch a group on with the toggle next to its name. Every group offers the same settings:

| Setting | What it does |
|---|---|
| **Format** | The filename of the group's notes. See [Format Field](#format-field). |
| **Note folder** | The folder new notes of the group are placed in. |
| **Daily Note Template**, **Weekly Note Template**, **Monthly Note Template**, **Yearly Note Template** | The file a new note's body is copied from. See [Template Variables](#template-variables). |
| **Allow prefix matching** | Also recognises a note whose filename starts with the date and then carries extra text. |
| **Open on startup** | Opens the group's note when the vault opens. Only one group can have it on, and only while the group is switched on. |

**Quarterly Notes** and **Custom Notes** are shown, but cannot be switched on yet.

---

## Commands

Open the command palette and type a command's name.

| Command | What it does |
|---|---|
| **Open calendar** | Opens the calendar view. The palette leaves it out while the calendar is already on screen. |
| **Reveal active note** | Shows the period of the daily or weekly note in the active pane in the calendar. |
| **Open date switcher** | Type a date in words, like last monday or next week, to open that period's note. Needs the Natural Language Dates plugin enabled. |

Each switched-on group (**Daily Notes**, **Weekly Notes**, **Monthly Notes**, **Yearly Notes**) adds its own commands:

| Command | What it does |
|---|---|
| **Open current daily note**, **Open current weekly note**, **Open current monthly note**, **Open current yearly note** | Opens the note for the period that holds today, creating it first when the vault has none. |
| **Open next daily note**, **Open next weekly note**, **Open next monthly note**, **Open next yearly note** | Opens the note for the period after the note in the active pane, creating it first when the vault has none. |
| **Open previous daily note**, **Open previous weekly note**, **Open previous monthly note**, **Open previous yearly note** | The same, for the period before. |
| **Jump forward to next existing daily note**, **Jump forward to next existing weekly note**, **Jump forward to next existing monthly note**, **Jump forward to next existing yearly note** | Opens the closest existing note after the one in the active pane. It never creates a note. |
| **Jump backward to previous existing daily note**, **Jump backward to previous existing weekly note**, **Jump backward to previous existing monthly note**, **Jump backward to previous existing yearly note** | The same, before the one in the active pane. |

The palette lists the next, previous and jump commands only while the active pane holds a note of that group.

---

## Template Variables

Template variables are substituted in the body of a note when it is created. They are distinct from Format tokens and are not valid in the **Format** field.

**Monthly Notes** and **Yearly Notes** have no variables of their own. The universal ones work in them.

### Universal

| Variable | Description |
|---|---|
| `{{date}}` | The note's own date in the note's configured format, also for a note created for another day |
| `{{date:format}}` | The note's own date with a custom format, e.g. `{{date:DD MMMM YYYY}}` |
| `{{time}}` | Current time, `HH:mm` |
| `{{title}}` | The note's filename (without extension) |

### Daily Notes

| Variable | Description |
|---|---|
| `{{yesterday}}` | Previous day in the configured format |
| `{{tomorrow}}` | Next day in the configured format |

### Weekly Notes

| Variable | Description |
|---|---|
| `{{monday:format}}` – `{{sunday:format}}` | Date of that weekday within the note's week |

Example template:

```markdown
# Week {{monday:DD.MM}} – {{sunday:DD.MM}}

## Goals

## Log
### Monday {{monday:DD.MM}}
### Tuesday {{tuesday:DD.MM}}
```
