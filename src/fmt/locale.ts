import type { WeekStartOption } from "../settings/model";

/**
 * The locale and week start the whole plugin formats with (US-FMT-03).
 *
 * Applied to Obsidian's shared `window.moment`, because every date the plugin
 * writes or shows goes through it: weekday and month names, the `gggg`/`ww`
 * locale-week tokens, `week()` and `startOf("week")`. Setting the locale's
 * `week.dow` once is what makes the grid, filenames and week numbers use one
 * week start instead of each carrying its own. ISO tokens (`GGGG`/`WW`) ignore
 * `dow` and stay Monday-based, which is what the user chose by writing them.
 */

const DAY_NUMBERS: Record<Exclude<WeekStartOption, "locale">, number> = {
	sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
	thursday: 4, friday: 5, saturday: 6,
};

interface WeekSpec {
	dow: number;
	doy: number;
}

/** Each touched locale's week rules as moment shipped them, so "locale default" and unload can return to them. */
const shipped = new Map<string, WeekSpec>();
/** The global locale before the plugin first changed it. */
let foundLocale: string | null = null;

/** The week start as moment's `day()` number, 0=Sunday; "locale" is the locale's own `dow`. */
export function weekStartDay(option: WeekStartOption, localeDow: number): number {
	return option === "locale" ? localeDow : DAY_NUMBERS[option];
}

/**
 * The override if moment knows it, else Obsidian's display language if moment
 * knows it, else "en" — so an unknown stored value can never blank a name.
 */
export function resolveLocale(override: string, obsidianLanguage: string, known: readonly string[]): string {
	const candidates = [override, obsidianLanguage].map((name) => name.toLowerCase());
	return candidates.find((name) => name !== "" && known.includes(name)) ?? "en";
}

/** Make `window.moment` format with the resolved locale and the configured week start. */
export function applyLocale(override: string, weekStart: WeekStartOption, obsidianLanguage: string): string {
	const moment = window.moment;
	foundLocale ??= moment.locale();

	const locale = resolveLocale(override, obsidianLanguage, moment.locales());
	if (!shipped.has(locale)) {
		const data = moment.localeData(locale);
		shipped.set(locale, { dow: data.firstDayOfWeek(), doy: data.firstDayOfYear() });
	}
	const own = shipped.get(locale)!;
	const dow = weekStartDay(weekStart, own.dow);

	// `7 + dow - doy` is the January day week 1 must hold. Shifting doy with dow
	// keeps the locale's rule for that day while the week start moves.
	moment.updateLocale(locale, { week: { dow, doy: own.doy + dow - own.dow } });
	moment.locale(locale);
	return locale;
}

/** Put back every week rule and the global locale the plugin found. */
export function restoreLocale(): void {
	const moment = window.moment;
	for (const [locale, week] of shipped) moment.updateLocale(locale, { week });
	if (foundLocale !== null) moment.locale(foundLocale);
	shipped.clear();
	foundLocale = null;
}
