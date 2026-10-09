import type { CalendarIndicator } from "../../indicatorContract";
import { noteDotIndicator } from "./noteDot";
import { wordCountDotIndicator } from "./wordCountDot";

/**
 * Every indicator the calendar draws, in drawing order. Adding one is a new
 * module beside these and one entry here; the renderer names none of them.
 */
export const CALENDAR_INDICATORS: readonly CalendarIndicator[] = [noteDotIndicator, wordCountDotIndicator];
