import type { GranularityEntry } from "./registry";

export const day = {
	id: "day",
	label: "Daily Notes",
	adjective: "daily",
	defaultFormat: "YYYY-MM-DD",
	defaultEnabled: true,
	release: {
		unitName: "day",
		countKey: "dd",
		frontmatterFormat: "YYYY-MM-DD",
		nearNames: { [-1]: "Yesterday", 0: "Today", 1: "Tomorrow" },
	},
	cell: {
		subject: (date) => date.format("dddd, LL"),
		reveal: (date) => [date, date],
	},
	settings: { prefixMatchExample: "2026-02-09, travel day" },
	neighbourTokens: { previous: "yesterday", next: "tomorrow" },
} as const satisfies GranularityEntry;
