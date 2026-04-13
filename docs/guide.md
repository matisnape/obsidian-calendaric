# Calendaric — User Guide

## Format Field

The Format field controls the filename of created notes. It accepts two syntaxes:

### moment.js format strings

Standard [moment.js format tokens](https://momentjs.com/docs/#/displaying/format/) apply to all granularities:

| Token | Example output |
|---|---|
| `YYYY-MM-DD` | `2026-04-13` |
| `gggg-[W]ww` | `2026-W16` |
| `YYYY-MM` | `2026-04` |

### Week tokens (Weekly Notes only)

Calendaric extends the Format field with week tokens that insert the date of a specific weekday within the target week. These are only evaluated for Weekly Notes.

**Syntax:** `{{weekday:format}}` where `weekday` is `monday`–`sunday` and `format` is any moment.js format string.

| Token | Week of Apr 13–19, 2026 (ISO W16) |
|---|---|
| `{{monday:DD.MM}}` | `13.04` |
| `{{tuesday:DD.MM}}` | `14.04` |
| `{{wednesday:YYYY-MM-DD}}` | `2026-04-15` |
| `{{sunday:DD.MM}}` | `19.04` |

**Example:**

Format: `gggg-[W]ww, {{monday:DD.MM}} – {{sunday:DD.MM}}`
→ Filename: `2026-W16, 13.04 – 19.04`

This lets you encode the full date range of the week directly in the filename, without needing the "Allow prefix matching" setting.

> Note: Week tokens are resolved using the same week-start locale as your "Start week on" setting.

---

## Template Variables

Template variables are substituted in the **body** of a note when it is created. They are distinct from Format tokens and are not valid in the Format field.

### Universal

| Variable | Description |
|---|---|
| `{{date}}` | Creation date in the note's configured format |
| `{{date:format}}` | Creation date with a custom format, e.g. `{{date:DD MMMM YYYY}}` |
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

**Example template:**

```markdown
# Week {{monday:DD.MM}} – {{sunday:DD.MM}}

## Goals

## Log
### Monday {{monday:DD.MM}}
### Tuesday {{tuesday:DD.MM}}
```
