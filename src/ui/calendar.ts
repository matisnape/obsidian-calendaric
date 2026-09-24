import type { Moment } from "moment";
import { Menu } from "obsidian";
import type { App, EventRef, HoverParent, HoverPopover } from "obsidian";
import type { CalendaricSettings } from "../settings";
import { getMonthGrid, getWeekAnchor, getWeekdayHeaders, resolveWeekStart } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import type { CalendarDeps } from "../adapters/calendarDeps";
import { ConfirmationModal } from "./modal";
import { DEFAULT_WORDS_PER_SEGMENT, DotScanner, WORD_DOT_SEGMENTS, wordCountSegments } from "./calendarDots";
import { MonthNavigation } from "./calendarNav";
import { HOVER_LINK_SOURCE, hoverPreviewRequest, openOrCreateNote, type CreateRequest } from "./cellActions";

/** Creates the same SVG dot used by the Calendar plugin (6×6 viewBox, circle r=2). */
function makeDotSvg(): SVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "calendaric-dot calendaric-dot--exists");
	svg.setAttribute("viewBox", "0 0 6 6");
	const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
	circle.setAttribute("cx", "3");
	circle.setAttribute("cy", "3");
	circle.setAttribute("r", "2");
	svg.appendChild(circle);
	return svg;
}

/**
 * The word-count dot: a 6×6 pie of five wedges, the first `filled` of them,
 * clockwise from the top, marked `is-filled`.
 */
function makeWordDotSvg(filled: number): SVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "calendaric-dot calendaric-dot--words");
	svg.setAttribute("viewBox", "0 0 6 6");
	const point = (i: number) => {
		const angle = -Math.PI / 2 + (i * 2 * Math.PI) / WORD_DOT_SEGMENTS;
		return `${(3 + 3 * Math.cos(angle)).toFixed(3)} ${(3 + 3 * Math.sin(angle)).toFixed(3)}`;
	};
	for (let i = 0; i < WORD_DOT_SEGMENTS; i++) {
		const wedge = document.createElementNS("http://www.w3.org/2000/svg", "path");
		wedge.setAttribute("d", `M3 3 L${point(i)} A3 3 0 0 1 ${point(i + 1)} Z`);
		wedge.setAttribute("class", i < filled ? "calendaric-dot-segment is-filled" : "calendaric-dot-segment");
		svg.appendChild(wedge);
	}
	return svg;
}

export class CalendarWidget implements HoverParent {
	/** Page preview writes the popover it opens for a cell here. */
	hoverPopover: HoverPopover | null = null;

	private containerEl: HTMLElement;
	private app: App;
	private settings: CalendaricSettings;
	private nav: MonthNavigation;

	// DOM references for partial updates
	private titleEl!: HTMLElement;
	private todayBtnEl!: HTMLElement;
	private gridBodyEl!: HTMLTableSectionElement;
	private dots: DotScanner;
	private activeFilePath: string | null = null;
	private fileOpenRef: EventRef | null = null;

	/**
	 * `deps` is required and has no default (AC-ARCH-11.5): a widget that could
	 * fall back to building its own adapters would be one Obsidian import away
	 * from the layering rule again, and nothing would say so.
	 */
	constructor(
		containerEl: HTMLElement,
		app: App,
		settings: CalendaricSettings,
		private deps: CalendarDeps,
	) {
		this.containerEl = containerEl;
		this.app = app;
		this.settings = settings;
		this.nav = new MonthNavigation(
			() => window.moment(),
			() => this.renderGrid(),
		);
		this.dots = new DotScanner(deps, () => this.renderGrid());

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
		// "calendaric-month-header" is this element's own contract: the class the
		// open/reset/context-menu behaviour below is wired to (AC-CAL-05.5). The
		// month/year spans renderGrid() fills it with are for display only and
		// are rebuilt on every navigation, so nothing here may be identified by
		// matching them.
		this.titleEl = nav.createEl("h3", { cls: "calendaric-title calendaric-month-header" });
		this.titleEl.setAttribute("aria-label", "Open this month's note");
		this.titleEl.addEventListener("click", (e) => {
			void this.handleMonthHeaderClick(e);
		});
		this.titleEl.addEventListener("contextmenu", (e) => {
			this.handleMonthHeaderContextMenu(e);
		});

		const navButtons = nav.createDiv({ cls: "calendaric-nav-buttons" });

		const svgArrow = `<svg focusable="false" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><path fill="currentColor" d="M34.52 239.03L228.87 44.69c9.37-9.37 24.57-9.37 33.94 0l22.67 22.67c9.36 9.36 9.37 24.52.04 33.9L131.49 256l154.02 154.75c9.34 9.38 9.32 24.54-.04 33.9l-22.67 22.67c-9.37 9.37-24.57 9.37-33.94 0L34.52 272.97c-9.37-9.37-9.37-24.57 0-33.94z"></path></svg>`;

		const prevBtn = navButtons.createDiv({
			cls: "calendaric-nav-btn",
			attr: { "aria-label": "Previous month" },
		});
		prevBtn.innerHTML = svgArrow;
		prevBtn.addEventListener("click", () => this.nav.prev());

		this.todayBtnEl = navButtons.createDiv({
			cls: "calendaric-today-btn",
			text: "Today",
		});
		// The control decides nothing itself: MonthNavigation is inert on the
		// current month, so a click here while the button reads as inactive
		// changes no month and asks for no re-render.
		this.todayBtnEl.addEventListener("click", () => this.nav.toToday());

		const nextBtn = navButtons.createDiv({
			cls: "calendaric-nav-btn calendaric-nav-btn--next",
			attr: { "aria-label": "Next month" },
		});
		nextBtn.innerHTML = svgArrow;
		nextBtn.addEventListener("click", () => this.nav.next());

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
		// Re-read the global locale: the held month keeps the one it was made under (AC-FMT-03.3).
		const displayedMonth = this.nav.month.clone().locale(window.moment.locale());

		// Update title
		this.titleEl.empty();
		this.titleEl.createEl("span", {
			cls: "calendaric-month",
			text: displayedMonth.format("MMM"),
		});
		this.titleEl.createEl("span", {
			cls: "calendaric-year",
			text: displayedMonth.format("YYYY"),
		});

		// Nothing to return to while the grid already shows the current month.
		const atCurrentMonth = this.nav.atCurrentMonth;
		this.todayBtnEl.toggleClass("is-disabled", atCurrentMonth);
		this.todayBtnEl.setAttribute("aria-disabled", String(atCurrentMonth));

		// Rebuild tbody
		this.gridBodyEl.empty();

		const weekStart = resolveWeekStart(this.settings.weekStart);
		const grid = getMonthGrid(displayedMonth, weekStart, this.settings.week.format);

		// Scan for existing notes in the visible month (cheap: vault.getFiles() is in-memory)
		const dayPaths = this.dots.getDayNotePaths(displayedMonth, this.settings.day);
		const weekPaths = this.dots.getWeekNotePaths(grid, this.settings.week);
		// Filled in once the notes are read; see drawWordDots.
		const wordDotSlots: [string, HTMLElement][] = [];

		for (const week of grid) {
			const tr = this.gridBodyEl.createEl("tr");

			if (this.settings.showWeekNumbers) {
				const wTd = tr.createEl("td", { cls: "calendaric-weeknum-cell" });
				const wDiv = wTd.createDiv({ cls: "calendaric-weeknum", text: String(week.weekNumber) });
				const wDotContainer = wDiv.createDiv({ cls: "calendaric-dot-container" });

				// Dot: weekly note exists for the week this row shows
				const anchor = getWeekAnchor(week.days);
				const weekPath = computeNotePath(anchor, this.settings.week, this.deps.vaultConfig);
				if (weekPaths.has(weekPath)) {
					wDotContainer.appendChild(makeDotSvg());
					wordDotSlots.push([weekPath, wDotContainer]);
				}
				if (weekPath === this.activeFilePath) {
					wDiv.addClass("is-active");
				}

				if (this.settings.week.enabled) {
					wDiv.style.cursor = "pointer";
					wDiv.addEventListener("click", (e) => {
						void this.handleNoteClick(anchor.clone(), "week", e);
					});
					// The hover previews `weekPath`, which is the path the click
					// above resolves from the same anchor — one reference date per
					// row, whatever the week starts on (DEC-06).
					wDiv.addEventListener("mouseover", (e) => {
						this.handleNoteHover(e, wDiv, weekPath);
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
				const dayPath = computeNotePath(day.date, this.settings.day, this.deps.vaultConfig);
				if (dayPaths.has(dayPath)) {
					dayDotContainer.appendChild(makeDotSvg());
					wordDotSlots.push([dayPath, dayDotContainer]);
				}
				if (dayPath === this.activeFilePath) {
					dayDiv.addClass("is-active");
				}

				if (this.settings.day.enabled) {
					dayDiv.style.cursor = "pointer";
					dayDiv.addEventListener("click", (e) => {
						void this.handleNoteClick(day.date, "day", e);
					});
					dayDiv.addEventListener("mouseover", (e) => {
						this.handleNoteHover(e, dayDiv, dayPath);
					});
				}
			}
		}

		void this.drawWordDots(wordDotSlots);
	}

	/**
	 * The word-count dot of every cell whose note exists (AC-CAL-07.2). It
	 * arrives after the note-exists dot because reading a note is async; a
	 * render that lands meanwhile has already detached these containers, so a
	 * late append to one shows nothing.
	 */
	private async drawWordDots(slots: [string, HTMLElement][]): Promise<void> {
		const counts = await this.dots.getWordCounts(slots.map(([path]) => path));
		for (const [path, container] of slots) {
			// ponytail: threshold is the default until a setting carries one
			const filled = wordCountSegments(counts.get(path) ?? 0, DEFAULT_WORDS_PER_SEGMENT);
			if (filled > 0) container.appendChild(makeWordDotSvg(filled));
		}
	}

	/** Lightweight refresh — re-renders grid with current settings (e.g. on minute tick). */
	refresh(): void {
		this.nav.followClock();
		this.renderGrid();
	}

	/** Full refresh after settings change — re-renders everything including the header. */
	refreshSettings(settings: CalendaricSettings): void {
		this.settings = settings;
		this.render();
	}

	/**
	 * The month header's own click: open or create the displayed month's note,
	 * or — when monthly notes are not configured at all — fall back to what the
	 * dedicated "return to today" control does (AC-CAL-05.3). Never touches the
	 * grid itself, so the displayed month survives the click either way
	 * (AC-CAL-05.1).
	 */
	private async handleMonthHeaderClick(event: MouseEvent): Promise<void> {
		if (!this.settings.month.enabled) {
			this.nav.toToday();
			return;
		}
		await this.handleNoteClick(this.nav.month, "month", event);
	}

	/**
	 * The month header's file context menu (AC-CAL-05.4): only for a month that
	 * already has a note. `file-menu` is the same workspace event a file
	 * explorer row triggers, so every plugin that adds items there — including
	 * Obsidian's own "Open in new tab" / "Delete" — populates this menu too.
	 */
	private handleMonthHeaderContextMenu(event: MouseEvent): void {
		const path = computeNotePath(this.nav.month, this.settings.month, this.deps.vaultConfig);
		const file = this.deps.vault.getFile(path);
		if (!file) return;

		event.preventDefault();
		const menu = new Menu();
		this.app.workspace.trigger("file-menu", menu, file, HOVER_LINK_SOURCE);
		menu.showAtMouseEvent(event);
	}

	private async handleNoteClick(
		date: Moment,
		granularity: "day" | "week" | "month",
		event: MouseEvent,
	): Promise<void> {
		try {
			await openOrCreateNote({
				date,
				granularity,
				config: this.settings[granularity],
				confirmBeforeCreate: this.settings.confirmBeforeCreate,
				event,
				ports: this.deps,
				confirmCreate: (request) => this.askToCreate(request),
			});
		} catch (error) {
			// The click is the last caller: an unhandled rejection here would be
			// a cell that silently does nothing. The notice rides the workspace
			// port, the way US-NOTE-06 reports a note that vanished.
			this.deps.workspace.showNotice(
				error instanceof Error ? error.message : "Calendaric could not open that note.",
			);
		}
	}

	private askToCreate(request: CreateRequest): Promise<boolean> {
		return new Promise((resolve) => {
			new ConfirmationModal(this.app, {
				title: request.title,
				body: request.body,
				onAccept: async () => resolve(true),
				onDismiss: () => resolve(false),
			}).open();
		});
	}

	/** Hands the hover to Obsidian's Page preview plugin, which owns both the popover and its modifier gate. */
	private handleNoteHover(event: MouseEvent, targetEl: HTMLElement, notePath: string): void {
		this.app.workspace.trigger(
			"hover-link",
			hoverPreviewRequest({ event, hoverParent: this, targetEl, notePath }),
		);
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
