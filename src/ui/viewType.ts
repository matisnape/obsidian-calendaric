/**
 * The calendar leaf's view type.
 *
 * It lives apart from CalendarView so that code which only needs the
 * identifier — leaf lookups, the palette command — does not have to load the
 * view class and everything it imports.
 */
export const VIEW_TYPE_CALENDAR = "calendaric-calendar";
