import type { Moment } from "moment";
import type { PeriodicConfig } from "../types";
import { formatWithWeekTokens, applyWeekTokens } from "./noteUtils";

type Granularity = "day" | "week";

/**
 * Substitute all Calendaric template body variables in `content`.
 *
 * Universal:
 *   {{date}}           → note's configured format (with week tokens evaluated)
 *   {{date:fmt}}       → date with custom moment format
 *   {{time}}           → current time HH:mm
 *   {{title}}          → the note's filename (without extension)
 *
 * Daily only:
 *   {{yesterday}}      → previous day in configured format
 *   {{tomorrow}}       → next day in configured format
 *
 * Weekly only:
 *   {{monday:fmt}} – {{sunday:fmt}}  → that weekday within the note's week
 */
export function substituteTemplateTokens(
	content: string,
	date: Moment,
	granularity: Granularity,
	config: PeriodicConfig,
	title: string,
): string {
	let out = content;

	// {{date:custom}} — must be replaced before {{date}} to avoid double-match
	out = out.replace(/\{\{date:([^}]+)\}\}/g, (_m, fmt: string) => date.format(fmt));

	// {{date}} — uses the granularity's configured format (with week tokens)
	const dateStr = formatWithWeekTokens(config.format, date);
	out = out.replace(/\{\{date\}\}/g, dateStr);

	// {{time}}
	out = out.replace(/\{\{time\}\}/g, date.format("HH:mm"));

	// {{title}}
	out = out.replace(/\{\{title\}\}/g, title);

	if (granularity === "day") {
		// These tokens exist to link to the adjacent notes, and computeNotePath() names
		// those files with formatWithWeekTokens(). Plain format() would diverge from it.
		const yesterday = formatWithWeekTokens(config.format, date.clone().subtract(1, "day"));
		const tomorrow = formatWithWeekTokens(config.format, date.clone().add(1, "day"));
		out = out.replace(/\{\{yesterday\}\}/g, yesterday);
		out = out.replace(/\{\{tomorrow\}\}/g, tomorrow);
	}

	if (granularity === "week") {
		// {{monday:fmt}} – {{sunday:fmt}} in template body
		out = applyWeekTokens(out, date);
	}

	return out;
}
