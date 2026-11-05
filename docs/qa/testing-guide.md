# Calendaric manual testing guide

## TL;DR

This guide is a click-through test plan for the Calendaric Obsidian plugin.
You run it in a throwaway Obsidian vault, by hand, and tick pass or fail on each scenario.

- Short on time: do [Test setup](#test-setup), then [Priority scenarios](#priority-scenarios). These are the checks no automated test can settle, and they are what is left before the backlog can close.
- After every release: do the [Regression smoke test](#regression-smoke-test). It takes about 10 minutes.
- Full pass: do everything, epic by epic. Each scenario stands on its own once setup is done.
- Something broke: refer to [How to report a failure](#how-to-report-a-failure).

The scenarios come from the project's acceptance criteria in `docs/backlog/epics/*.json`.
The [coverage table](#coverage-table) at the end maps every criterion a human can check to the scenario that checks it.
What each setting and command does is described in the [user guide](../guide.md). This guide only tells you how to test it.

## How to use this guide

- Each scenario has an ID (`QA-CAL-03`), the criteria it covers, preconditions, numbered steps and an expected result for each step.
- Do the steps in order. One step is one action.
- Tick "Pass" only when every expected result in the scenario held. Otherwise tick "Fail" and write down the step number.
- Text in bold, like **Start week on**, is a literal label you see on screen. If the screen shows different words, that is a finding. Bold is used for nothing else.
- Text in quotes, like "Date not recognised.", is a message or card title to look for.
- A scenario marked `DISCREPANCY` is written to what the code does, where that differs from the criterion's text. Report what you see either way.
- Command names appear in the command palette with a `Calendaric: ` prefix. This guide leaves the prefix out. Type **Open calendar** and the palette shows `Calendaric: Open calendar`.
- "Mod" means the Cmd key on macOS and the Ctrl key on Windows and Linux.

<details>
<summary><h2>Glossary</h2></summary>

| Term | Meaning |
|---|---|
| Vault | An Obsidian folder of Markdown notes. Obsidian keeps its own config in a hidden `.obsidian/` folder inside it. |
| Periodic note | A note that belongs to a date period, like the daily note for 12 April 2026 or the weekly note for week 15. |
| Granularity | The period length a note covers: day, week, month or year. Quarter exists in the code but is reserved and switched off for this release. |
| Group | One granularity's block in the settings screen, such as **Daily Notes** or **Weekly Notes**. Each has its own toggle, **Format**, **Note Folder** and template. |
| Format | A [moment.js format string](https://momentjs.com/docs/#/displaying/format/) that decides a note's filename, such as `YYYY-MM-DD` for `2026-04-12`. |
| Week start | The day a week begins on, set by **Start week on**. It changes which days share a week row, and which Monday a weekly template means. |
| Template | A note whose content is copied into each new periodic note. |
| Template token | A placeholder inside a template, like `{{date}}` or `{{monday:DD.MM}}`. Calendaric replaces it with a real value when it creates the note. The full list is in the [user guide](../guide.md#template-variables). |
| Prefix matching | The **Allow prefix matching** setting. When on, a file named `2026-04-20, travel day.md` still counts as the 20 April daily note, because its name starts with the date. |
| Indicator / dot | The small mark under a day in the calendar. One dot means a note exists. A second, segmented dot grows with the note's word count. |
| Period label | A small label at the top of an open periodic note, like **Today** or **Last week**. Controlled by **Show period label**. |
| Day strip | The row of seven days that opens when you click the period label. |
| Date switcher | A search box opened by **Open date switcher**. You type a date in words, like "next week", and it opens that note. |
| Companion plugin | Another plugin that some scenarios need: Natural Language Dates (id `nldates-obsidian`), or Obsidian's core **Page preview**. |
| Predecessor plugin | One of the older plugins Calendaric replaces: the core Daily Notes plugin, the community Calendar plugin, the community Periodic Notes plugin. |
| Acceptance criterion (AC) | One Given/When/Then check in the backlog, such as `AC-CAL-03.5`. |
| `testable_by` | The backlog field that says how a criterion is checked: `unit`, `integration` or `manual`. This guide covers `integration` and `manual`. |
| `data.json` | Calendaric's saved settings, at `<vault>/.obsidian/plugins/obsidian-calendaric/data.json`. |

</details>

## Test setup

Do this once. Every scenario assumes it is done, unless the scenario says otherwise.
Budget about 20 minutes.

### 1. Build the plugin

1. In a checkout of this repository, run `npm install`.
2. Run `npm run build`.
3. Check that `main.js`, `manifest.json` and `styles.css` exist at the repository root.

### 2. Create a fresh test vault

1. In Obsidian, create a new empty vault named `calendaric-qa`. Never use a real vault: several scenarios delete notes.
2. Close Obsidian.

### 3. Create the seed files before the plugin is installed

Create these files inside the vault folder with any text editor.
Some must exist before Calendaric first starts, so create them now.
The dates are fixed, in April 2026, so the expected results in this guide are exact. Today's date only matters where a scenario says so.

| File | Content | Used by |
|---|---|---|
| `Templates/Daily.md` | See [Daily template](#daily-template) | every daily note |
| `Templates/Weekly.md` | See [Weekly template](#weekly-template) | every weekly note |
| `Templates/Empty.md` | nothing (a 0-byte file) | QA-TPL-02 |
| `Journal/Daily/2026-04-01.md` | nothing (a 0-byte file) | QA-NOTE-06 (must exist before first start) |
| `Journal/Daily/2026-04-06.md` | the 25-word text below | dots, jumps |
| `Journal/Daily/2026-04-08.md` | `Short note.` | dots, jumps |
| `Journal/Daily/2026-04-15.md` | `Mid-month note.` | jumps |
| `Journal/Daily/2026-04-20, travel day.md` | `Prefix-named note.` | prefix matching |
| `Journal/Weekly/2026-W15.md` | `Week fifteen.` | week cells |
| `Journal/Weekly/2025-W46, 10.11 - 16.11.md` | `Pretty-named week.` | QA-NOTE-03 |
| `Notes/2026-04-10.md` | `Not a daily note: wrong folder.` | QA-NOTE-05 |
| `Notes/Meeting.md` | `A plain note.` | period label checks |

The 25-word text for `2026-04-06.md`:

```text
one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive
```

#### Daily template

`Templates/Daily.md`:

```markdown
# {{date:dddd, D MMMM YYYY}}
Title: {{title}}
Created at: {{time}}
Yesterday: {{yesterday}} / Tomorrow: {{tomorrow}}
Unknown token: {{mystery}}
```

#### Weekly template

`Templates/Weekly.md`:

```markdown
# Week {{title}}
Monday: {{monday:YYYY-MM-DD}}
Sunday: {{sunday:YYYY-MM-DD}}
```

### 4. Install the plugin

1. Create the folder `<vault>/.obsidian/plugins/obsidian-calendaric/`.
2. Copy `main.js`, `manifest.json` and `styles.css` from the build into it.
3. Open the vault in Obsidian.
4. Open **Settings → Community plugins**. If Obsidian asks, select **Turn on community plugins**.
5. Under **Installed plugins**, switch **Calendaric** on.
6. Expected: a calendar view appears in the right sidebar, with a pane title of **Calendar**.

### 5. Configure Calendaric

Open **Settings → Calendaric**.

1. Under **Periodic Notes**, select the **Daily Notes** heading to expand it.
2. Set **Note Folder** to `Journal/Daily`.
3. Set **Daily Note Template** to `Templates/Daily`.
4. Expand **Weekly Notes**. Set **Note Folder** to `Journal/Weekly`.
5. Set **Weekly Note Template** to `Templates/Weekly`.
6. Leave every other setting at its default. In particular **Confirm before creating new note** stays on, so every new note asks first, and **Start week on** stays **Monday**.

Saving the first change is what creates `data.json`. Check that the file now exists.

### 6. Check the core plugins

1. Open **Settings → Core plugins**.
2. Check that **Page preview** is on. QA-P-02 and QA-P-03 need it.
3. Check that **Daily notes** is off. The migration scenarios switch it on themselves.

### Companion and predecessor plugins

Install these only when a scenario asks. Install them from **Settings → Community plugins → Browse**.

| Plugin | Needed by | Notes |
|---|---|---|
| Natural Language Dates (`nldates-obsidian`) | QA-P-05, QA-CMD-10 | The date switcher only exists while it is enabled. |
| Calendar (by Liam Cain) | QA-MIG-03 | Disable it again after the scenario. |
| Periodic Notes (by Liam Cain) | QA-MIG-04, QA-MIG-05 | Disable it again after the scenario. |
| Core **Daily notes** | QA-MIG-01, QA-MIG-02 | A core plugin, under **Settings → Core plugins**. |

While a predecessor plugin is enabled, Calendaric refuses to create notes for the granularity that plugin also manages. That is the feature tested in QA-MIG-06. Disable predecessors after their scenario, or later scenarios fail for the wrong reason.

### Switch on monthly, yearly or quarter notes by hand

The settings screen shows **Monthly Notes**, **Yearly Notes** and **Quarterly Notes** with a disabled toggle. In this release they can only be switched on by a Periodic Notes import or by editing `data.json`. Some scenarios need that:

1. Open **Settings → Community plugins** and switch **Calendaric** off.
2. Open `data.json` in a text editor.
3. Find `calendarSets`, then its first entry, then `month` (or `year`, or `quarter`).
4. Set `"enabled": true` there. Save the file.
5. Switch **Calendaric** on again.

Undo it the same way when the scenario ends.

### Reset between scenarios

Most scenarios create notes. Delete what a scenario created when it says "Clean up". If the vault gets into a confusing state, close Obsidian, delete the vault, and redo setup. It takes about 10 minutes once the seed files are scripted.

## Priority scenarios

These checks need a real Obsidian window: a hotkey, a hover preview, a live week-start setting, a companion plugin. No automated test in the repository can settle them.
Their criteria are still `unverified` in the backlog, and their results decide whether the remaining stories can close.

### QA-P-01 A hotkey on a granularity command follows the granularity off and on

- Covers: AC-CMD-05.4, AC-CMD-05.2, AC-CMD-05.3
- Preconditions: setup done. **Daily Notes** and **Weekly Notes** are on.

| # | Action | Expected result |
|---|---|---|
| 1 | Open **Settings → Hotkeys**. Search for `Open current daily note`. | One entry, **Calendaric: Open current daily note**. |
| 2 | Bind it to an unused key, for example Mod+Shift+8. | The binding shows next to the command. |
| 3 | Close settings. Press Mod+Shift+8. | Today's daily note opens, or the **New daily note** dialog asks to create it. Select **Never mind** if it asks. |
| 4 | Open **Settings → Calendaric**. Switch the **Daily Notes** heading toggle off. Close settings. | No restart. The ribbon icon's tooltip now reads **Open current weekly note**. |
| 5 | Open the command palette and type `daily note`. | No Calendaric command with "daily" in its name is listed. |
| 6 | Press Mod+Shift+8. | Nothing happens. No note opens, no dialog, no error notice. |
| 7 | Open `<vault>/.obsidian/hotkeys.json` in a text editor. | It still has an entry for `obsidian-calendaric:day-open-current`. The binding was not deleted. |
| 8 | Switch the **Daily Notes** toggle back on. Close settings. | No restart. |
| 9 | Press Mod+Shift+8. | Today's daily note opens again, or the **New daily note** dialog asks. |
| 10 | Open **Settings → Hotkeys** and search `Open current daily note`. | The Mod+Shift+8 binding is still shown. |

Clean up: remove the hotkey.

- [ ] Pass
- [ ] Fail

### QA-P-02 Hover preview of a day that has a note

- Covers: AC-CAL-03.5, AC-CAL-04.4
- Preconditions: setup done. Core **Page preview** is on. The calendar shows April 2026: use **Previous month** or **Next month** to get there.

| # | Action | Expected result |
|---|---|---|
| 1 | Open **Settings → Core plugins → Page preview** options (the gear icon). | **Calendaric** is listed as a hover source, with "require Mod" on by default. |
| 2 | Close settings. Rest the pointer on the cell for 6 April, without holding any key. | No note preview appears. A small detail box with **Note exists** and **25 words** may appear: that is the indicator detail, not the preview. |
| 3 | Hold Mod and rest the pointer on the 6 April cell. | Obsidian's own preview popover appears near the cell. It shows the 25-word text of `2026-04-06`. |
| 4 | Look at the calendar and the open tabs. | The grid still shows April 2026. No note was opened. |
| 5 | Hold Mod and rest the pointer on the week-number cell (the **W** column) of the row holding 6 April. | The preview shows `Week fifteen.`, the content of `2026-W15`. The grid does not move. |

- [ ] Pass
- [ ] Fail

### QA-P-03 Hover preview of a day with no note creates nothing

- Covers: AC-CAL-03.7, AC-CAL-04.5
- Preconditions: as QA-P-02. No note exists for 7 April 2026 or for the week of 13 April 2026.

| # | Action | Expected result |
|---|---|---|
| 1 | Hold Mod and rest the pointer on the 7 April cell. | A preview popover appears. It says the note does not exist yet. The exact wording comes from Obsidian, not Calendaric. |
| 2 | Move the pointer away. Open the file explorer and look inside `Journal/Daily`. | There is no `2026-04-07.md`. |
| 3 | Hold Mod and rest the pointer on the **W** cell of the row starting 13 April. | A preview popover says the note does not exist yet. |
| 4 | Look inside `Journal/Weekly`. | There is no `2026-W16.md`. |

- [ ] Pass
- [ ] Fail

### QA-P-04 Weekly template tokens follow a Sunday week start

- Covers: AC-TPL-03.2, AC-FMT-03.3
- Preconditions: setup done. No weekly note exists for the week of 12 April 2026.

| # | Action | Expected result |
|---|---|---|
| 1 | Open **Settings → Calendaric**. Set **Start week on** to **Sunday**. Close settings. | The calendar header now starts with Sunday. Rows run Sunday to Saturday. No reload was needed. |
| 2 | Go to April 2026 in the calendar. | One row runs Sun 12 to Sat 18 April. |
| 3 | Select the **W** cell of that row. | The **New weekly note** dialog appears and names the week of 12 April 2026. |
| 4 | Select **Create**. | A weekly note opens. |
| 5 | Read the note body. | `Monday: 2026-04-13` and `Sunday: 2026-04-12`. Monday is the day after the Sunday that starts the week. It is not `2026-04-06`, which is the Monday of a Monday-start grouping. |

Clean up: delete the new weekly note. Set **Start week on** back to **Monday**.

- [ ] Pass
- [ ] Fail

### QA-P-05 Date switcher with Natural Language Dates

- Covers: AC-CMD-10.1, AC-CMD-10.2, AC-CMD-10.3, AC-CMD-10.4, AC-CMD-10.5, AC-CMD-10.7
- Preconditions: setup done. Install and enable Natural Language Dates. Open any note in the main area, for example `Notes/Meeting`. Turn **Confirm before creating new note** off for this scenario, so creation does not stop at a dialog.

| # | Action | Expected result |
|---|---|---|
| 1 | Open the command palette and type `date switcher`. | **Open date switcher** is listed. |
| 2 | Run it. | A search box opens. Placeholder: "Type a date, like last monday or next week". With nothing typed it lists **Today**, **Yesterday**, **Tomorrow**, **This week**, **Last week**, **Next week**. Each row shows the note's filename under it. |
| 3 | Type `blorp` and press Enter. | The list says **Date not recognised.** The box stays open. Nothing opens. No file is created. |
| 4 | Clear the box, type `next month`, and look at the list. | The list says **Notes for that period are turned off.** Monthly notes are off by default. |
| 5 | Clear the box, type `today`, press Enter. | Today's daily note opens in the active pane, created from the daily template if it did not exist. |
| 6 | Open the switcher again. Type `next week`, press Enter. | Next week's weekly note opens, created if needed, with the weekly template applied. |
| 7 | Open the switcher. Type `last monday`, press Enter. | Last Monday's daily note opens. |
| 8 | Open the switcher. Type `last monday` again, press Enter. | The same note opens. `Journal/Daily` holds one file for that day, not two. |
| 9 | Open the switcher. Type `in 3 weeks`, press Enter. | The weekly note for the week three weeks from now opens. |
| 10 | Open the switcher. Type `today`, press Mod+Enter. | Today's note opens in a new split pane beside the current one. Only one new split. |
| 11 | Open **Settings → Community plugins**. Switch Natural Language Dates off. Do not reload. | — |
| 12 | Open the command palette and type `date switcher`. | **Open date switcher** is not listed. No error notice. **Open calendar** and the other Calendaric commands are still there. |
| 13 | Switch Natural Language Dates on again. Do not reload. | — |
| 14 | Open the command palette and type `date switcher`. | **Open date switcher** is listed again. |

Clean up: delete the notes this scenario created. Turn **Confirm before creating new note** back on.

- [ ] Pass
- [ ] Fail

### QA-P-06 Date switcher with no active pane (exploratory)

- Covers: none. AC-CMD-10.6 is in the [appendix](#not-testable-by-clicking), because no click path is known to reach the state it describes.
- `DISCREPANCY`: the release checklist says "no command with no pane open". The code hides the command only when Obsidian reports no active view at all. Closing every tab still leaves Obsidian's empty "New tab" pane, which is expected to count as an active view.
- Preconditions: as QA-P-05, with Natural Language Dates enabled.

| # | Action | Expected result |
|---|---|---|
| 1 | Close every tab in the main area. | Obsidian shows an empty new tab. |
| 2 | Open the command palette and type `date switcher`. | Expected from the code: **Open date switcher** is still listed. Record what you see. Either result is information, not a failure. |

- [ ] Recorded

## Feature scenarios

One section per epic. Each scenario names the criteria it covers.
Run them in any order once setup is done.

### NOTE: finding, creating and opening periodic notes

#### QA-NOTE-01 Creating a note builds missing folders and applies the template

- Covers: AC-NOTE-03.1, AC-NOTE-03.5, AC-NOTE-04.1, AC-NOTE-04.4, AC-NOTE-07.1, AC-NOTE-07.3, AC-NOTE-07.4, AC-NOTE-05.4
- Preconditions: setup done.

| # | Action | Expected result |
|---|---|---|
| 1 | In **Daily Notes**, set **Note Folder** to `QA/Deep/Daily`. Leave the field. | The field says the folder does not exist yet and is created with the first note. |
| 2 | In the calendar, go to April 2026. Select the 9 April cell. | The **New daily note** dialog appears. It names Thursday, April 9, 2026 and the file `2026-04-09.md`. |
| 3 | Select **Never mind**. | Nothing opens. The file explorer shows no `QA` folder. |
| 4 | Select the 9 April cell again, then **Create**. | The note opens. The folders `QA`, `QA/Deep` and `QA/Deep/Daily` now exist. |
| 5 | Read the note body. | The daily template, filled in: `# Thursday, 9 April 2026`, `Title: 2026-04-09`, a time, `Yesterday: 2026-04-08 / Tomorrow: 2026-04-10`, and `Unknown token: {{mystery}}` left as written. |
| 6 | Turn **Confirm before creating new note** off. Select the 10 April cell. | The note is created and opens at once, with no dialog. |
| 7 | (Fold state, AC-NOTE-05.4.) Open `Templates/Daily`, fold the `# …` heading, close it. Create the 11 April note. | The new note opens with that heading folded. |

Clean up: delete `QA/`. Set **Note Folder** back to `Journal/Daily`. Turn **Confirm before creating new note** back on.

- [ ] Pass
- [ ] Fail

#### QA-NOTE-02 Opening an existing note never duplicates it

- Covers: AC-NOTE-07.2, AC-NOTE-06.1, AC-NOTE-06.2
- Preconditions: setup done. Calendar on April 2026.

| # | Action | Expected result |
|---|---|---|
| 1 | Open `Notes/Meeting`. Then select the 6 April cell. | `2026-04-06` replaces `Notes/Meeting` in the same tab. No new tab opens. No dialog. |
| 2 | Read the note. | It still has only the 25-word text. No template was added. |
| 3 | Hold Mod and select the 8 April cell. | `2026-04-08` opens in a new split beside the current pane. |
| 4 | Look at `Journal/Daily`. | Still one `2026-04-06.md` and one `2026-04-08.md`. |

- [ ] Pass
- [ ] Fail

#### QA-NOTE-03 A pretty-named weekly note is found by prefix

- Covers: AC-NOTE-07.6, AC-FMT-04.6
- Preconditions: setup done.

| # | Action | Expected result |
|---|---|---|
| 1 | In **Weekly Notes**, turn **Allow prefix matching** on. | — |
| 2 | In the calendar, go to November 2025. Look at the row 10 to 16 November. | Its **W** cell shows 46 and carries a dot. |
| 3 | Select that **W** cell. | `2025-W46, 10.11 - 16.11` opens. No dialog. |
| 4 | Look at `Journal/Weekly`. | There is no `2025-W46.md`. |

Clean up: turn **Allow prefix matching** off.

- [ ] Pass
- [ ] Fail

#### QA-NOTE-04 A failed create says so and leaves no broken pane

- Covers: AC-NOTE-07.5, AC-NOTE-04.6
- Preconditions: setup done. Calendar on April 2026.

| # | Action | Expected result |
|---|---|---|
| 1 | In the file explorer, create a folder named `2026-04-21.md` inside `Journal/Daily`. | A folder whose name ends in `.md`. |
| 2 | Turn **Confirm before creating new note** off. Select the 21 April cell. | A notice says Calendaric could not create the daily note for that day, and names the path as not a Markdown note. |
| 3 | Look at the tabs. | No empty or broken tab opened. The folder is untouched. |

Clean up: delete the folder. Turn **Confirm before creating new note** back on.

- [ ] Pass
- [ ] Fail

#### QA-NOTE-05 The index follows files as they change

- Covers: AC-NOTE-11.1, AC-NOTE-11.2, AC-NOTE-11.3, AC-NOTE-11.5, AC-NOTE-11.7, AC-NOTE-08.4
- Preconditions: setup done. Calendar on April 2026.

| # | Action | Expected result |
|---|---|---|
| 1 | Look at the April grid. | Dots on 6, 8 and 15 April (seed files found at start). No dot on 10 April: `Notes/2026-04-10` is outside the daily folder. No dot on 1 April. |
| 2 | In the file explorer, create `Journal/Daily/2026-04-23.md` with the text `New.` | A dot appears on 23 April without reopening the view. |
| 3 | Rename `2026-04-23.md` to `2026-04-24.md`. | The dot moves from 23 to 24 April. |
| 4 | Turn **Allow prefix matching** on in **Daily Notes**. | A dot appears on 20 April (`2026-04-20, travel day`). |
| 5 | Turn it off again. | The 20 April dot disappears. |
| 6 | Delete `2026-04-24.md`. | The 24 April dot disappears. |

- [ ] Pass
- [ ] Fail

#### QA-NOTE-06 Template on files that arrive empty

- Covers: AC-NOTE-10.1, AC-NOTE-10.2, AC-NOTE-10.3
- Preconditions: setup done. `Journal/Daily/2026-04-01.md` was created empty before Calendaric first started.

| # | Action | Expected result |
|---|---|---|
| 1 | Open `Journal/Daily/2026-04-01`. | Still empty. The template was not applied to a file that existed before the first start. |
| 2 | In the file explorer, create a new empty file `Journal/Daily/2026-04-25.md`. Open it. | It now holds the daily template, filled in for 25 April. |
| 3 | Outside Obsidian, write `Already here.` into a new file `Journal/Daily/2026-04-26.md`. Return to Obsidian and open it. | It still says only `Already here.` |

Clean up: delete `2026-04-25.md` and `2026-04-26.md`.

- [ ] Pass
- [ ] Fail

#### QA-NOTE-07 Startup opens a note in a new tab

- Covers: AC-NOTE-06.3
- Preconditions: setup done. See QA-CMD-09 for the full startup scenario; this step only checks where the note opens.

| # | Action | Expected result |
|---|---|---|
| 1 | Turn **Open on startup** on in **Daily Notes**. Open `Notes/Meeting`. Quit Obsidian and open the vault again. | Today's daily note opens in its own new tab. The restored `Notes/Meeting` tab is still there. |

Clean up: turn **Open on startup** off.

- [ ] Pass
- [ ] Fail

### FMT: date formats, week start and locale

#### QA-FMT-01 Week start and locale apply live

- Covers: AC-FMT-03.3, AC-CAL-01.4
- Preconditions: setup done. A periodic note is open with its period label showing.

| # | Action | Expected result |
|---|---|---|
| 1 | Set **Start week on** to **Saturday**. | The calendar's weekday header starts on Saturday at once. |
| 2 | Check the **W** column. | Each row shows a week number. Open that row's weekly note from the **W** cell: its filename's week number matches the cell. |
| 3 | Set **Override locale** to `de`. | Weekday and month names in the calendar switch to German at once. |
| 4 | Set **Override locale** back to **Same as Obsidian** and **Start week on** to **Monday**. | Names and order return to normal without a reload. |

- [ ] Pass
- [ ] Fail

#### QA-FMT-02 Names that do not match the format are not notes

- Covers: AC-FMT-04.7
- Preconditions: setup done. **Allow prefix matching** off.

| # | Action | Expected result |
|---|---|---|
| 1 | Create `Journal/Daily/2026-04–27.md`. The character between `04` and `27` is an en dash (–), not a hyphen. | No dot appears on 27 April. |
| 2 | Select the 27 April cell. | The **New daily note** dialog offers to create `2026-04-27.md`. Select **Never mind**. |

Clean up: delete the en-dash file.

- [ ] Pass
- [ ] Fail

The [user guide's format section](../guide.md#format-field) has more format examples to try. Their exact outputs are covered by unit tests.

### TPL: templates

#### QA-TPL-01 Template path feedback

- Covers: AC-TPL-04.1, AC-TPL-04.2, AC-TPL-04.3, AC-TPL-04.4, AC-SET-04.3
- Preconditions: setup done.

| # | Action | Expected result |
|---|---|---|
| 1 | In **Daily Notes**, look at **Daily Note Template** (`Templates/Daily`). | No message under the field. |
| 2 | Change it to `Templates/Nope` and leave the field. | Message: "Calendaric could not find the template: Templates/Nope was not found in the vault." The field is marked invalid. |
| 3 | Change it to `Templates` and leave the field. | Message: "Calendaric cannot use the template: Templates is a folder, not a note." |
| 4 | Clear the field and leave it. | No message. |
| 5 | Set it back to `Templates/Daily`. | No message. |

- [ ] Pass
- [ ] Fail

#### QA-TPL-02 An empty template gives an empty note

- Covers: AC-TPL-04.5
- Preconditions: setup done.

| # | Action | Expected result |
|---|---|---|
| 1 | Set **Daily Note Template** to `Templates/Empty`. | No message. |
| 2 | Create the 13 April daily note from the calendar. | The note is created and empty. No error notice. |

Clean up: delete the note, set the template back to `Templates/Daily`.

- [ ] Pass
- [ ] Fail

#### QA-TPL-03 The template is applied once, and never again

- Covers: AC-TPL-05.1, AC-TPL-05.2, AC-TPL-05.3, AC-TPL-06.4
- Preconditions: setup done.

| # | Action | Expected result |
|---|---|---|
| 1 | Create the 14 April daily note. Edit its body to `Edited by hand.` | — |
| 2 | Close and reopen the note. Switch months in the calendar and back. | The body is still `Edited by hand.` No template text came back. |
| 3 | Rename the note in the file explorer to `2026-04-14, renamed.md`. Turn **Allow prefix matching** on. | The 14 April dot stays. Selecting the cell opens the renamed file. Its name is not changed back and its body is unchanged. |
| 4 | (Optional, needs the Templater plugin.) Put a Templater command such as `<% tp.date.now() %>` in `Templates/Daily`, then create a note. | Templater sees the text with Calendaric's tokens already filled in. No raw `{{date}}` reaches it. |

Clean up: delete the note. Turn **Allow prefix matching** off. Restore `Templates/Daily`.

- [ ] Pass
- [ ] Fail

QA-P-04 covers the Sunday week start for weekly tokens (AC-TPL-03.2).

### CAL: the calendar view

#### QA-CAL-01 Month navigation and the Today control

- Covers: AC-CAL-02.1, AC-CAL-02.2, AC-CAL-02.3, AC-CAL-02.4, AC-CAL-02.5
- Preconditions: setup done. The calendar shows the current month.

| # | Action | Expected result |
|---|---|---|
| 1 | Look at the **Today** control. | It looks inactive. Selecting it changes nothing. |
| 2 | Select **Next month**. | The following month shows. **Today** is now active. |
| 3 | Select **Previous month** twice. | The month before the current one shows. |
| 4 | Select **Today**. | The current month shows, with today's cell marked. |
| 5 | Go to December 2026 and select **Next month**. | January 2027 shows. |

- [ ] Pass
- [ ] Fail

#### QA-CAL-02 Click a day: open, create, confirm, split, adjacent month

- Covers: AC-CAL-03.1, AC-CAL-03.2, AC-CAL-03.3, AC-CAL-03.4, AC-CAL-03.6
- Preconditions: setup done. Calendar on April 2026.

| # | Action | Expected result |
|---|---|---|
| 1 | Select the 6 April cell. | `2026-04-06` opens in the active pane. |
| 2 | Select the 16 April cell. | The **New daily note** dialog names Thursday, April 16, 2026. |
| 3 | Select **Never mind**. | No file. The grid is unchanged. |
| 4 | Select 16 April again, then **Create**. | The note is created and opens in the active pane. |
| 5 | Hold Mod and select 17 April, then **Create**. | The new note opens in a split, not the active pane. |
| 6 | Select a greyed leading day from March in the first row, then **Create**. | That March note is created and opens. The grid still shows April. |
| 7 | Turn **Confirm before creating new note** off and select 22 April. | Created and opened with no dialog. |

Clean up: delete the created notes. Turn **Confirm before creating new note** back on.

- [ ] Pass
- [ ] Fail

#### QA-CAL-03 Click a week number

- Covers: AC-CAL-04.1, AC-CAL-04.2, AC-CAL-04.3
- Preconditions: setup done. Calendar on April 2026.

| # | Action | Expected result |
|---|---|---|
| 1 | Select the **W** cell of the row 6 to 12 April. | `2026-W15` opens. |
| 2 | Select the **W** cell of the row 20 to 26 April. | The **New weekly note** dialog appears. Select **Create**: `2026-W17` opens, with the weekly template. |
| 3 | Hold Mod and select the **W** cell of the row 27 April to 3 May, then **Create**. | `2026-W18` opens in a split. |

Clean up: delete `2026-W17` and `2026-W18`.

- [ ] Pass
- [ ] Fail

#### QA-CAL-04 The month header

- Covers: AC-CAL-05.1, AC-CAL-05.2, AC-CAL-05.3, AC-CAL-05.4, AC-CAL-05.5
- Preconditions: setup done. Monthly notes off (the default).

| # | Action | Expected result |
|---|---|---|
| 1 | Go to April 2026. Select the month header (the "Apr 2026" title). | The grid returns to the current month, like **Today**. |
| 2 | Switch monthly notes on by hand (refer to [Switch on monthly notes](#switch-on-monthly-yearly-or-quarter-notes-by-hand)). Go to April 2026. | — |
| 3 | Select the month header, then **Create** in the **New monthly note** dialog. | `2026-04` opens. The grid still shows April 2026. |
| 4 | Hold Mod and select the header of May 2026, then **Create**. | `2026-05` opens in a split. |
| 5 | Go to April 2026. Right-click the month header. | The file menu for `2026-04` appears at the pointer. |
| 6 | Inspect the header with **View → Toggle developer tools**. | The header element has the class `calendaric-month-header` and the label "Open this month's note". |

Clean up: delete both monthly notes. Switch monthly notes off again.

- [ ] Pass
- [ ] Fail

#### QA-CAL-05 Right-click a cell

- Covers: AC-CAL-06.1, AC-CAL-06.2, AC-CAL-06.3, AC-CAL-06.4, AC-NOTE-11.7
- Preconditions: setup done. Calendar on April 2026. Create the 28 April note first.

| # | Action | Expected result |
|---|---|---|
| 1 | Right-click the 9 April cell (no note). | No menu. |
| 2 | Right-click the 28 April cell. | A file menu appears at the pointer, with a **Delete** item and Obsidian's own file items such as "Open in new tab". |
| 3 | Right-click the **W** cell of the row 6 to 12 April. | The file menu for `2026-W15` appears. Close it. |
| 4 | Right-click 28 April again and choose **Delete**. Confirm if Obsidian asks. | The file is gone. The 28 April dot disappears. |

- [ ] Pass
- [ ] Fail

#### QA-CAL-06 Indicator dots and their detail

- Covers: AC-CAL-08.1, AC-CAL-08.2, AC-CAL-08.3, AC-CAL-08.4, AC-CAL-08.5, AC-CAL-09.4, AC-SET-02.4
- Preconditions: setup done. Calendar on April 2026.

| # | Action | Expected result |
|---|---|---|
| 1 | Look at **Words per dot** in settings. | It shows `250`. |
| 2 | Set **Words per dot** to `10`. | The 6 April cell's word-count dot fills more segments at once. No reload. |
| 3 | Rest the pointer on the 6 April cell, no key held. | A detail box appears listing **Note exists** and **25 words**, with an **Open note** button. |
| 4 | Move the pointer off the cell and away from the box. | The box closes within about a quarter of a second. |
| 5 | Rest the pointer on 9 April (no note). | No detail box. |
| 6 | Select the calendar, then press Tab until 6 April has focus. | The same detail box appears, without the mouse. |
| 7 | On a touchscreen laptop only: tap the 6 April cell. | The same detail appears. Skip on other machines and say so. |

Clean up: set **Words per dot** back to `250`.

- [ ] Pass
- [ ] Fail

#### QA-CAL-07 The grid stays in sync with the vault and settings

- Covers: AC-CAL-09.1, AC-CAL-09.2, AC-CAL-09.3, AC-CAL-09.5, AC-SET-07.1, AC-SET-07.2
- Preconditions: setup done. Calendar on April 2026.

| # | Action | Expected result |
|---|---|---|
| 1 | Outside Obsidian, create `Journal/Daily/2026-04-29.md` with text. | A dot appears on 29 April without touching the view. |
| 2 | In Obsidian, rename it to `2026-04-30.md`. | The dot moves to 30 April. |
| 3 | Delete it. | The dot disappears. |
| 4 | Change **Daily Notes → Note Folder** to `Elsewhere`. | Every daily dot disappears. The grid redrew. |
| 5 | Create the 9 April note from the calendar. | It is created under `Elsewhere/`, not `Journal/Daily`. |
| 6 | Set **Note Folder** back to `Journal/Daily`. | The seed dots come back. |

Clean up: delete `Elsewhere/`.

- [ ] Pass
- [ ] Fail

#### QA-CAL-08 The active note is highlighted and revealed

- Covers: AC-CAL-10.1, AC-CAL-10.2, AC-CAL-10.3, AC-CAL-10.4, AC-CMD-03.1, AC-CMD-03.2, AC-CMD-03.3
- Preconditions: setup done. Calendar on the current month.

| # | Action | Expected result |
|---|---|---|
| 1 | Open `Journal/Daily/2026-04-06` from the file explorer. | — |
| 2 | Run **Reveal active note**. | The calendar moves to April 2026 and highlights 6 April. |
| 3 | Open `2026-04-08`. | The highlight moves to 8 April. The month stays. |
| 4 | Run **Reveal active note**. | Still April. 8 April stays highlighted. |
| 5 | Open `Notes/Meeting`. | No cell is highlighted. |
| 6 | Open the command palette and type `Reveal active note`. | It is listed and can be run. |
| 7 | Run it. | Notice: "Reveal active note" needs an open daily or weekly note. The month does not change. |

- [ ] Pass
- [ ] Fail

#### QA-CAL-09 Overlays stay on screen and close cleanly

- Covers: AC-CAL-12.1, AC-CAL-12.2, AC-CAL-12.3, AC-CAL-12.4, AC-CAL-12.5
- Preconditions: setup done. Calendar on April 2026. Make the sidebar narrow and place it at the window's right edge.

| # | Action | Expected result |
|---|---|---|
| 1 | Rest the pointer on the 6 April cell, so the detail box opens near the window edge. | The box is fully visible, not cut off. |
| 2 | With the box open, scroll the sidebar. | The box follows the cell or closes. It never floats detached. |
| 3 | Open the box again, then click outside it. | It closes. |
| 4 | Open the box, then change **Words per dot** in settings so the grid redraws. | The box closes. |
| 5 | Open the date switcher (needs Natural Language Dates) and press the down arrow a few times. | The highlight moves through the list. The list stays open. |

- [ ] Pass
- [ ] Fail

#### QA-CAL-10 Period label and day strip

- Covers: AC-CAL-13.1, AC-CAL-13.2, AC-CAL-13.3, AC-CAL-13.4, AC-CAL-13.5, AC-CAL-13.6, AC-CAL-14.1, AC-CAL-14.2, AC-CAL-14.3
- Preconditions: setup done. **Show period label** on (the default).

| # | Action | Expected result |
|---|---|---|
| 1 | Open today's daily note (run **Open current daily note**, create it if asked). | A label at the top says **Today**. |
| 2 | Open `2026-04-06`. | The label names that day relative to today, such as "7 months ago". It follows the note's date, not today. |
| 3 | Open `Notes/Meeting`. | No label. The note text is unchanged. |
| 4 | Turn **Allow prefix matching** on in **Daily Notes**. Open `2026-04-20, travel day`. | The label shows a `≈` marker. Its tooltip says the match is inexact. `2026-04-06` shows no marker. |
| 5 | With `2026-04-06` open, turn **Show period label** off. | The label disappears from the open note without reopening it. |
| 6 | Turn it back on. | The label returns in the open note. |
| 7 | Select the label on `2026-04-06`. | A strip of seven days, Monday 6 to Sunday 12 April, appears. 6 April is marked. |
| 8 | Select 8 April in the strip. | `2026-04-08` opens in the active pane. No new file. |
| 9 | Open the strip again and select 9 April. Select **Create** if asked. | `2026-04-09` is created with the daily template and opens. |
| 10 | Open `2026-W15` and select its label. | The strip shows that week's seven days. |
| 11 | Open `2026-04-06` and `2026-04-08` in two split panes, then close one pane. | The remaining pane still shows its own label. |

Clean up: delete `2026-04-09`. Turn **Allow prefix matching** off.

- [ ] Pass
- [ ] Fail

### SET: the settings screen

#### QA-SET-01 Fresh install defaults and layout

- Covers: AC-SET-01.5, AC-SET-02.1, AC-SET-02.3, AC-SET-02.4
- Preconditions: a second fresh vault with only the plugin installed and enabled, never configured.

| # | Action | Expected result |
|---|---|---|
| 1 | Open **Settings → Calendaric**. | No prompt to name or choose a configuration group. |
| 2 | Look at the layout. | A **General** section (**Start week on**, **Confirm before creating new note**, **Show week numbers**, **Show period label**, **Words per dot**), a **Periodic Notes** section with one group per granularity, and an **Advanced** section with **Override locale**. The plugin-wide settings sit apart from the groups. |
| 3 | Check the values. | **Start week on**: **Monday**. **Confirm before creating new note**: on. **Show week numbers**: on. **Show period label**: on. **Words per dot**: `250`. **Override locale**: **Same as Obsidian**. **Daily Notes** and **Weekly Notes** on. Expand **Daily Notes**: **Format** is empty and shows `YYYY-MM-DD` as its placeholder, and "Your current syntax looks like this:" shows today's date. |

- [ ] Pass
- [ ] Fail

#### QA-SET-02 Field feedback

- Covers: AC-SET-02.5, AC-SET-04.1, AC-SET-04.2, AC-SET-04.4, AC-SET-04.5, AC-ARCH-08.3
- Preconditions: setup done.

| # | Action | Expected result |
|---|---|---|
| 1 | Type `0` into **Words per dot** and leave the field. | Message: "Not a positive whole number, so the default of 250 is used." |
| 2 | Repeat with `-3`, then `abc`. | The same message each time. |
| 3 | In **Daily Notes**, type `[` into **Format**. | A message starting "Not saved:" appears and the field is marked invalid. |
| 4 | Restore **Format** to empty (the default). Set **Note Folder** to `Not/Yet` and leave it. | "Saved, but Not/Yet does not exist yet. It is created with the first note." |
| 5 | Close settings and reopen them. Expand **Daily Notes**. | **Note Folder** still says `Not/Yet`, with the same warning. |
| 6 | Select **Format & template guide** under **Format**. | The guide opens in the browser. No error. |
| 7 | Select **Syntax reference**. | The moment.js format page opens. |

Clean up: set **Note Folder** back to `Journal/Daily` and **Words per dot** to `250`.

- [ ] Pass
- [ ] Fail

#### QA-SET-03 Only one granularity opens at startup

- Covers: AC-SET-05.1, AC-SET-05.4, AC-CMD-09.6
- Preconditions: setup done.

| # | Action | Expected result |
|---|---|---|
| 1 | In **Daily Notes**, turn **Open on startup** on. | The **Daily Notes** heading shows a **Opens at startup** badge. |
| 2 | In **Weekly Notes**, turn **Open on startup** on. | **Daily Notes** switches off by itself, at once. Only **Weekly Notes** has the badge. |
| 3 | Switch the **Weekly Notes** heading toggle off. | Its **Open on startup** toggle can no longer be changed. |
| 4 | Look at **Quarterly Notes**. | Its toggle is disabled. It has no **Open on startup** option. |
| 5 | Close Obsidian. In `data.json`, set `openAtStartup` to `true` for both `day` and `week` in the first `calendarSets` entry. Reopen. | Both groups show **Opens at startup**. Calendaric did not pick one for you. |
| 6 | Turn **Open on startup** on for **Daily Notes** again (off then on). | Only **Daily Notes** stays on. |

Clean up: turn every **Open on startup** off and switch **Weekly Notes** back on.

- [ ] Pass
- [ ] Fail

#### QA-SET-04 Changes save at once and survive a restart

- Covers: AC-SET-06.1, AC-SET-06.2, AC-SET-03.4, AC-SET-07.3
- Preconditions: setup done.

| # | Action | Expected result |
|---|---|---|
| 1 | Turn **Show week numbers** off. Do not press anything else. | The **W** column disappears. `data.json` shows `"showWeekNumbers": false` within a second. There is no Save button. |
| 2 | Switch the **Weekly Notes** heading toggle off. Open the command palette and type `weekly`. | No weekly Calendaric command. No restart needed. |
| 3 | Switch it on again. | The weekly commands are back. |
| 4 | Quit Obsidian and reopen the vault. | **Show week numbers** is still off. Every other setting is as you left it. |
| 5 | Quit Obsidian. Leave core **Daily notes** off. Write `<vault>/.obsidian/daily-notes.json` with the content `{"folder": "Other", "format": "YYYY-MM-DD"}`. Reopen the vault. | — |
| 6 | Create the 9 April note from the calendar. | It is created in `Journal/Daily`, Calendaric's own folder, not in `Other`. |

Clean up: turn **Show week numbers** on. Delete `daily-notes.json` and the 9 April note.

- [ ] Pass
- [ ] Fail

#### QA-SET-05 A failed save leaves the old settings in force

- Covers: AC-SET-07.4
- Preconditions: setup done. macOS or Linux.

| # | Action | Expected result |
|---|---|---|
| 1 | In a terminal, make `data.json` read-only: `chmod a-w <vault>/.obsidian/plugins/obsidian-calendaric/data.json`. | — |
| 2 | Change **Start week on** to **Sunday**. | A notice says "Could not save settings." The screen shows **Monday** again. |
| 3 | Look at the calendar. | Weeks still start on Monday. |

Clean up: `chmod u+w` the file.

- [ ] Pass
- [ ] Fail

### CMD: commands and the ribbon icon

#### QA-CMD-01 Open calendar

- Covers: AC-CMD-01.1, AC-CMD-01.2, AC-CMD-01.3, AC-CMD-01.4, AC-CMD-02.1, AC-CMD-02.3
- Preconditions: setup done.

| # | Action | Expected result |
|---|---|---|
| 1 | Close the calendar tab in the sidebar. Run **Open calendar**. | A calendar opens and gets focus. |
| 2 | Open the command palette and type `Open calendar`. | Not listed while the calendar is open. |
| 3 | Collapse the right sidebar. Run **Open calendar**. | The sidebar expands and shows the calendar. Still one calendar tab. |
| 4 | Quit and reopen Obsidian. | One calendar, not two. |
| 5 | Close the calendar, quit and reopen. | A calendar opens by itself once the vault has loaded. |

- [ ] Pass
- [ ] Fail

#### QA-CMD-02 The generated commands

- Covers: AC-CMD-04.1, AC-CMD-04.2, AC-CMD-04.3, AC-CMD-05.1, AC-CMD-05.7, AC-CMD-05.8, AC-CMD-06.4, AC-CMD-07.4
- Preconditions: setup done. `Notes/Meeting` is the active note.

| # | Action | Expected result |
|---|---|---|
| 1 | Open the command palette and type `Calendaric:`. | **Open current daily note**, **Open current weekly note**, **Open calendar**, **Reveal active note**. No jump, next or previous commands: the active note is not periodic. |
| 2 | Type `weekly note`. | Exactly one command opens the current week's note. No "Open Weekly Note" command from Calendaric. |
| 3 | Open `2026-04-06`, then type `daily note` in the palette. | All five: **Open current daily note**, **Jump forward to next existing daily note**, **Jump backward to previous existing daily note**, **Open next daily note**, **Open previous daily note**. |
| 4 | Switch **Weekly Notes** off and type `weekly`. | No weekly command at all. |
| 5 | Switch **Daily Notes** off too and type `Calendaric:`. | Only **Open calendar** and **Reveal active note** (and **Open date switcher** if Natural Language Dates is on). |
| 6 | Switch quarter on by hand in `data.json` (refer to setup) and type `quarter`. | No quarterly command. |

Clean up: switch quarter off, **Daily Notes** and **Weekly Notes** on.

- [ ] Pass
- [ ] Fail

#### QA-CMD-03 Jump and open next or previous

- Covers: AC-CMD-06.1, AC-CMD-06.2, AC-CMD-06.3, AC-CMD-07.1, AC-CMD-07.2, AC-CMD-07.3
- Preconditions: setup done. Delete any daily note after 15 April and before 1 April that earlier scenarios left behind. Turn **Confirm before creating new note** off.

| # | Action | Expected result |
|---|---|---|
| 1 | Open `2026-04-06`. Run **Jump forward to next existing daily note**. | `2026-04-08` opens. No new file. |
| 2 | Run it again. | `2026-04-15` opens. |
| 3 | Run it again. | A notice: "No next daily note." Nothing is created. |
| 4 | Open `2026-04-01`. Run **Jump backward to previous existing daily note**. | A notice: "No previous daily note." |
| 5 | Open `2026-04-06`. Run **Open next daily note**. | `2026-04-07` is created and opens. |
| 6 | Run **Open previous daily note**. | `2026-04-06` opens (it exists). |
| 7 | Run **Open previous daily note**. | `2026-04-05` is created and opens. |

Clean up: delete `2026-04-05` and `2026-04-07`. Turn **Confirm before creating new note** back on.

- [ ] Pass
- [ ] Fail

#### QA-CMD-04 Ribbon icon

- Covers: AC-CMD-08.1, AC-CMD-08.2, AC-CMD-08.3, AC-CMD-08.4, AC-CMD-08.5, AC-CMD-08.6
- Preconditions: setup done. Turn **Confirm before creating new note** off.

| # | Action | Expected result |
|---|---|---|
| 1 | Find the Calendaric ribbon icon in the left ribbon. Rest the pointer on it. | One icon. Tooltip: **Open current daily note**. |
| 2 | Select it. | Today's daily note opens in the active pane. |
| 3 | Mod-select it. | Today's daily note opens in a new split. |
| 4 | Right-click it. | A menu with **Open current daily note** and **Open current weekly note**. Choose the weekly one: this week's note opens. |
| 5 | Switch quarter on by hand in `data.json` and reload. Right-click the icon. | No quarterly entry. |
| 6 | Switch every granularity off, then reload Obsidian (**Reload app without saving** in the palette). | No Calendaric ribbon icon. |

Clean up: switch quarter off, **Daily Notes** and **Weekly Notes** on. Turn **Confirm before creating new note** back on.

- [ ] Pass
- [ ] Fail

`DISCREPANCY` for step 6: switching the last granularity off without a reload leaves the icon in place until Obsidian reloads. The code says so in a `ponytail:` comment in `src/commands/ribbonIcon.ts`. AC-CMD-08.5 says "when the plugin loads", so the reload is part of the check.

#### QA-CMD-05 Startup note

- Covers: AC-CMD-09.1, AC-CMD-09.2, AC-CMD-09.3, AC-CMD-09.5
- Preconditions: setup done. Turn **Confirm before creating new note** off.

| # | Action | Expected result |
|---|---|---|
| 1 | With no **Open on startup** on, quit and reopen Obsidian. | No note opens by itself. |
| 2 | Delete today's daily note if it exists. Turn **Open on startup** on in **Daily Notes**. Quit and reopen. | Today's note is created and opens in a new tab. |
| 3 | Leave that tab open. Quit and reopen. | Today's note is shown once. No second tab for it. |
| 4 | Close the tab. Quit and reopen. | Today's note (which now exists) opens in a new tab. |

Clean up: turn **Open on startup** off. Turn **Confirm before creating new note** back on.

- [ ] Pass
- [ ] Fail

QA-P-01 covers hotkeys (AC-CMD-05.2 to 05.4). QA-P-05 covers the date switcher (US-CMD-10).

### MIG: moving over from the older plugins

#### QA-MIG-01 Import from the core Daily notes plugin

- Covers: AC-MIG-01.1, AC-MIG-01.2, AC-MIG-01.4, AC-MIG-01.5, AC-MIG-01.6, AC-MIG-02.1, AC-MIG-02.2, AC-MIG-02.3, AC-MIG-02.4
- Preconditions: setup done. Core **Daily notes** off. Close Obsidian, delete `data.json`, reopen: Calendaric starts as if fresh.

| # | Action | Expected result |
|---|---|---|
| 1 | Open **Settings → Calendaric**. | No "Daily Notes plugin detected" card. |
| 2 | Switch core **Daily notes** on. In its options set folder `Journal/Daily`, format `YYYY-MM-DD`, template `Templates/Daily`. | — |
| 3 | Open **Settings → Calendaric**. | A card titled "Daily Notes plugin detected", with **Import settings**, **Disable Daily Notes plugin** and **Dismiss**. |
| 4 | Select **Import settings**. | **Daily Notes** now shows `Journal/Daily`, `YYYY-MM-DD` and `Templates/Daily`, and is on. |
| 5 | Close and reopen settings. | The import card does not come back. In its place, a card titled "Daily Notes plugin is still active" offers **Disable Daily Notes** and **Dismiss**. |
| 6 | Select **Disable Daily Notes**. | A dialog "Turn off the core daily notes plugin?" says hotkeys bound to its commands may stop working. Nothing is off yet. |
| 7 | Select **Cancel**. | Core **Daily notes** is still on. |
| 8 | Select **Disable Daily Notes** again, then **Disable plugin**. | Core **Daily notes** is off. Creating a day note from the calendar works, in `Journal/Daily`. |
| 9 | Switch core **Daily notes** back on in **Settings → Core plugins**. | It turns on normally. Its folder, format and template are still set. No notes were deleted. |
| 10 | (Conflict.) Delete `data.json` again and reopen. Set **Daily Notes → Note Folder** to `Mine` in Calendaric. Select **Import settings**. | A "Daily Notes import" dialog lists "Note folder — yours: "Mine" · Daily Notes: "Journal/Daily"". **Keep my values** leaves `Mine`. **Import selected** with the box ticked replaces it. |

Clean up: switch core **Daily notes** off. Redo setup step 5 if values changed.

- [ ] Pass
- [ ] Fail

#### QA-MIG-02 Import from the Calendar plugin

- Covers: AC-MIG-03.1, AC-MIG-03.3, AC-MIG-03.5, AC-MIG-03.6, AC-MIG-03.7, AC-MIG-03.8
- Preconditions: setup done. Calendar plugin installed but disabled.

| # | Action | Expected result |
|---|---|---|
| 1 | Open **Settings → Calendaric**. | No "Calendar plugin detected" card. |
| 2 | Enable the Calendar plugin. In its settings set week start to Sunday, turn on "Show week number" and "Confirm before creating new note", words per dot 300. | — |
| 3 | Open **Settings → Calendaric**. | A "Calendar plugin detected" card lists each incoming value as `"current" → "incoming"`, with **Import settings**. |
| 4 | Select **Import settings**. | A "Calendar plugin import" dialog lists values Calendaric already has. Select **Keep my values**: nothing changes. |
| 5 | Select **Import settings** again, tick every row, select **Import selected**. | **Start week on** is **Sunday**, **Words per dot** is `300`, and the others match. |
| 6 | Close Obsidian. In `.obsidian/plugins/calendar/data.json`, set every field the import reads to empty or remove it: `weeklyNoteFormat`, `weeklyNoteTemplate`, `weeklyNoteFolder`, `weekStart`, `shouldConfirmBeforeCreate`, `wordsPerDot`, `showWeeklyNote`, `localeOverride`. Reopen. | No Calendar import is offered. |
| 7 | Set only `"weekStart": "monday"`, `"shouldConfirmBeforeCreate": true`, `"wordsPerDot": 250`, `"showWeeklyNote": true`, `"localeOverride": "system-default"`, with the three weekly fields empty. Reopen. | The Calendar import is offered again. |
| 8 | (Weekly config.) Set `"weeklyNoteFolder": "CalWeekly"` and `"weeklyNoteFormat": "gggg-[W]ww"`. Reopen and import. | **Weekly Notes** gets folder `CalWeekly` and is on. |

Clean up: disable the Calendar plugin. Redo setup steps 5 and 6.

- [ ] Pass
- [ ] Fail

#### QA-MIG-03 Import from Periodic Notes

- Covers: AC-MIG-04.1, AC-MIG-04.3, AC-MIG-04.4, AC-MIG-04.5, AC-MIG-04.6, AC-MIG-03.2, AC-MIG-05.1, AC-MIG-05.2, AC-MIG-05.3
- Preconditions: setup done. Periodic Notes installed but disabled.

| # | Action | Expected result |
|---|---|---|
| 1 | Open **Settings → Calendaric**. | No "Periodic notes plugin detected" card. |
| 2 | Enable Periodic Notes. Turn on its monthly notes with folder `PN/Monthly`, format `YYYY-MM`. If your version has calendar sets, make a second set with different values, and keep the first one active. | — |
| 3 | Open **Settings → Calendaric**. | A "Periodic notes plugin detected" card lists `Monthly — Format` style rows from the active set only. |
| 4 | Select **Import settings**. If a "Periodic notes import" dialog appears, select **Keep my values** first. | Nothing changes. |
| 5 | Select **Import settings**, tick every row, **Import selected**. | Monthly notes are on in Calendaric, with folder `PN/Monthly`. Nothing from the second set was taken. |
| 6 | Reopen settings. | "Periodic notes settings already imported" says there is nothing left to import. |
| 7 | Also enable the Calendar plugin with weekly fields set, and turn on weekly notes in Periodic Notes. Open Calendaric settings. | The Calendar card offers no weekly folder, format or template: Periodic Notes governs week. |
| 8 | Switch on core **Daily notes**, with daily notes off in Periodic Notes. | The Daily Notes import card is offered for day. |

Clean up: disable Periodic Notes, Calendar and core **Daily notes**. Switch monthly notes off by hand. Redo setup step 5.

- [ ] Pass
- [ ] Fail

#### QA-MIG-04 A predecessor still in charge blocks creation

- Covers: AC-MIG-06.1, AC-MIG-06.2, AC-MIG-06.5
- Preconditions: setup done. No predecessor plugin enabled.

| # | Action | Expected result |
|---|---|---|
| 1 | Quit and reopen Obsidian. | No notice about another plugin. |
| 2 | Switch core **Daily notes** on. Select an empty day in the calendar and **Create**. | A notice: "Calendaric: The core Daily Notes plugin still manages daily notes, so Calendaric did not create this one." No file. Existing dots still show. |
| 3 | Select the notice's **Use Calendaric** button. | Core **Daily notes** is switched off. A notice says Calendaric now manages daily notes. |
| 4 | Select the same day and **Create**. | The note is created. |

Clean up: delete the note.

- [ ] Pass
- [ ] Fail

## Not testable by clicking

These criteria are `integration` or `manual` in the backlog, but a person clicking in Obsidian cannot observe them. Each has the reason.
ARCH criteria about the build, CI, code layout or the review process are listed here because they are facts about the repository, not about the running plugin.

<!-- appendix:start -->
| AC | Reason |
|---|---|
| AC-NOTE-06.4 | Needs a file deleted between lookup and open, a gap of milliseconds. Covered by an integration test. |
| AC-CAL-11.1 | Needs midnight to pass with the view open. Possible by changing the system clock, but that disturbs the machine. Covered by an integration test with a fake clock. |
| AC-CAL-11.2 | Same as AC-CAL-11.1, at a month boundary. |
| AC-CAL-11.3 | Same as AC-CAL-11.1, while showing another month. |
| AC-CMD-01.5 | Needs the calendar view to fail while it is built. No user action causes that. |
| AC-CMD-02.2 | Needs the plugin to load before the workspace layout is ready. That ordering is Obsidian's, not the tester's. |
| AC-CMD-02.4 | Needs Obsidian never to fire its layout-ready event. No user action causes that. |
| AC-CMD-10.6 | Needs Obsidian to report no active view at all. An empty new tab still counts as one. QA-P-06 records what a tester sees. |
| AC-MIG-05.4 | Needs a Periodic Notes version that hides which granularities are on. No released version is known to. |
| AC-MIG-02.5 | Needs the core Daily notes plugin to be off or missing at the moment the disable action runs. The confirmation dialog blocks the settings screen, so a tester cannot change it in between. |
| AC-MIG-06.4 | Needs Obsidian's plugin registry to be unreadable. No user action causes that. |
| AC-MIG-06.6 | Needs the predecessor to stay on after Calendaric switched it off, before the re-read. No user action is known to cause that. |
| AC-MIG-07.5 | Needs the settings upgrade to fail halfway through a disk write. |
| AC-ARCH-05.1 | Code layout: how a granularity is added. Checked in code review. |
| AC-ARCH-05.2 | Code layout: how an indicator is added. Checked in code review. |
| AC-ARCH-05.3 | Compile-time contract of the indicator interface. Checked by the type checker. |
| AC-ARCH-05.4 | File footprint of a change. Checked in code review. |
| AC-ARCH-06.1 | Clean-checkout build. A build fact, checked in CI. Setup step 1 exercises it once. |
| AC-ARCH-06.3 | Release tag matches `manifest.json`. A release fact, checked by `scripts/release-check`. |
| AC-ARCH-06.4 | `minAppVersion` against the APIs used. Checked against Obsidian's changelog. |
| AC-ARCH-06.5 | Build fails when a gate fails. A build fact. |
| AC-ARCH-06.6 | Build fails loudly when a gate cannot run. A build fact. |
| AC-ARCH-06.7 | Install from source builds the output. A packaging fact. |
| AC-ARCH-08.4 | The guide changes with the code. A review-process fact. |
| AC-ARCH-08.5 | Guide drift is caught before release. Checked by `src/guide.test.ts`. |
| AC-ARCH-09.1 | GitHub Actions job shape. A CI fact. |
| AC-ARCH-09.2 | GitHub Actions trigger. A CI fact. |
| AC-ARCH-09.3 | GitHub Actions failure reporting. A CI fact. |
| AC-ARCH-09.4 | CI gate detection. A tooling fact. |
| AC-ARCH-09.5 | Lint left out of the CI gate. A CI fact. |
| AC-ARCH-10.1 | Upstream template divergence review. A repository fact. |
| AC-ARCH-10.2 | eslint baseline comparison. A tooling fact. |
| AC-ARCH-11.4 | Test harness design. A test-code fact. |
<!-- appendix:end -->

## Regression smoke test

About 10 minutes. Run it after every release, in the setup vault.

| # | Action | Expected result |
|---|---|---|
| 1 | Open the vault. | The calendar shows the current month in the sidebar. No error notice. |
| 2 | Select **Next month**, then **Today**. | The grid moves, then returns. |
| 3 | Go to April 2026. | Dots on 6, 8 and 15 April. |
| 4 | Select 6 April. | `2026-04-06` opens. |
| 5 | Select 16 April, then **Create**. | The note is created from the daily template and opens. |
| 6 | Select the **W** cell of the row 6 to 12 April. | `2026-W15` opens. |
| 7 | Rest the pointer on 6 April. | **Note exists** and **25 words**. |
| 8 | Open `2026-04-06`. Run **Jump forward to next existing daily note**. | `2026-04-08` opens. |
| 9 | Run **Open current daily note**. | Today's note opens, created if asked. Its label says **Today**. |
| 10 | Run **Reveal active note**. | The calendar shows the current month with today highlighted. |
| 11 | Change **Start week on** to **Sunday**, then back to **Monday**. | The grid redraws each time, with no reload. |
| 12 | Right-click the 16 April cell and choose **Delete**. | The note and its dot are gone. |
| 13 | Open **View → Toggle developer tools → Console**. | No red error that mentions Calendaric. |

- [ ] Pass
- [ ] Fail

## How to report a failure

Report one failure per issue. Include:

- the scenario ID and step number, for example `QA-CAL-02 step 5`
- what you expected, copied from the step
- what happened instead, in your own words
- a screenshot or a short screen recording, when the problem is visual
- the Obsidian version, from **Settings → About**
- the Calendaric version, from `manifest.json` in the plugin folder (`0.1.0` at the time of writing)
- your operating system and version
- `data.json`, from `<vault>/.obsidian/plugins/obsidian-calendaric/data.json`. It holds no note content, only settings
- the console output: open **View → Toggle developer tools**, select the **Console** tab, reproduce the problem, then copy every line that mentions Calendaric
- which other community plugins were enabled, from **Settings → Community plugins**

## Coverage table

Generated by `python3 docs/qa/coverage.py --write`, from two sources:

- every criterion in `docs/backlog/epics/*.json` whose `testable_by` is `integration` or `manual` (the brief calls this field "kind")
- the `Covers:` line of every scenario in this file, and the rows of the [Not testable by clicking](#not-testable-by-clicking) table

Run `python3 docs/qa/coverage.py --check` to confirm the table is current. It fails when a criterion is in neither place, when this file names an id that does not exist, or when the table is stale.

<!-- coverage:start -->
214 integration and manual criteria: 182 covered by a scenario, 32 listed as not testable by clicking. Scenarios also touch 1 unit criteria, not listed here.

| AC | testable_by | Scenario |
|---|---|---|
| AC-ARCH-05.1 | manual | not testable by clicking |
| AC-ARCH-05.2 | manual | not testable by clicking |
| AC-ARCH-05.3 | manual | not testable by clicking |
| AC-ARCH-05.4 | manual | not testable by clicking |
| AC-ARCH-06.1 | integration | not testable by clicking |
| AC-ARCH-06.3 | manual | not testable by clicking |
| AC-ARCH-06.4 | manual | not testable by clicking |
| AC-ARCH-06.5 | integration | not testable by clicking |
| AC-ARCH-06.6 | manual | not testable by clicking |
| AC-ARCH-06.7 | integration | not testable by clicking |
| AC-ARCH-08.3 | manual | QA-SET-02 |
| AC-ARCH-08.4 | manual | not testable by clicking |
| AC-ARCH-08.5 | manual | not testable by clicking |
| AC-ARCH-09.1 | integration | not testable by clicking |
| AC-ARCH-09.2 | manual | not testable by clicking |
| AC-ARCH-09.3 | integration | not testable by clicking |
| AC-ARCH-09.4 | manual | not testable by clicking |
| AC-ARCH-09.5 | manual | not testable by clicking |
| AC-ARCH-10.1 | manual | not testable by clicking |
| AC-ARCH-10.2 | manual | not testable by clicking |
| AC-ARCH-11.4 | integration | not testable by clicking |
| AC-CAL-01.4 | integration | QA-FMT-01 |
| AC-CAL-02.1 | manual | QA-CAL-01 |
| AC-CAL-02.2 | manual | QA-CAL-01 |
| AC-CAL-02.3 | manual | QA-CAL-01 |
| AC-CAL-02.4 | manual | QA-CAL-01 |
| AC-CAL-02.5 | manual | QA-CAL-01 |
| AC-CAL-03.1 | manual | QA-CAL-02 |
| AC-CAL-03.2 | manual | QA-CAL-02 |
| AC-CAL-03.3 | manual | QA-CAL-02 |
| AC-CAL-03.4 | manual | QA-CAL-02 |
| AC-CAL-03.5 | manual | QA-P-02 |
| AC-CAL-03.6 | manual | QA-CAL-02 |
| AC-CAL-03.7 | manual | QA-P-03 |
| AC-CAL-04.1 | manual | QA-CAL-03 |
| AC-CAL-04.2 | manual | QA-CAL-03 |
| AC-CAL-04.3 | manual | QA-CAL-03 |
| AC-CAL-04.4 | manual | QA-P-02 |
| AC-CAL-04.5 | manual | QA-P-03 |
| AC-CAL-05.1 | manual | QA-CAL-04 |
| AC-CAL-05.2 | manual | QA-CAL-04 |
| AC-CAL-05.3 | manual | QA-CAL-04 |
| AC-CAL-05.4 | manual | QA-CAL-04 |
| AC-CAL-05.5 | manual | QA-CAL-04 |
| AC-CAL-06.1 | manual | QA-CAL-05 |
| AC-CAL-06.2 | manual | QA-CAL-05 |
| AC-CAL-06.3 | manual | QA-CAL-05 |
| AC-CAL-06.4 | manual | QA-CAL-05 |
| AC-CAL-08.1 | manual | QA-CAL-06 |
| AC-CAL-08.2 | manual | QA-CAL-06 |
| AC-CAL-08.3 | manual | QA-CAL-06 |
| AC-CAL-08.4 | manual | QA-CAL-06 |
| AC-CAL-08.5 | manual | QA-CAL-06 |
| AC-CAL-09.1 | integration | QA-CAL-07 |
| AC-CAL-09.2 | integration | QA-CAL-07 |
| AC-CAL-09.3 | integration | QA-CAL-07 |
| AC-CAL-09.4 | manual | QA-CAL-06 |
| AC-CAL-09.5 | integration | QA-CAL-07 |
| AC-CAL-10.1 | integration | QA-CAL-08 |
| AC-CAL-10.2 | integration | QA-CAL-08 |
| AC-CAL-10.3 | integration | QA-CAL-08 |
| AC-CAL-10.4 | integration | QA-CAL-08 |
| AC-CAL-11.1 | integration | not testable by clicking |
| AC-CAL-11.2 | integration | not testable by clicking |
| AC-CAL-11.3 | integration | not testable by clicking |
| AC-CAL-12.1 | manual | QA-CAL-09 |
| AC-CAL-12.2 | manual | QA-CAL-09 |
| AC-CAL-12.3 | manual | QA-CAL-09 |
| AC-CAL-12.4 | manual | QA-CAL-09 |
| AC-CAL-12.5 | manual | QA-CAL-09 |
| AC-CAL-13.1 | integration | QA-CAL-10 |
| AC-CAL-13.2 | integration | QA-CAL-10 |
| AC-CAL-13.3 | integration | QA-CAL-10 |
| AC-CAL-13.4 | integration | QA-CAL-10 |
| AC-CAL-13.5 | integration | QA-CAL-10 |
| AC-CAL-13.6 | integration | QA-CAL-10 |
| AC-CAL-14.1 | integration | QA-CAL-10 |
| AC-CAL-14.2 | integration | QA-CAL-10 |
| AC-CAL-14.3 | integration | QA-CAL-10 |
| AC-CMD-01.1 | integration | QA-CMD-01 |
| AC-CMD-01.2 | integration | QA-CMD-01 |
| AC-CMD-01.3 | integration | QA-CMD-01 |
| AC-CMD-01.4 | integration | QA-CMD-01 |
| AC-CMD-01.5 | integration | not testable by clicking |
| AC-CMD-02.1 | integration | QA-CMD-01 |
| AC-CMD-02.2 | integration | not testable by clicking |
| AC-CMD-02.3 | integration | QA-CMD-01 |
| AC-CMD-02.4 | manual | not testable by clicking |
| AC-CMD-03.1 | integration | QA-CAL-08 |
| AC-CMD-03.2 | integration | QA-CAL-08 |
| AC-CMD-03.3 | manual | QA-CAL-08 |
| AC-CMD-04.1 | integration | QA-CMD-02 |
| AC-CMD-04.2 | integration | QA-CMD-02 |
| AC-CMD-04.3 | integration | QA-CMD-02 |
| AC-CMD-05.1 | integration | QA-CMD-02 |
| AC-CMD-05.2 | integration | QA-P-01 |
| AC-CMD-05.3 | integration | QA-P-01 |
| AC-CMD-05.4 | manual | QA-P-01 |
| AC-CMD-05.7 | integration | QA-CMD-02 |
| AC-CMD-05.8 | integration | QA-CMD-02 |
| AC-CMD-06.1 | integration | QA-CMD-03 |
| AC-CMD-06.2 | integration | QA-CMD-03 |
| AC-CMD-06.3 | integration | QA-CMD-03 |
| AC-CMD-06.4 | integration | QA-CMD-02 |
| AC-CMD-07.1 | integration | QA-CMD-03 |
| AC-CMD-07.2 | integration | QA-CMD-03 |
| AC-CMD-07.3 | integration | QA-CMD-03 |
| AC-CMD-07.4 | integration | QA-CMD-02 |
| AC-CMD-08.1 | integration | QA-CMD-04 |
| AC-CMD-08.2 | integration | QA-CMD-04 |
| AC-CMD-08.3 | integration | QA-CMD-04 |
| AC-CMD-08.4 | integration | QA-CMD-04 |
| AC-CMD-08.5 | integration | QA-CMD-04 |
| AC-CMD-08.6 | integration | QA-CMD-04 |
| AC-CMD-09.1 | integration | QA-CMD-05 |
| AC-CMD-09.2 | integration | QA-CMD-05 |
| AC-CMD-09.3 | integration | QA-CMD-05 |
| AC-CMD-09.5 | integration | QA-CMD-05 |
| AC-CMD-09.6 | integration | QA-SET-03 |
| AC-CMD-10.1 | integration | QA-P-05 |
| AC-CMD-10.2 | integration | QA-P-05 |
| AC-CMD-10.3 | integration | QA-P-05 |
| AC-CMD-10.4 | integration | QA-P-05 |
| AC-CMD-10.5 | integration | QA-P-05 |
| AC-CMD-10.6 | integration | QA-P-06 |
| AC-CMD-10.7 | integration | QA-P-05 |
| AC-FMT-03.3 | manual | QA-P-04, QA-FMT-01 |
| AC-FMT-04.6 | integration | QA-NOTE-03 |
| AC-FMT-04.7 | integration | QA-FMT-02 |
| AC-MIG-01.1 | manual | QA-MIG-01 |
| AC-MIG-01.2 | integration | QA-MIG-01 |
| AC-MIG-01.4 | integration | QA-MIG-01 |
| AC-MIG-01.5 | manual | QA-MIG-01 |
| AC-MIG-01.6 | integration | QA-MIG-01 |
| AC-MIG-02.1 | manual | QA-MIG-01 |
| AC-MIG-02.2 | integration | QA-MIG-01 |
| AC-MIG-02.3 | integration | QA-MIG-01 |
| AC-MIG-02.4 | manual | QA-MIG-01 |
| AC-MIG-02.5 | integration | not testable by clicking |
| AC-MIG-03.1 | integration | QA-MIG-02 |
| AC-MIG-03.2 | integration | QA-MIG-03 |
| AC-MIG-03.3 | integration | QA-MIG-02 |
| AC-MIG-03.5 | manual | QA-MIG-02 |
| AC-MIG-03.6 | integration | QA-MIG-02 |
| AC-MIG-03.7 | integration | QA-MIG-02 |
| AC-MIG-03.8 | integration | QA-MIG-02 |
| AC-MIG-04.1 | integration | QA-MIG-03 |
| AC-MIG-04.3 | integration | QA-MIG-03 |
| AC-MIG-04.4 | manual | QA-MIG-03 |
| AC-MIG-04.5 | integration | QA-MIG-03 |
| AC-MIG-04.6 | integration | QA-MIG-03 |
| AC-MIG-05.1 | integration | QA-MIG-03 |
| AC-MIG-05.2 | integration | QA-MIG-03 |
| AC-MIG-05.3 | integration | QA-MIG-03 |
| AC-MIG-05.4 | integration | not testable by clicking |
| AC-MIG-06.1 | integration | QA-MIG-04 |
| AC-MIG-06.2 | integration | QA-MIG-04 |
| AC-MIG-06.4 | integration | not testable by clicking |
| AC-MIG-06.5 | integration | QA-MIG-04 |
| AC-MIG-06.6 | integration | not testable by clicking |
| AC-MIG-07.5 | integration | not testable by clicking |
| AC-NOTE-03.1 | integration | QA-NOTE-01 |
| AC-NOTE-03.5 | integration | QA-NOTE-01 |
| AC-NOTE-04.1 | integration | QA-NOTE-01 |
| AC-NOTE-04.4 | integration | QA-NOTE-01 |
| AC-NOTE-05.4 | integration | QA-NOTE-01 |
| AC-NOTE-06.1 | integration | QA-NOTE-02 |
| AC-NOTE-06.2 | integration | QA-NOTE-02 |
| AC-NOTE-06.3 | integration | QA-NOTE-07 |
| AC-NOTE-06.4 | integration | not testable by clicking |
| AC-NOTE-07.1 | integration | QA-NOTE-01 |
| AC-NOTE-07.2 | integration | QA-NOTE-02 |
| AC-NOTE-07.3 | manual | QA-NOTE-01 |
| AC-NOTE-07.4 | integration | QA-NOTE-01 |
| AC-NOTE-07.5 | integration | QA-NOTE-04 |
| AC-NOTE-07.6 | integration | QA-NOTE-03 |
| AC-NOTE-08.4 | integration | QA-NOTE-05 |
| AC-NOTE-10.1 | integration | QA-NOTE-06 |
| AC-NOTE-10.2 | integration | QA-NOTE-06 |
| AC-NOTE-10.3 | integration | QA-NOTE-06 |
| AC-NOTE-11.1 | integration | QA-NOTE-05 |
| AC-NOTE-11.2 | integration | QA-NOTE-05 |
| AC-NOTE-11.3 | integration | QA-NOTE-05 |
| AC-NOTE-11.5 | integration | QA-NOTE-05 |
| AC-NOTE-11.7 | integration | QA-NOTE-05, QA-CAL-05 |
| AC-SET-01.5 | integration | QA-SET-01 |
| AC-SET-02.1 | manual | QA-SET-01 |
| AC-SET-02.3 | integration | QA-SET-01 |
| AC-SET-02.4 | manual | QA-CAL-06, QA-SET-01 |
| AC-SET-02.5 | manual | QA-SET-02 |
| AC-SET-03.4 | integration | QA-SET-04 |
| AC-SET-04.1 | manual | QA-SET-02 |
| AC-SET-04.2 | manual | QA-SET-02 |
| AC-SET-04.3 | manual | QA-TPL-01 |
| AC-SET-04.4 | integration | QA-SET-02 |
| AC-SET-04.5 | manual | QA-SET-02 |
| AC-SET-05.1 | integration | QA-SET-03 |
| AC-SET-05.4 | integration | QA-SET-03 |
| AC-SET-06.1 | integration | QA-SET-04 |
| AC-SET-06.2 | integration | QA-SET-04 |
| AC-SET-07.1 | integration | QA-CAL-07 |
| AC-SET-07.2 | integration | QA-CAL-07 |
| AC-SET-07.3 | integration | QA-SET-04 |
| AC-SET-07.4 | manual | QA-SET-05 |
| AC-TPL-03.2 | integration | QA-P-04 |
| AC-TPL-04.1 | integration | QA-TPL-01 |
| AC-TPL-04.2 | integration | QA-TPL-01 |
| AC-TPL-04.3 | integration | QA-TPL-01 |
| AC-TPL-04.4 | integration | QA-TPL-01 |
| AC-TPL-04.5 | integration | QA-TPL-02 |
| AC-TPL-05.1 | manual | QA-TPL-03 |
| AC-TPL-05.2 | integration | QA-TPL-03 |
| AC-TPL-05.3 | manual | QA-TPL-03 |
| AC-TPL-06.4 | manual | QA-TPL-03 |
<!-- coverage:end -->
