// AC-ARCH-05.3, at compile time. `npm run build` type-checks this file and
// vitest never runs it. `apiVersion` is typed as the current interface
// version, so an indicator written against any other version is a compile
// error, and the `@ts-expect-error` below turns the build red the day it is not.
import type { CalendarIndicator } from "./indicatorContract";

export const conforming = {
	apiVersion: 1,
	id: "conforming",
	draw() {
		return undefined;
	},
} satisfies CalendarIndicator;

export const stale = {
	// @ts-expect-error -- written against interface version 2, so its apiVersion is not the current literal
	apiVersion: 2,
	id: "stale",
	draw() {
		return undefined;
	},
} satisfies CalendarIndicator;
