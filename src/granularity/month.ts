import type { GranularityEntry } from "./registry";

export const month = {
	id: "month",
	label: "Monthly Notes",
	adjective: "monthly",
	defaultFormat: "YYYY-MM",
	defaultEnabled: false,
	release: { unitName: "month", countKey: "MM", frontmatterFormat: "YYYY-MM" },
	cell: { subject: (date) => `The month of ${date.format("MMMM YYYY")}` },
} as const satisfies GranularityEntry;
