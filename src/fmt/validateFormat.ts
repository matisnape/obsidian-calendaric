// Read off the window, never imported from the package (no-restricted-imports).
type Moment = ReturnType<typeof window.moment>;
import type { ReleaseGranularity } from "../types";
import { DEFAULT_FORMATS } from "../settings/model";
import { formatWithWeekTokens, unknownTokenNames } from "../notes/noteUtils";
import { parseFilename, weekSemantics } from "./parseFilename";
import { computeNoteDate } from "./noteDate";

/** Errors block saving a format; warnings are shown and the format is saved anyway. */
export interface FormatProblems {
	errors: string[];
	warnings: string[];
}

/**
 * The Windows set, the strictest of the desktop systems: a vault synced to a
 * Windows machine has to hold every file the format writes, so what macOS
 * alone accepts is not enough (AC-FMT-05.1). `/` is absent because it is the
 * folder separator a format may use on purpose.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARACTERS = /[<>:"\\|?*\x00-\x1f]/;

/** Reserved on Windows whatever the extension, so "CON" is still reserved as "CON.md". */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Empty, or ending in a dot or a space: Windows strips or refuses those, and it
 * covers "." and "..", which would climb out of the configured folder.
 */
const UNUSABLE_SEGMENT = /^$|[. ]$/;

/**
 * The dates a format has to tell apart and read back as themselves. Each moves
 * a different field away from today: the next period, the month, the year.
 *
 * ponytail: a sample, not a proof. A format that collides only on dates none of
 * these reach passes; add probes if one is ever reported.
 */
function probeDates(today: Moment, granularity: ReleaseGranularity): Moment[] {
	return [today.clone(), today.clone().add(1, granularity), today.clone().add(40, "days"), today.clone().add(1, "year")];
}

/**
 * Whether every probe, named by `name` and parsed back with `format`, lands on
 * its own period. The writer and parser are the ones the plugin uses, so this
 * agrees with what it will actually write and find.
 */
function roundTrips(
	name: (date: Moment) => string,
	format: string,
	granularity: ReleaseGranularity,
	probes: Moment[],
): boolean {
	return probes.every((date) => {
		const parsed = parseFilename(name(date), format, false, granularity);
		return (
			parsed !== null &&
			computeNoteDate(parsed.date, granularity, format) === computeNoteDate(date, granularity, format)
		);
	});
}

/** Check a format for one granularity before it is saved. Pure: reads the clock only when `today` is left out. */
export function validateFormat(
	format: string,
	granularity: ReleaseGranularity,
	today: Moment = window.moment(),
): FormatProblems {
	// Rejected rather than filled in: a default the user never sees is what
	// AC-FMT-05.4 forbids.
	if (format.trim() === "") {
		return { errors: [`The format is empty. Enter one, for example ${DEFAULT_FORMATS[granularity]}.`], warnings: [] };
	}

	const written = (date: Moment) => formatWithWeekTokens(format, date, granularity);

	// Written as typed, so only a warning (DEC-21). It rides along with every
	// outcome below: whether the format saves is the other rules' decision.
	const unknown = unknownTokenNames(format).map(
		(name) => `"${name}" is not a token this format recognises, so {{${name}:…}} is written as typed.`,
	);

	const probes = probeDates(today, granularity);

	// Checked on what the format writes, not on its source: a `[?]` literal is
	// harmless text in the format and an illegal character in the filename. The
	// first of January and week 1 add the one-digit day, month and week numbers,
	// so `[COM]D` and `[COM]W` are caught whatever today is. The first date that
	// fails is reported, once, rather than every date.
	const oneDigit = [today.clone().startOf("year"), today.clone().isoWeek(1), today.clone().week(1)];
	const errors: string[] = [];
	for (const date of [...probes, ...oneDigit]) {
		if (errors.length > 0) break;
		for (const segment of written(date).split("/")) {
			const illegal = ILLEGAL_CHARACTERS.exec(segment);
			if (illegal) errors.push(`"${illegal[0]}" cannot appear in a filename on Windows, so "${segment}" cannot be created.`);
			else if (RESERVED_NAME.test(segment)) errors.push(`"${segment}" is a reserved filename on Windows.`);
			else if (UNUSABLE_SEGMENT.test(segment))
				errors.push(`"${segment}" cannot be a file or folder name: it is empty, or ends in a dot or a space.`);
		}
	}
	if (errors.length > 0) return { errors, warnings: unknown };

	if (!roundTrips(written, format, granularity, probes)) {
		return {
			errors: [],
			warnings: [
				...unknown,
				"This format cannot uniquely identify a note: different dates would share one filename, or a filename would not read back as its own date.",
			],
		};
	}

	// A note moved out of its dated folder is found by its filename alone, the
	// parser's last-segment fallback, so that part must name the date by itself.
	const lastSlash = format.lastIndexOf("/");
	const basename = (date: Moment) => written(date).split("/").pop() ?? "";
	if (lastSlash !== -1 && !roundTrips(basename, format, granularity, probes)) {
		// Keep the user's own week numbering: an ISO format told to use the locale
		// default would silently change which week a note belongs to.
		const dated = weekSemantics(format) === "iso" ? "GGGG-[W]WW" : DEFAULT_FORMATS[granularity];
		return {
			errors: [],
			warnings: [
				...unknown,
				`A note moved out of its dated folder would no longer be recognised: the part after the last "/" does not identify the date on its own. Workaround: repeat the whole date in the filename, for example ${format.slice(0, lastSlash)}/${dated}.`,
			],
		};
	}

	return { errors: [], warnings: unknown };
}
