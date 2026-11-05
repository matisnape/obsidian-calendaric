# Calendaric user manual

## TL;DR

Calendaric is an Obsidian plugin that shows a month calendar in the sidebar and creates one note per day, week, month or year.
It replaces four older plugins: Calendar, Periodic Notes, the core Daily Notes plugin, and the library they shared.

- Install it from source (there is no published release yet), switch it on, and the calendar appears in the right sidebar.
- Click a day to open that day's note. If the note does not exist, Calendaric asks, then creates it.
- If the core Daily Notes plugin is still on, Calendaric will not create daily notes until you hand them over. The [quick start](#quick-start) shows how.

Format tokens and template variables have their own reference: the [format and template guide](guide.md). This manual links to it instead of repeating it.

<details>
<summary>Glossary</summary>

- **Periodic note**: a note that stands for one period, such as the note for 12 April 2026 or for week 15 of 2026.
- **Granularity**: the length of a period. Calendaric knows day, week, month, quarter and year. Quarter is reserved and does nothing yet.
- **Format**: the [moment.js](https://momentjs.com/docs/#/displaying/format/) pattern that turns a date into a filename. `YYYY-MM-DD` writes `2026-04-12`.
- **Template**: a note whose text is copied into each new periodic note, with variables such as `{{date}}` filled in.
- **Vault**: the folder of notes Obsidian has open.
- **Command palette**: the Obsidian search box for commands. Open it with Cmd+P on macOS or Ctrl+P elsewhere.
- **Ribbon**: the column of icons on the far left of the Obsidian window.
- **Predecessor plugin**: one of the older plugins Calendaric replaces: the core Daily Notes plugin, Calendar, or Periodic Notes.
- **Natural Language Dates**: a separate community plugin that reads phrases such as "next friday" as dates. Calendaric's date switcher uses it.
- **Split modifier**: the key that opens a note in a new pane beside the current one. Cmd on macOS, Ctrl elsewhere.

</details>

## Contents

- [Quick start](#quick-start)
- [The calendar view](#the-calendar-view)
- [Day cells](#day-cells)
- [Week cells](#week-cells)
- [The month header and navigation](#the-month-header-and-navigation)
- [Dots and the detail view](#dots-and-the-detail-view)
- [Periodic notes by granularity](#periodic-notes-by-granularity)
- [How Calendaric finds a note](#how-calendaric-finds-a-note)
- [Templates](#templates)
- [Commands](#commands)
- [The ribbon icon](#the-ribbon-icon)
- [The period label and the day strip](#the-period-label-and-the-day-strip)
- [The date switcher](#the-date-switcher)
- [Open on startup](#open-on-startup)
- [Settings reference](#settings-reference)
- [Importing from the older plugins](#importing-from-the-older-plugins)
- [When an older plugin still manages notes](#when-an-older-plugin-still-manages-notes)
- [Messages you may see](#messages-you-may-see)

## Quick start

You need Obsidian 1.13.7 or later on a desktop computer. Calendaric does not run on mobile. You also need Node.js, because you build the plugin yourself.

1. Clone the repository: `git clone https://github.com/matisnape/obsidian-calendaric.git`.
2. In the clone, run `npm ci`. This also builds the plugin, because the install runs the build script.
3. If `main.js` is missing afterwards, run `npm run build`.
4. Create the folder `<your vault>/.obsidian/plugins/obsidian-calendaric/`. The folder name must be `obsidian-calendaric`, the plugin id.
5. Copy `main.js`, `manifest.json` and `styles.css` from the clone into that folder.
6. In Obsidian, open **Settings → Community plugins**. If community plugins are off, turn them on. Reload the list of installed plugins, then switch on **Calendaric**.
7. Open **Settings → Calendaric**. If the top of the screen shows **Daily notes plugin detected**, select **Import settings**. The card then reads **Daily notes plugin is still active**: select **Disable daily notes**, then **Disable plugin** in the dialog. Skip this step if the card is not there.
8. Find the calendar in the right sidebar. Its tab is called **Calendar**. If it is not there, run **Open calendar** from the command palette.
9. Click today's date in the grid.

**What you should see:** a dialog titled **New daily note** asks whether to create a file such as `2026-11-05.md`. Select **Create**. The note opens in the active pane, and a dot appears under today's date.

If a notice says *"Calendaric: The core Daily Notes plugin still manages daily notes, so Calendaric did not create this one."*, step 7 did not happen. Select **Use Calendaric** in the notice, then click the day again.

## The calendar view

**What it does:** shows one month as a grid of days, with an optional column of week numbers on the left.

**How to use it:**

- It opens by itself in the right sidebar when the vault loads, without taking focus.
- If you closed it, run **Open calendar** from the command palette. The palette hides this command while the calendar is already on screen.

**What you should see:**

- A header with the month and year, two arrow buttons and a **Today** button.
- A row of weekday names, starting on the day set in **Start week on**.
- Six rows of days. Days from the months before and after are shown faded.
- Today's date is shown in the accent colour.
- The cell of the note in the active pane is highlighted too, for day and week notes.
- A **W** column with week numbers, while **Show week numbers** is on.

The view redraws every minute, so "today" moves at midnight. It also redraws when a setting changes or when a note is created, deleted or renamed.

## Day cells

**What it does:** each day cell stands for that day's note.

**How to use it:**

| Action | Result |
|---|---|
| Click | Opens the day's note in the active pane. If it does not exist, Calendaric creates it first. |
| Split modifier + click | The same, in a new pane beside the current one. |
| Right-click, when the note exists | The note's file menu: **Delete**, plus the entries other plugins add to file menus. |
| Hover, with the Page preview core plugin on | A preview of the note. By default you hold the split modifier while hovering. Change this under **Settings → Page preview → Calendaric**. |
| Tab to the cell, then Enter or Space | The same as a click. |

**What you should see** when the note is missing:

- With **Confirm before creating new note** on (the default), a dialog titled **New daily note** names the day and the file, for example *"Thursday, November 5, 2026 has no daily note yet. Create 2026-11-05.md?"*.
- Select **Create** to write the note, or **Never mind** to leave the vault unchanged.
- With the setting off, the note is created at once.

Cells only react while **Daily Notes** is switched on in the settings.

## Week cells

**What it does:** each number in the **W** column stands for that row's weekly note.

**How to use it:** the same gestures as a day cell. The dialog is titled **New weekly note** and names the week, for example *"The week of November 2, 2026 has no weekly note yet. Create …?"*, where … is the file name your weekly format gives.

**What you should see:** the weekly note opens. Which week a row means, and what number it shows, depend on **Start week on** and on the weekly format. The guide explains the rules in [Which week a token reads](guide.md#which-week-a-token-reads).

Week cells only react while **Weekly Notes** is switched on and **Show week numbers** is on.

## The month header and navigation

**What it does:** moves the grid between months, and opens the month's note.

**How to use it:**

| Control | Result |
|---|---|
| Left arrow (**Previous month**) | Shows the month before. |
| Right arrow (**Next month**) | Shows the month after. |
| **Today** | Returns to the current month. It is greyed out while you already see it. |
| Click the month and year | Opens the month's note, creating it if missing. The dialog is titled **New monthly note**. While monthly notes are off, the click returns to the current month instead. |
| Right-click the month and year | The month note's file menu, when that note exists. |

**What you should see:** the grid changes month. If you leave the grid on another month, it stays there when the date changes. If it shows the current month, it moves to the new month by itself.

## Dots and the detail view

**What it does:** small marks under a date tell you whether that period has a note and how long it is.

**What you should see:**

- **Note dot**: a small grey circle. The cell's note exists.
- **Word-count dot**: a small pie of 5 wedges. More filled wedges means more words.
  - One wedge fills per **Words per dot** words, at least one and at most 5. A note with no words gets no word-count dot.
  - With the default of 250: up to 499 words fills 1 wedge, 500 fills 2, 750 fills 3, 1000 fills 4, 1250 or more fills 5.
  - Frontmatter (the `---` block at the top of a note) is not counted.

**How to use the detail view:** it shows the same facts as text, for example "Note exists" and "312 words".

- With a mouse, rest the pointer on a cell for a moment.
- With the keyboard, move focus to the cell with Tab.
- On a touch screen, tap the cell once. Tap it again, or select **Open note**, to open the note.

**Known limit:** a dot appears only for a note at the exact path the format writes. A note found by [prefix matching or frontmatter](#how-calendaric-finds-a-note) opens on click but shows no dot. Days from the neighbouring months never show dots.

## Periodic notes by granularity

**What it does:** each granularity has its own group of settings: whether it is on, the filename format, the folder and the template.

| Granularity | Settings group | On by default | Default format | Example filename | Calendar cell |
|---|---|---|---|---|---|
| Day | **Daily Notes** | yes | `YYYY-MM-DD` | `2026-04-12` | each day |
| Week | **Weekly Notes** | yes | `gggg-[W]ww` | `2026-W15` | the week number |
| Month | **Monthly Notes** | no | `YYYY-MM` | `2026-04` | the month header |
| Quarter | **Quarterly Notes** | no | `YYYY-[Q]Q` | not created | none |
| Year | **Yearly Notes** | no | `YYYY` | `2026` | none |

**How to use it:** in **Settings → Calendaric → Periodic notes**, switch a group on with the toggle on its heading. Select the heading to expand the group's fields.

**What you should see:** turning a group on or off changes the calendar and the command palette at once. No restart is needed.

**Monthly and yearly notes, today:** the settings screen cannot switch them on. Their groups, and **Quarterly Notes** and **Custom Notes**, show a toggle that stays off and greyed out. Monthly and yearly notes become active only through the [Periodic Notes import](#periodic-notes-import), or by editing the plugin's `data.json` by hand. Once active, they get their commands, the ribbon menu entry and the month header click. Their group still reads as off on the settings screen.

**Quarter is reserved.** Calendaric stores a quarter configuration so that it survives a save, but it never creates a quarterly note, offers a quarterly command, or opens one at startup.

## How Calendaric finds a note

**What it does:** decides which file is the note for a period. This is what a click, a command and the period label open.

A file is a period's note when one of these holds:

- **Its name matches the format**, and it sits in the group's **Note folder** or a subfolder of it.
- **Its name starts with the formatted date** and carries more text after it, while **Allow prefix matching** is on. With the format `gggg-[W]ww`, the file `2026-W07, 09.02 - 15.02` counts as week 7.
- **Its frontmatter names the period**, in a fixed format, and it sits in the right folder. The key is the granularity's id:

  ```yaml
  ---
  day: 2026-04-12     # or week: 2026-W15, month: 2026-04, year: 2026
  ---
  ```

**What you should see:** clicking a cell opens such a note instead of creating a second one. The [period label](#the-period-label-and-the-day-strip) shows a "≈" mark on a note found by prefix matching.

A new note is always written at the exact path the format and folder give. If **Note folder** is empty, Obsidian's own default folder for new notes is used. Missing folders are created.

## Templates

**What it does:** copies a template note into every new periodic note and fills in its variables.

**How to use it:**

1. Write a template note, for example `templates/daily.md`.
2. In the group's settings, type its path into **Daily Note Template** or **Weekly Note Template**. The `.md` ending is optional.
3. Create a note from the calendar or a command.

**What you should see:** the new note holds the template's text, with `{{date}}`, `{{title}}` and the other variables replaced. Folded headings in the template are folded in the new note too.

**Variables:** the guide lists them in [Template Variables](guide.md#template-variables). One more form works and is not in the guide yet:

| Variable | Result for the note of 12 April 2026 |
|---|---|
| `{{date+7d}}` | The date 7 days later, in the note's own format: `2026-04-19` |
| `{{date-1M:DD.MM}}` | One month earlier, in the format after the colon: `12.03` |

The units are `d` (days), `w` (weeks), `M` (months), `Q` (quarters) and `y` (years). An offset without a known unit stays in the note as you typed it, and so does any variable Calendaric does not recognise.

**Template for a file you create yourself:** when an empty file appears at a periodic note's exact path, Calendaric fills it from the template. This covers a note created by hand or by another plugin. Files that were already in the vault when Obsidian started are left alone.

**Checking the path:** the template field checks itself when you leave it.

- *"Calendaric could not find the template: … was not found in the vault."* means no note sits at that path.
- *"Calendaric cannot use the template: … is a folder, not a note."* means the path names a folder.

An empty field means no template, which is valid.

## Commands

Open the command palette and type a command's name. The guide also has a short [Commands](guide.md#commands) table.

| Command | What it does | When the palette lists it |
|---|---|---|
| **Open calendar** | Opens the calendar view and focuses it. | While the calendar is not on screen. |
| **Reveal active note** | Moves the calendar to the month of the active day or week note and highlights its cell. | Always. Without a day or week note in the active pane, it says *"Reveal active note" needs an open daily or weekly note.* |
| **Open date switcher** | Opens the [date switcher](#the-date-switcher). | While Natural Language Dates is on and a pane is active. |

Each active granularity adds these, with its own word (daily, weekly, monthly, yearly):

| Command, for daily notes | What it does | When the palette lists it |
|---|---|---|
| **Open current daily note** | Opens the note for the period that holds today, creating it when missing. | Always. |
| **Open next daily note** | Opens the note for the period after the one in the active pane, creating it when missing. | While the active pane holds a daily note. |
| **Open previous daily note** | The same, for the period before. | While the active pane holds a daily note. |
| **Jump forward to next existing daily note** | Opens the closest existing note after the active one. It never creates a note. | While the active pane holds a daily note. |
| **Jump backward to previous existing daily note** | The same, before the active one. | While the active pane holds a daily note. |

The other granularities get the same set, with the same rules:

| Granularity | Commands |
|---|---|
| Weekly | **Open current weekly note**, **Open next weekly note**, **Open previous weekly note**, **Jump forward to next existing weekly note**, **Jump backward to previous existing weekly note** |
| Monthly | **Open current monthly note**, **Open next monthly note**, **Open previous monthly note**, **Jump forward to next existing monthly note**, **Jump backward to previous existing monthly note** |
| Yearly | **Open current yearly note**, **Open next yearly note**, **Open previous yearly note**, **Jump forward to next existing yearly note**, **Jump backward to previous existing yearly note** |

Monthly and yearly commands appear only once those granularities are active. See [Periodic notes by granularity](#periodic-notes-by-granularity).

**What you should see:**

- The note opens in the active pane.
- A jump with no note in that direction says, for example, *"No next weekly note."*.
- A command creates a missing note without the **New daily note** dialog. **Confirm before creating new note** applies only to calendar clicks.

You can bind hotkeys to any of these in **Settings → Hotkeys**. A hotkey stays bound when you switch a granularity off and on again.

## The ribbon icon

**What it does:** one calendar icon in the ribbon opens the current note of the first active granularity, in the order day, week, month, year.

**How to use it:**

| Action | Result |
|---|---|
| Click | Opens the current note, creating it when missing. |
| Split modifier + click | The same, in a new pane. |
| Right-click, with 2 or more granularities active | A menu with one **Open current … note** entry per active granularity. |

**What you should see:** the tooltip names what a click opens, for example **Open current daily note**. Obsidian lists the icon as **Open current periodic note** when you hide or reorder ribbon icons.

## The period label and the day strip

**What it does:** labels every open periodic note with the period it belongs to, relative to today.

**How to use it:** switch it on or off with **Show period label** (on by default).

**What you should see:**

- A small pill in the top-right corner of the note's pane. The label is drawn on the pane, never written into the file.
- Day notes read "Today", "Yesterday" or "Tomorrow". Week, month and year notes read "This week", "Last month", "Next year" and so on.
- Further periods read like "3 months ago" or "in 2 weeks", in your locale's words.
- A "≈" mark means the filename only starts with the period's format, so the match came from prefix matching.

**The day strip:** while daily notes are on, the label is a button.

1. Click the label, or focus it and press Enter.
2. A strip of 7 days appears, for the week that holds the note's first day. The note's own day is highlighted.
3. Click a day to open its note in the active pane. A missing note is created.

## The date switcher

**What it does:** opens a note by a date written in words, such as "last monday" or "next week".

**How to use it:**

1. Install and switch on the Natural Language Dates community plugin (plugin id `nldates-obsidian`).
2. Run **Open date switcher** from the command palette.
3. Type a phrase. The box says *"Type a date, like last monday or next week"*.
4. Choose a suggestion with the arrow keys, then press Enter. Split modifier + Enter opens it in a new pane.

**What you should see:**

- With an empty box: shortcuts for **Today**, **Yesterday**, **Tomorrow**, and **This**, **Last** and **Next** week, month and year, for the granularities that are on.
- After you type: the shortcuts that match, including weekdays such as **Last Monday**. Only when no shortcut matches does the switcher offer your whole phrase, read as a date.
- A phrase with "week", "month" or "year" in it opens that granularity's note. Any other phrase opens a day note.
- Under each suggestion, the name of the note it opens.
- *"Date not recognised."* when nothing matches. *"Notes for that period are turned off."* when the date is valid but its granularity is off.
- A phrase naming a quarter offers nothing, because quarter is reserved.

## Open on startup

**What it does:** opens one periodic note every time the vault opens.

**How to use it:** in a group's settings, switch on **Open on startup**. The toggle is greyed out while the group is off.

**What you should see:**

- The group's heading shows an **Opens at startup** badge.
- Only one group can open at startup. Switching it on for one group switches it off for the others.
- On the next start, the current period's note opens in a new tab. A missing note is created without the confirmation dialog.
- If Obsidian already restored a tab with that note, that tab is brought forward instead of opening a second one.

**Known limit:** startup looks for the note only at the exact path the format writes. If your note for today is found only by prefix matching or frontmatter, startup creates a second note at the format's path.

## Settings reference

Open **Settings → Calendaric**. The screen has, from top to bottom, any [import cards](#importing-from-the-older-plugins), then the plugin-wide settings, which have no heading of their own, then **Periodic notes** and **Advanced**. This manual calls the first block [General](#general).

### General

| Setting | What it does | Default |
|---|---|---|
| **Start week on** | The first day of each calendar row and of each week. **Locale default** takes the first day from the date language. | Monday |
| **Confirm before creating new note** | Asks before a calendar click creates a note. | on |
| **Show week numbers** | Shows the **W** column of week numbers and week cells. | on |
| **Show period label** | Shows the [period label](#the-period-label-and-the-day-strip) on open periodic notes. | on |
| **Words per dot** | How many words fill one wedge of the word-count dot. Anything but a positive whole number saves 250 and says so under the field. | 250 |

### Periodic Notes, per group

Each group heading (**Daily Notes**, **Weekly Notes**) has an on/off toggle. Select the heading to show these fields:

| Setting | What it does |
|---|---|
| **Format** | The filename pattern. The line under it shows today's date in that pattern. **Syntax reference** opens the moment.js token list, and **Format & template guide** opens [the guide](guide.md#format-field). An empty field uses the default format, shown as the placeholder. |
| **Note folder** | The folder new notes go into. A folder that does not exist yet is created with the first note. |
| **Daily Note Template**, **Weekly Note Template** | The template note's path. See [Templates](#templates). |
| **Allow prefix matching** | Also counts a note whose filename starts with the date and carries more text, for example `2026-02-09, travel day`. |
| **Open on startup** | See [Open on startup](#open-on-startup). |

**Format checks:** the format field checks every keystroke.

- *"Not saved: …"* means an error. The previous format stays in use.
- *"Saved, but: …"* means a warning. The new format is saved anyway.
- *"In use, but: …"* appears when you reopen the tab and the stored format has a problem.

**Folder checks:** when you leave the field, *"Saved, but … does not exist yet. It is created with the first note."* or *"Saved, but … cannot be used as a folder."*.

### Advanced

| Setting | What it does | Default |
|---|---|---|
| **Override locale** | The language for weekday and month names and for relative labels such as "3 months ago". **Same as Obsidian** follows Obsidian's own language. | **Same as Obsidian** |

Every setting takes effect as soon as you change it. If a save fails, the notice *"Could not save settings."* appears and the screen shows the saved values again.

## Importing from the older plugins

**What it does:** copies your settings from a predecessor plugin into Calendaric, so you do not retype formats and folders.

**How to use it:** open **Settings → Calendaric**. A card at the top appears for each predecessor plugin that is on and has something to import.

**What you should see:** where Calendaric's field is empty, the import fills it without asking. Where both have different values, a dialog lists each conflict as *yours* against the other plugin's value. Tick what to replace, then select **Import selected**, or select **Keep my values** to fill only the empty fields. None of the imports changes the other plugin's own settings.

When more than one source covers a granularity, Periodic Notes wins for every granularity its active calendar set has on. The core Daily Notes plugin applies to daily notes otherwise.

### Daily Notes import

The card **Daily notes plugin detected** appears while the core Daily Notes plugin is on and you have not imported or dismissed it.

| Button | Result |
|---|---|
| **Import settings** | Copies the format, folder and template into **Daily Notes**, and switches **Daily Notes** on. An empty Daily Notes format becomes `YYYY-MM-DD`. |
| **Disable daily notes plugin** | Asks *"Turn off the core daily notes plugin?"*, then turns it off when you select **Disable plugin**. **Cancel** leaves it on. Hotkeys bound to its commands may stop working. |
| **Dismiss** | Hides the import offer for good. While the core plugin stays on, the card turns into the notice below. |

After the import, while the core plugin is still on, the card reads **Daily notes plugin is still active** with **Disable daily notes** and **Dismiss** buttons.

Import before you disable. **Disable daily notes plugin** without an import also hides the offer for good.

### Periodic Notes import

The card **Periodic notes plugin detected** appears while Periodic Notes is on and its active calendar set has a granularity on.

- It lists every change as `old → new` before you select **Import settings**.
- It copies, for each granularity the active set has on: whether it is on, the format, the folder, the template, and prefix matching.
- This is the only way to switch on monthly and yearly notes from the user interface today.
- It leaves the other calendar sets and **Open on startup** alone.
- Once nothing is left to import, the card reads **Periodic notes settings already imported**.

### Calendar plugin import

The card **Calendar plugin detected** appears while the Calendar plugin is on and holds a value Calendaric reads.

- It copies week start, confirm-before-create, show week numbers, words per dot and the locale override. These overwrite Calendaric's values without a conflict dialog.
- It also copies the weekly note format, folder and template, and switches weekly notes on when it carries at least one of them. It skips these when Periodic Notes manages weekly notes.
- A value Calendaric cannot use is listed with the reason, for example a week start that is not a weekday.
- When nothing would change, it says *"Calendaric already has every value it can import."*.

## When an older plugin still manages notes

**What it does:** stops Calendaric and a predecessor plugin from both writing the same notes.

Calendaric does not create a note for a granularity that another plugin still manages:

- the core Daily Notes plugin, while it is on, manages daily notes
- the Calendar plugin, while its weekly note option is on, manages weekly notes
- Periodic Notes manages every granularity its active calendar set has on

Opening a note that already exists always works.

**What you should see:**

- When the vault opens, a notice that stays until you close it: *"Calendaric: The core Daily Notes plugin still manages daily notes. Calendaric will not create them while it does."*.
- When you try to create such a note, a short notice: *"…still manages daily notes, so Calendaric did not create this one."*.
- Both carry a **Use Calendaric** button. It switches that granularity off in the other plugin. For the core Daily Notes plugin, that turns the whole plugin off, without the confirmation dialog.
- After the button: *"Calendaric now manages daily notes."*, or a notice saying why not.

## Messages you may see

| Message | What it means | What to do |
|---|---|---|
| *Calendaric: … still manages daily notes, so Calendaric did not create this one.* | A predecessor plugin owns that granularity. | Select **Use Calendaric**, or import first. See [above](#when-an-older-plugin-still-manages-notes). |
| *Calendaric could not create the daily note for …: …* | Writing the note failed. The reason follows the colon. | Check the folder and format fields. |
| *Calendaric could not read the template: …* | The note was created, but without the template. | Fix the template path. |
| *Could not open "…" — the file no longer exists at that path.* | The note moved or was deleted after Calendaric found it. | Click the cell again. |
| *Calendaric: the calendar view could not be opened.* | Obsidian refused to make the sidebar pane. | Restart Obsidian. |
| *Calendaric: some settings could not be read and were reset to their defaults.* | The stored settings file was damaged. The file is not overwritten until you change a setting. | Check your settings, or repair `.obsidian/plugins/obsidian-calendaric/data.json`. |
| **Daily notes settings could not be read**, **Periodic notes settings could not be read** or **Calendar plugin settings could not be read** | The other plugin's settings have a shape Calendaric does not expect, so the import cannot run. | Type the format, folder and template into Calendaric by hand. |
| *… is unavailable* on the settings screen | That part of the settings screen does not work with your Obsidian version. The rest still works. | Report it, with your Obsidian version. |
