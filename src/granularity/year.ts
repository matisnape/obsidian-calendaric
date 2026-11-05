import type { GranularityEntry } from "./registry";

export const year = {
	id: "year",
	label: "Yearly Notes",
	adjective: "yearly",
	defaultFormat: "YYYY",
	defaultEnabled: false,
	release: { unitName: "year", countKey: "yy", frontmatterFormat: "YYYY" },
	settings: { prefixMatchExample: "2026, year in review" },
} as const satisfies GranularityEntry;
