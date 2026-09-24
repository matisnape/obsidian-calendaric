// @vitest-environment happy-dom
//
// US-FMT-05: the validator on its own, then the settings field that runs it.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { validateFormat } from "./validateFormat";
import { RELEASE_GRANULARITIES } from "../types";
import { CalendaricSettingsTab } from "../settings";
import { DEFAULT_FORMATS, DEFAULT_SETTINGS } from "../settings/model";
import { makeSettingsTabPorts } from "../__mocks__/settingsTabPorts";
import type CalendaricPlugin from "../main";

const TODAY = window.moment("2026-09-24");

describe("validateFormat", () => {
	it("AC-FMT-05.1: rejects a character Windows does not allow in a filename", () => {
		for (const format of ["YYYY-MM-DD[?]", "[a:b] YYYY-MM-DD", "YYYY-MM-DD[*]", "[<]YYYY-MM-DD"]) {
			const { errors } = validateFormat(format, "day", TODAY);
			expect(errors, format).toHaveLength(1);
			expect(errors[0], format).toContain("cannot appear in a filename");
		}
	});

	it("AC-FMT-05.1: rejects a reserved filename, in the note name or in a folder", () => {
		for (const format of ["[CON]", "[con]", "[AUX]/YYYY-MM-DD", "[LPT1]"]) {
			const { errors } = validateFormat(format, "day", TODAY);
			expect(errors, format).toHaveLength(1);
			expect(errors[0], format).toContain("reserved");
		}
	});

	it("AC-FMT-05.1: rejects a file or folder name Windows refuses: empty, a dot, or a trailing dot or space", () => {
		const cases: [string, "day" | "week"][] = [
			["[..]/YYYY-MM-DD", "day"],
			["[.]/YYYY-MM-DD", "day"],
			["/YYYY-MM-DD", "day"],
			["gggg-[W]ww/", "week"],
			["YYYY-MM-DD[.]", "day"],
			["YYYY-MM-DD[ ]", "day"],
		];
		for (const [format, granularity] of cases) {
			const { errors } = validateFormat(format, granularity, TODAY);
			expect(errors, format).toHaveLength(1);
			expect(errors[0], format).toContain("cannot be a file or folder name");
		}
	});

	it("AC-FMT-05.1: rejects a name that is reserved only on some days, whatever today is", () => {
		// On the 24th this writes COM24; on the 1st to the 9th it writes COM1..COM9.
		const { errors } = validateFormat("[COM]D", "day", TODAY);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatch(/"COM[1-9]" is a reserved filename/);
	});

	it("AC-FMT-05.1: rejects a week-number name reserved in weeks 1-9, in a year no other check date reaches week 1", () => {
		// 1 January 2027 falls in ISO week 53 of 2026, so only week 1 itself writes COM1.
		const { errors } = validateFormat("GGGG/[COM]W", "week", window.moment("2027-09-24"));
		expect(errors).toEqual(['"COM1" is a reserved filename on Windows.']);
	});

	it("AC-FMT-05.1: rejects a locale week-number name reserved in weeks 1-9, when locale week 1 starts after 1 January", () => {
		// pl's rule (week 1 holds 4 January) moved to a Wednesday start, as
		// locale.ts does for the week-start setting. In 2029 neither 1 January
		// nor ISO week 1 lands in locale week 1, so only week 1 itself writes COM1.
		window.moment.updateLocale("fmt05-test-wednesday", { week: { dow: 3, doy: 6 } });
		window.moment.locale("fmt05-test-wednesday");
		try {
			const { errors } = validateFormat("gggg/[COM]w", "week", window.moment("2029-09-24"));
			expect(errors).toEqual(['"COM1" is a reserved filename on Windows.']);
		} finally {
			window.moment.locale("en");
		}
	});

	it("AC-FMT-05.4: rejects an empty format instead of falling back to a default", () => {
		for (const format of ["", "   "]) {
			const { errors } = validateFormat(format, "day", TODAY);
			expect(errors, JSON.stringify(format)).toHaveLength(1);
			expect(errors[0]).toContain("empty");
		}
	});

	it("AC-FMT-05.2: warns that a day format of only DD cannot identify a note", () => {
		const { errors, warnings } = validateFormat("DD", "day", TODAY);
		expect(errors).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("cannot uniquely identify a note");
	});

	it("AC-FMT-05.2: warns about a format that reads today back correctly but repeats across months", () => {
		// In January the missing month is read back as January, so today alone
		// round-trips; only another date shows the collision.
		const { warnings } = validateFormat("YYYY-DD", "day", window.moment("2026-01-05"));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("cannot uniquely identify a note");
	});

	it("AC-FMT-05.3: warns, with a workaround, when the part after the last / cannot name the day", () => {
		const { errors, warnings } = validateFormat("YYYY/MM-DD", "day", TODAY);
		expect(errors).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("moved out of its dated folder");
		expect(warnings[0]).toContain("YYYY/YYYY-MM-DD");
	});

	it("AC-FMT-05.3: the workaround keeps an ISO week format ISO", () => {
		const { warnings } = validateFormat("GGGG/[W]WW", "week", TODAY);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("for example GGGG/GGGG-[W]WW.");
	});

	it("AC-FMT-05.3: stays quiet when the part after the last / carries the whole date", () => {
		expect(validateFormat("YYYY/MM/YYYY-MM-DD", "day", TODAY)).toEqual({ errors: [], warnings: [] });
	});

	it("AC-FMT-05.2: the default format of every release granularity passes, around a year boundary too", () => {
		for (const today of [TODAY, window.moment("2026-12-31"), window.moment("2027-01-01")]) {
			for (const granularity of RELEASE_GRANULARITIES) {
				expect(validateFormat(DEFAULT_FORMATS[granularity], granularity, today), granularity).toEqual({
					errors: [],
					warnings: [],
				});
			}
		}
	});
});

function makeApp(): App {
	return {
		vault: { adapter: {} },
		internalPlugins: {
			getPluginById: () => ({ enabled: false, disable: () => undefined, instance: { options: {} } }),
		},
	} as unknown as App;
}

/** Render the tab with `stored` as the saved day format. */
function renderDayFormat(stored: string) {
	const app = makeApp();
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.day.format = stored;
	const state = { saves: 0 };
	const plugin = {
		app,
		settings,
		saveSettings: () => {
			state.saves++;
			return Promise.resolve();
		},
		onSettingsChange: () => undefined,
	} as unknown as CalendaricPlugin;
	const tab = new CalendaricSettingsTab(app, plugin, makeSettingsTabPorts(app));
	tab.display();

	const input = tab.containerEl.querySelector<HTMLInputElement>(`input[placeholder="${DEFAULT_FORMATS.day}"]`);
	if (!input) throw new Error("day format field not rendered");
	const read = () => ({
		saved: settings.day.format,
		saves: state.saves,
		problems: Array.from(tab.containerEl.querySelectorAll(".calendaric-setting-problem"))
			.map((el) => el.textContent ?? "")
			.filter((text) => text !== ""),
		preview: input.closest(".setting-item")?.querySelector("b.u-pop")?.textContent,
	});
	return { input, read };
}

/** Type `value` into the day format field over a saved YYYY-MM-DD, and commit it. */
async function enterDayFormat(value: string) {
	const { input, read } = renderDayFormat("YYYY-MM-DD");
	input.value = value;
	input.dispatchEvent(new Event("input"));
	input.dispatchEvent(new Event("change"));
	await Promise.resolve();
	return read();
}

describe("the format field on the settings screen", () => {
	it("AC-FMT-05.4: an emptied format keeps the previous value saved and says why", async () => {
		const { saved, saves, problems, preview } = await enterDayFormat("");
		expect(saved).toBe("YYYY-MM-DD");
		expect(saves).toBe(0);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^Not saved: .*empty/);
		// The preview shows what was typed, not a default standing in for it.
		expect(preview).toBe("");
	});

	it("AC-FMT-05.1: an illegal character keeps the previous value saved and says why", async () => {
		const { saved, saves, problems } = await enterDayFormat("YYYY-MM-DD[?]");
		expect(saved).toBe("YYYY-MM-DD");
		expect(saves).toBe(0);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^Not saved: .*cannot appear in a filename/);
	});

	it("AC-FMT-05.2: a format that cannot identify a note is saved, with the warning shown", async () => {
		const { saved, saves, problems } = await enterDayFormat("DD");
		expect(saved).toBe("DD");
		expect(saves).toBe(1);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^Saved, but: .*cannot uniquely identify a note/);
	});

	it("AC-FMT-05.1: a saved format with an error says it is in use, not that it was not saved", () => {
		const { problems } = renderDayFormat("YYYY-MM-DD[.]").read();
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^In use, but: .*cannot be a file or folder name/);
	});

	it("AC-FMT-05.2: a saved format that warns shows the warning when the tab opens", () => {
		const { problems } = renderDayFormat("DD").read();
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^Saved, but: .*cannot uniquely identify a note/);
	});

	it("AC-FMT-05.3: a basename-fragile format is saved, with the workaround shown", async () => {
		const { saved, problems } = await enterDayFormat("YYYY/MM-DD");
		expect(saved).toBe("YYYY/MM-DD");
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("YYYY/YYYY-MM-DD");
	});

	it("AC-FMT-05.2: a valid format is saved with nothing shown", async () => {
		const { saved, problems } = await enterDayFormat("YYYY/YYYY-MM-DD");
		expect(saved).toBe("YYYY/YYYY-MM-DD");
		expect(problems).toEqual([]);
	});
});
