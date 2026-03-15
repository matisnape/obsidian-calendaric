import moment from "moment";

// Make moment available as window.moment for production code under test
(globalThis as unknown as { window: unknown }).window = {
	moment: Object.assign(
		(...args: Parameters<typeof moment>) => moment(...args),
		moment
	),
};
