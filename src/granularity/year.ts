import type { GranularityEntry } from "./registry";

export const year = {
	id: "year",
	label: "Yearly Notes",
	adjective: "yearly",
	defaultFormat: "YYYY",
	defaultEnabled: false,
	release: { unitName: "year", countKey: "yy", frontmatterFormat: "YYYY" },
} as const satisfies GranularityEntry;
