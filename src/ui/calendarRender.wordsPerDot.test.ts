// @vitest-environment happy-dom
//
// US-SET-02 / DEC-22: the stored words-per-dot threshold decides how many
// segments of the word-count dot a note fills, through the calendar render,
// and decides when an edit redraws the grid.
import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { DotScanner } from "./calendarDots";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS, loadStoredConfig, toSettings } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";

function eventOnlyApp(): App {
	return {
		workspace: { on: (): object => ({}), offref: (): undefined => undefined, trigger: (): undefined => undefined },
	} as unknown as App;
}

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

/** Settings as a load of `stored` gives them, with the day granularity on. */
function settingsFrom(stored: Record<string, unknown>): CalendaricSettings {
	const settings = toSettings(loadStoredConfig(stored));
	return { ...settings, day: { ...DEFAULT_SETTINGS.day, enabled: true, format: "YYYY-MM-DD" } };
}

function thirdDayPath(settings: CalendaricSettings): string {
	return computeNotePath(window.moment().startOf("month").add(2, "day"), settings.day, new FakeVaultConfigPort(), "day");
}

/** Filled segments of the word-count dot on day 3, after the async draw settles. */
async function filledOnDay3(stored: Record<string, unknown>, wordCount: number): Promise<number> {
	const settings = settingsFrom(stored);
	const vault = new FakeVaultPort();
	vault.seedFile(thirdDayPath(settings), words(wordCount));
	const host = document.createElement("div");
	new CalendarWidget(host, eventOnlyApp(), settings, {
		vault,
		vaultConfig: new FakeVaultConfigPort(),
		workspace: new FakeWorkspacePort(),
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	const cell = Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)")).find(
		(el) => el.firstChild?.textContent === "3",
	);
	if (!cell) throw new Error("no cell for day 3");
	return cell.querySelectorAll(".calendaric-dot--words .is-filled").length;
}

describe("the stored words-per-dot threshold reaches the dots", () => {
	it("AC-SET-06.5: the stored wordsPerDot is read by the calendar render and decides how many segments a note fills", async () => {
		expect(await filledOnDay3({}, 500)).toBe(2);
		expect(await filledOnDay3({ wordsPerDot: 100 }, 500)).toBe(5);
		expect(await filledOnDay3({ wordsPerDot: 500 }, 500)).toBe(1);
	});

	it("AC-CAL-07.3: a stored threshold that is not a positive whole number draws at the default", async () => {
		expect(await filledOnDay3({ wordsPerDot: 0 }, 500)).toBe(2);
		expect(await filledOnDay3({ wordsPerDot: -3 }, 500)).toBe(2);
	});

	it("AC-SET-06.5: after an edit, the calendar render redraws when the dot moves at the stored wordsPerDot", async () => {
		const settings = settingsFrom({ wordsPerDot: 100 });
		const path = thirdDayPath(settings);
		const vault = new FakeVaultPort();
		vault.seedFile(path, words(150));
		const host = document.createElement("div");
		new CalendarWidget(host, eventOnlyApp(), settings, {
			vault,
			vaultConfig: new FakeVaultConfigPort(),
			workspace: new FakeWorkspacePort(),
		});
		const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
		const filled = () =>
			Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)"))
				.find((el) => el.firstChild?.textContent === "3")
				?.querySelectorAll(".calendaric-dot--words .is-filled").length;
		await settle();
		expect(filled()).toBe(1);

		// 150 -> 210 words: one segment to two at 100 words each, but one throughout at the default 250.
		vault.seedFile(path, words(210));
		vault.emitChange({ kind: "metadata", file: vault.getFile(path)! });
		await settle();
		await settle();
		expect(filled()).toBe(2);
	});

	it("AC-SET-06.5: the dot scanner judges an edit at the wordsPerDot of the render that drew it", async () => {
		const redraws = async (wordsPerDot: number | undefined): Promise<number> => {
			const vault = new FakeVaultPort();
			vault.seedFile("Daily/a.md", words(150));
			const onUpdate = vi.fn();
			const scanner = new DotScanner(
				{ vault, vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() },
				onUpdate,
			);
			await scanner.getWordCounts(["Daily/a.md"], wordsPerDot);
			vault.seedFile("Daily/a.md", words(210));
			vault.emitChange({ kind: "metadata", file: vault.getFile("Daily/a.md")! });
			await new Promise((resolve) => setTimeout(resolve, 0));
			return onUpdate.mock.calls.length;
		};

		// 150 -> 210 words: one segment to two at 100 words each, one segment throughout at 250.
		expect(await redraws(100)).toBe(1);
		expect(await redraws(undefined)).toBe(0);
	});
});
