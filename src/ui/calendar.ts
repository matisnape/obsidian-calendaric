import type { Moment } from "moment";
import type { CalendaricSettings } from "../settings";
import { getMonthGrid, getWeekdayHeaders, resolveWeekStart } from "./calendarUtils";

export class CalendarWidget {
	private containerEl: HTMLElement;
	private settings: CalendaricSettings;
	private displayedMonth: Moment;

	// DOM references for partial updates
	private titleEl!: HTMLElement;
	private gridBodyEl!: HTMLTableSectionElement;

	constructor(containerEl: HTMLElement, settings: CalendaricSettings) {
		this.containerEl = containerEl;
		this.settings = settings;
		this.displayedMonth = window.moment();
		this.render();
	}

	/** Full re-render. Called once on construction. */
	private render(): void {
		this.containerEl.empty();

		const wrapper = this.containerEl.createDiv({ cls: "calendaric-container" });

		// Nav header
		const nav = wrapper.createDiv({ cls: "calendaric-nav" });
		this.titleEl = nav.createEl("h3", { cls: "calendaric-title" });

		const navButtons = nav.createDiv({ cls: "calendaric-nav-buttons" });

		const svgArrow = `<svg focusable="false" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path fill="currentColor" d="M34.52 239.03L228.87 44.69c9.37-9.37 24.57-9.37 33.94 0l22.67 22.67c9.36 9.36 9.37 24.52.04 33.9L131.49 256l154.02 154.75c9.34 9.38 9.32 24.54-.04 33.9l-22.67 22.67c-9.37 9.37-24.57 9.37-33.94 0L34.52 272.97c-9.37-9.37-9.37-24.57 0-33.94z"></path></svg>`;

		const prevBtn = navButtons.createDiv({
			cls: "calendaric-nav-btn",
			attr: { "aria-label": "Previous month" },
		});
		prevBtn.innerHTML = svgArrow;
		prevBtn.addEventListener("click", () => this.goToPrevMonth());

		navButtons.createDiv({
			cls: "calendaric-today-btn",
			text: "Today",
		}).addEventListener("click", () => this.goToToday());

		const nextBtn = navButtons.createDiv({
			cls: "calendaric-nav-btn calendaric-nav-btn--next",
			attr: { "aria-label": "Next month" },
		});
		nextBtn.innerHTML = svgArrow;
		nextBtn.addEventListener("click", () => this.goToNextMonth());

		// Grid table
		const table = wrapper.createEl("table", { cls: "calendaric-grid" });
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");

		if (this.settings.showWeekNumbers) {
			headerRow.createEl("th", { cls: "calendaric-weeknum-header", text: "W" });
		}

		const weekStart = resolveWeekStart(this.settings.weekStart);
		const headers = getWeekdayHeaders(weekStart);
		for (const h of headers) {
			headerRow.createEl("th", { text: h });
		}

		this.gridBodyEl = table.createEl("tbody");
		this.renderGrid();
	}

	/** Re-render just the grid body + title (on navigation). */
	private renderGrid(): void {
		// Update title
		this.titleEl.empty();
		this.titleEl.createEl("span", {
			cls: "calendaric-month",
			text: this.displayedMonth.format("MMM"),
		});
		this.titleEl.createEl("span", {
			cls: "calendaric-year",
			text: this.displayedMonth.format("YYYY"),
		});

		// Rebuild tbody
		this.gridBodyEl.empty();

		const weekStart = resolveWeekStart(this.settings.weekStart);
		const grid = getMonthGrid(this.displayedMonth, weekStart);

		for (const week of grid) {
			const tr = this.gridBodyEl.createEl("tr");

			if (this.settings.showWeekNumbers) {
				const wTd = tr.createEl("td", { cls: "calendaric-weeknum-cell" });
				const wDiv = wTd.createDiv({ cls: "calendaric-weeknum", text: String(week.weekNumber) });
				wDiv.createDiv({ cls: "calendaric-dot-container" });
			}

			for (const day of week.days) {
				const td = tr.createEl("td");
				const classes = ["calendaric-day"];
				if (day.isToday) classes.push("is-today");
				if (day.isAdjacentMonth) classes.push("is-adjacent-month");
				const dayDiv = td.createDiv({ cls: classes.join(" "), text: String(day.date.date()) });
				dayDiv.createDiv({ cls: "calendaric-dot-container" });
			}
		}
	}

	goToPrevMonth(): void {
		this.displayedMonth = this.displayedMonth.clone().subtract(1, "month");
		this.renderGrid();
	}

	goToNextMonth(): void {
		this.displayedMonth = this.displayedMonth.clone().add(1, "month");
		this.renderGrid();
	}

	goToToday(): void {
		this.displayedMonth = window.moment();
		this.renderGrid();
	}

	/** Lightweight refresh — re-renders grid with current settings (e.g. on minute tick). */
	refresh(): void {
		this.renderGrid();
	}

	/** Full refresh after settings change — re-renders everything including the header. */
	refreshSettings(settings: CalendaricSettings): void {
		this.settings = settings;
		this.render();
	}

	destroy(): void {
		this.containerEl.empty();
	}
}
