import type { GranularityEntry } from "./registry";

/** Reserved (DEC-23): configuration carries it, and no release-1 behaviour acts on it. */
export const quarter = {
	id: "quarter",
	label: "Quarterly Notes",
	adjective: "quarterly",
	defaultFormat: "YYYY-[Q]Q",
	defaultEnabled: false,
} as const satisfies GranularityEntry;
