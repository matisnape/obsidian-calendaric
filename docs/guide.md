# Calendaric — User Guide

Setting and command names are shown in bold type, exactly as Calendaric's
settings and the command palette show them.

## Format Field

The **Format** field controls the filename of created notes. It accepts two syntaxes:

### moment.js format strings

Standard [moment.js format tokens](https://momentjs.com/docs/#/displaying/format/) apply to all granularities:

| Token | Example output (Mon 13 April 2026) |
|---|---|
| `YYYY-MM-DD` | `2026-04-13` |
| `gggg-[W]ww` | `2026-W16` |
| `YYYY-MM` | `2026-04` |

The `gggg-[W]ww` row assumes **Start week on** is Monday. See
[Which week a token reads](#which-week-a-token-reads).

When Obsidian's built-in Daily Notes plugin stored no format of its own, the
Daily Notes import writes `YYYY-MM-DD` into the **Format** field of Calendaric's
**Daily Notes** group instead of leaving it empty.

### Week tokens (Weekly Notes only)

Calendaric extends the **Format** field with week tokens that insert the date of a specific weekday within the target week. These are only evaluated for Weekly Notes.

Syntax: `{{weekday:format}}` where `weekday` is `monday`–`sunday` and `format` is any moment.js format string.

| Token | Week of 13–19 April 2026, **Start week on** Monday |
|---|---|
| `{{monday:DD.MM}}` | `13.04` |
| `{{tuesday:DD.MM}}` | `14.04` |
| `{{wednesday:YYYY-MM-DD}}` | `2026-04-15` |
| `{{sunday:DD.MM}}` | `19.04` |

Example, with **Start week on** set to Monday:

Format: `gggg-[W]ww, {{monday:DD.MM}} – {{sunday:DD.MM}}`
→ Filename: `2026-W16, 13.04 – 19.04`

This lets you encode the full date range of the week directly in the filename, without needing the **Allow prefix matching** setting.

### Which week a token reads

- In most formats, week tokens and week numbers (`gggg`, `ww`) follow **Start week on**.
  - With Saturday as the first day, the week of Wed 15 April 2026 runs from Sat 11 to Fri 17 April.
  - Name the days in the order your week runs. With a Saturday start, `{{monday:DD.MM}} – {{sunday:DD.MM}}` writes `13.04 – 12.04`, because that Sunday comes before that Monday.
- A format that uses ISO week tokens (`W`, `WW`, `GGGG`) asked for ISO weeks. ISO weeks always start on Monday, whatever **Start week on** says, and the week tokens in that format follow the ISO week.
- Template variables in a weekly note's body read the same week as its filename.

| Format | Filename for Wed 15 April 2026, **Start week on** Saturday |
|---|---|
| `gggg-[W]ww, {{saturday:DD.MM}} – {{friday:DD.MM}}` | `2026-W16, 11.04 – 17.04` |
| `GGGG-[W]WW, {{saturday:DD.MM}}` | `2026-W16, 18.04` |

---

## Template Variables

Template variables are substituted in the body of a note when it is created. They are distinct from Format tokens and are not valid in the **Format** field.

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
