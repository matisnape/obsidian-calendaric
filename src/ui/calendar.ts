import type { Moment } from "moment";
import { TFile } from "obsidian";
import type { App, EventRef } from "obsidian";
import type { CalendaricSettings } from "../settings";
import { getMonthGrid, getWeekdayHeaders, resolveWeekStart } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import { createNote } from "../notes/noteCreate";
import { openNote } from "../notes/noteOpen";
import { ConfirmationModal } from "./modal";
import { DotScanner } from "./calendarDots";

const GRANULARITY_LABEL: Record<"day" | "week", string> = {
	day: "Daily",
	week: "Weekly",
};

/** Creates the same SVG dot used by the Calendar plugin (6×6 viewBox, circle r=2). */
function makeDotSvg(): SVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "calendaric-dot");
	svg.setAttribute("viewBox", "0 0 6 6");
	const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
	circle.setAttribute("cx", "3");
	circle.setAttribute("cy", "3");
	circle.setAttribute("r", "2");
	svg.appendChild(circle);
	return svg;
}

export class CalendarWidget {
	private containerEl: HTMLElement;
	private app: App;
	private settings: CalendaricSettings;
	private displayedMonth: Moment;

	// DOM references for partial updates
	private titleEl!: HTMLElement;
	private gridBodyEl!: HTMLTableSectionElement;
	private dots: DotScanner;
	private activeFilePath: string | null = null;
	private fileOpenRef: EventRef | null = null;

	constructor(containerEl: HTMLElement, app: App, settings: CalendaricSettings) {
		this.containerEl = containerEl;
		this.app = app;
		this.settings = settings;
		this.displayedMonth = window.moment();
		this.dots = new DotScanner(app, () => this.renderGrid());

		this.fileOpenRef = app.workspace.on("file-open", (file) => {
			this.activeFilePath = file?.path ?? null;
			this.renderGrid();
		});

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

		// Scan for existing notes in the visible month (cheap: vault.getFiles() is in-memory)
		const dayPaths = this.dots.getDayNotePaths(this.displayedMonth, this.settings.day);
		const weekPaths = this.dots.getWeekNotePaths(this.displayedMonth, this.settings.week);

		for (const week of grid) {
			const tr = this.gridBodyEl.createEl("tr");

			if (this.settings.showWeekNumbers) {
				const wTd = tr.createEl("td", { cls: "calendaric-weeknum-cell" });
				const wDiv = wTd.createDiv({ cls: "calendaric-weeknum", text: String(week.weekNumber) });
				const wDotContainer = wDiv.createDiv({ cls: "calendaric-dot-container" });

				// Dot: weekly note exists for the ISO Monday of this week
				const firstDay = week.days[0];
				if (firstDay) {
					const monday = firstDay.date.clone().isoWeekday(1);
					const weekPath = computeNotePath(monday, this.settings.week, this.app);
					if (weekPaths.has(weekPath)) {
						wDotContainer.appendChild(makeDotSvg());
					}
					if (weekPath === this.activeFilePath) {
						wDiv.addClass("is-active");
					}
				}

				if (this.settings.week.enabled) {
					wDiv.style.cursor = "pointer";
					wDiv.addEventListener("click", (e) => {
						if (!firstDay) return;
						const anchor = firstDay.date.clone().isoWeekday(1);
						void this.handleNoteClick(anchor, "week", e);
					});
				}
			}

			for (const day of week.days) {
				const td = tr.createEl("td");
				const classes = ["calendaric-day"];
				if (day.isToday) classes.push("is-today");
				if (day.isAdjacentMonth) classes.push("is-adjacent-month");
				const dayDiv = td.createDiv({ cls: classes.join(" "), text: String(day.date.date()) });
				const dayDotContainer = dayDiv.createDiv({ cls: "calendaric-dot-container" });

				// Dot: daily note exists for this date
				const dayPath = computeNotePath(day.date, this.settings.day, this.app);
				if (dayPaths.has(dayPath)) {
					dayDotContainer.appendChild(makeDotSvg());
				}
				if (dayPath === this.activeFilePath) {
					dayDiv.addClass("is-active");
				}

				if (this.settings.day.enabled) {
					dayDiv.style.cursor = "pointer";
					dayDiv.addEventListener("click", (e) => {
						void this.handleNoteClick(day.date, "day", e);
					});
				}
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

	private async handleNoteClick(
		date: Moment,
		granularity: "day" | "week",
		event: MouseEvent,
	): Promise<void> {
		const config = this.settings[granularity];
		const path = computeNotePath(date, config, this.app);
		const existing = this.app.vault.getAbstractFileByPath(path);

		if (existing) {
			if (existing instanceof TFile) {
				await openNote(existing, event, this.app);
			}
			return;
		}

		const filename = path.split("/").pop() ?? path;
		const label = GRANULARITY_LABEL[granularity];

		if (this.settings.confirmBeforeCreate) {
			new ConfirmationModal(this.app, {
				title: `New ${label} Note`,
				body: `File ${filename} does not exist. Would you like to create it?`,
				onAccept: async () => {
					const file = await createNote(date, granularity, config, this.app);
					await openNote(file, event, this.app);
				},
			}).open();
		} else {
			const file = await createNote(date, granularity, config, this.app);
			await openNote(file, event, this.app);
		}
	}

	destroy(): void {
		if (this.fileOpenRef) {
			this.app.workspace.offref(this.fileOpenRef);
			this.fileOpenRef = null;
		}
		this.dots.destroy();
		this.containerEl.empty();
	}
}
