import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type { Granularity, PeriodicConfig } from "./types";
import { clearStartupNote, DEFAULT_FORMATS } from "./settings/model";
import type { WeekStartOption } from "./settings/model";
import { renderDailyNotesImportCard } from "./settings/dailyNotesImportCard";
import { renderPeriodicNotesImportCard } from "./settings/periodicNotesImportCard";
import type { CompanionPluginPort, PeriodicNotesPort } from "./adapters/companionPluginPort";
import type { DesktopShellPort } from "./adapters/desktopShellPort";
import type { VaultPort } from "./adapters/vaultPort";
import { validateTemplatePath } from "./notes/validateTemplatePath";
import { validateFormat } from "./fmt/validateFormat";
import type CalendaricPlugin from "./main";

// The configuration model lives in ./settings/model, which knows nothing about
// Obsidian. Re-exported here so the rest of the plugin keeps one import path.
export { DEFAULT_SETTINGS, clearStartupNote } from "./settings/model";
export type { CalendaricSettings, WeekStartOption } from "./settings/model";

const WEEK_START_LABELS: Record<WeekStartOption, string> = {
	locale: "Locale default",
	monday: "Monday",
	tuesday: "Tuesday",
	wednesday: "Wednesday",
	thursday: "Thursday",
	friday: "Friday",
	saturday: "Saturday",
	sunday: "Sunday",
};

/** The granularities whose settings the screen can edit today. */
type ActiveGranularity = "day" | "week";

/** The format and template guide, shipped inside the plugin's own folder. */
const FORMAT_GUIDE_PATH = "docs/guide.md";

const GRANULARITY_LABELS: Record<Granularity, string> = {
	day: "Daily Notes",
	week: "Weekly Notes",
	month: "Monthly Notes",
	quarter: "Quarterly Notes",
	year: "Yearly Notes",
};

const GRANULARITY_PERIODICITY: Record<Granularity, string> = {
	day: "daily",
	week: "weekly",
	month: "monthly",
	quarter: "quarterly",
	year: "yearly",
};

/** A filename that starts with this granularity's date and then carries extra text. */
const PREFIX_MATCH_EXAMPLE: Record<ActiveGranularity, string> = {
	day: "2026-02-09, travel day",
	week: "2026-W07, 09.02 - 15.02",
};

function getMoment() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (window as any).moment as typeof import("moment") | undefined;
}

/**
 * AC-ARCH-07.1: draws one section of the settings tab and contains a failure to
 * that section.
 *
 * `containerEl` belongs to Obsidian, and so do the UI classes drawn into it.
 * Obsidian reshapes both between versions -- the 1.13 settings dialog is what
 * crashed the Periodic Notes pane -- and a section that throws against a
 * changed host would otherwise abort `display()` part-way and leave the tab
 * showing whatever had been drawn up to that point.
 *
 * So the nodes that section added are taken back out, and the user is told
 * which part is missing rather than left looking at a gap. Sections after it
 * still render, because each call has its own guard.
 *
 * The recovery path itself uses `createDiv`, which Obsidian also owns. A host
 * that no longer provides it renders nothing at all, guard included; that is
 * the outer edge of what a plugin can catch from inside.
 */
function renderGuardedSection(containerEl: HTMLElement, label: string, render: () => void): void {
	const before = containerEl.childNodes.length;
	try {
		render();
	} catch (error) {
		while (containerEl.childNodes.length > before) {
			const partial = containerEl.lastChild;
			if (partial === null) break;
			containerEl.removeChild(partial);
		}
		console.error(`Calendaric: the ${label} settings section could not be rendered`, error);
		const notice = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--warning" });
		notice.createEl("strong", { text: `${label} is unavailable` });
		notice.createEl("p", {
			text: "This part of the settings screen does not work with this version of Obsidian. Everything else on this screen is unaffected.",
		});
	}
}

/**
 * What this screen needs from outside its own layer, as interfaces.
 *
 * Both are host capabilities, and neither implementation is named here:
 * src/main.ts is where a port meets the adapter behind it, which is the one
 * allowed direction US-ARCH-01 is about.
 */
export interface SettingsTabPorts {
	/** Reads and writes another plugin's settings. Typed because its shape is not ours. */
	readonly companion: CompanionPluginPort;
	/** Reads the Periodic Notes plugin's active calendar set, for the import card. */
	readonly periodicNotes: Pick<PeriodicNotesPort, "readActiveCalendarSet">;
	/** Opens a file in the operating system. Absent on mobile. */
	readonly desktop: DesktopShellPort;
	/**
	 * Resolves a path against the vault, so a configured template can be
	 * checked while it is being typed rather than when a note is first created
	 * from it (US-TPL-04).
	 */
	readonly vault: VaultPort;
}

export class CalendaricSettingsTab extends PluginSettingTab {
	private plugin: CalendaricPlugin;
	private ports: SettingsTabPorts;

	constructor(app: App, plugin: CalendaricPlugin, ports: SettingsTabPorts) {
		super(app, plugin);
		this.plugin = plugin;
		this.ports = ports;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// AC-ARCH-07.1: one guard per section, so a host change costs the section
		// that touches it and nothing else.
		renderGuardedSection(containerEl, "Daily Notes import", () => {
			renderDailyNotesImportCard(containerEl, this.plugin, this.ports.companion, {
				save: () => this.save(),
				refresh: () => this.display(),
			});
		});
		renderGuardedSection(containerEl, "Periodic Notes import", () => {
			renderPeriodicNotesImportCard(containerEl, this.plugin, this.ports.periodicNotes, {
				save: () => this.save(),
				refresh: () => this.display(),
			});
		});
		renderGuardedSection(containerEl, "General", () => this.renderGeneralSection(containerEl));
		renderGuardedSection(containerEl, "Periodic Notes", () => this.renderPeriodicNotesSection(containerEl));
		renderGuardedSection(containerEl, "Advanced", () => this.renderAdvancedSection(containerEl));
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.onSettingsChange();
	}

	// -------------------------------------------------------------------------
	// General section
	// -------------------------------------------------------------------------
	private renderGeneralSection(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "General" });

		new Setting(containerEl)
			.setName("Start week on")
			.addDropdown((dd) => {
				for (const [value, label] of Object.entries(WEEK_START_LABELS)) {
					dd.addOption(value, label);
				}
				dd.setValue(this.plugin.settings.weekStart);
				dd.onChange(async (value) => {
					this.plugin.settings.weekStart = value as WeekStartOption;
					await this.save();
				});
			});

		new Setting(containerEl)
			.setName("Confirm before creating new note")
			.setDesc("Show a confirmation modal before creating a new periodic note.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.confirmBeforeCreate);
				toggle.onChange(async (value) => {
					this.plugin.settings.confirmBeforeCreate = value;
					await this.save();
				});
			});

		new Setting(containerEl)
			.setName("Show week numbers")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showWeekNumbers);
				toggle.onChange(async (value) => {
					this.plugin.settings.showWeekNumbers = value;
					await this.save();
				});
			});

		new Setting(containerEl)
			.setName("Show period label")
			.setDesc("Label each open periodic note with the period it belongs to.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showPeriodLabel);
				toggle.onChange(async (value) => {
					this.plugin.settings.showPeriodLabel = value;
					await this.save();
				});
			});
	}

	// -------------------------------------------------------------------------
	// Periodic Notes section
	// -------------------------------------------------------------------------
	private renderPeriodicNotesSection(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Periodic Notes" });

		for (const granularity of ["day", "week"] as const) {
			this.renderPeriodicGroup(containerEl, granularity);
		}

		for (const label of ["Monthly Notes", "Quarterly Notes", "Yearly Notes", "Custom Notes"]) {
			this.renderPlaceholderGroup(containerEl, label);
		}
	}

	private renderPeriodicGroup(containerEl: HTMLElement, granularity: ActiveGranularity): void {
		const config = this.plugin.settings[granularity];
		const label = GRANULARITY_LABELS[granularity];
		const periodicity = GRANULARITY_PERIODICITY[granularity];

		// Track expand state locally on the DOM element
		const group = containerEl.createDiv({ cls: "periodic-group" });
		let isExpanded = false;

		// ---- Heading row (matches Periodic Notes' setting-item setting-item-heading) ----
		const heading = group.createDiv({ cls: "setting-item setting-item-heading periodic-group-heading" });

		// Left: arrow + title
		const infoEl = heading.createDiv({ cls: "setting-item-info" });
		const nameEl = infoEl.createEl("h3", { cls: "setting-item-name periodic-group-title" });

		const arrowEl = nameEl.createDiv({ cls: "arrow" });
		setIcon(arrowEl, "chevron-right");

		nameEl.createSpan({ text: label });

		if (config.openAtStartup) {
			nameEl.createEl("span", { text: "Opens at startup", cls: "badge" });
		}

		// Right: toggle — stopPropagation so clicking it doesn't toggle expand
		const controlEl = heading.createDiv({ cls: "setting-item-control" });
		new Setting(controlEl)
			.addToggle((toggle) => {
				toggle.setValue(config.enabled);
				toggle.toggleEl.addEventListener("click", (e) => e.stopPropagation());
				toggle.onChange(async (value) => {
					config.enabled = value;
					await this.save();
					// Re-render just the badge if openAtStartup status changed
					// (no full display() needed — toggle state is independent of expand)
				});
			});

		// Content area
		const content = group.createDiv({ cls: "periodic-group-content" });
		content.style.display = "none";

		// Toggle expand on heading click
		heading.addEventListener("click", () => {
			isExpanded = !isExpanded;
			arrowEl.toggleClass("expanded", isExpanded);
			content.style.display = isExpanded ? "" : "none";
		});

		this.renderPeriodicGroupContent(content, granularity, config, periodicity);
	}

	private renderPeriodicGroupContent(
		content: HTMLElement,
		granularity: ActiveGranularity,
		config: PeriodicConfig,
		periodicity: string,
	): void {
		// Format
		const formatItem = content.createDiv({ cls: "setting-item" });
		const formatInfo = formatItem.createDiv({ cls: "setting-item-info" });
		formatInfo.createDiv({ cls: "setting-item-name", text: "Format" });
		const formatDesc = formatInfo.createDiv({ cls: "setting-item-description" });
		const syntaxLink = formatDesc.createEl("a", {
			text: "Syntax reference",
			href: "https://momentjs.com/docs/#/displaying/format/",
		});
		syntaxLink.setAttr("target", "_blank");
		syntaxLink.setAttr("rel", "noopener");
		formatDesc.appendText(" · ");
		const guideLink = formatDesc.createEl("a", { text: "Format & template guide", href: "#" });
		guideLink.addEventListener("click", (e) => {
			e.preventDefault();
			this.ports.desktop.openPluginFile(FORMAT_GUIDE_PATH);
		});
		const formatExample = formatDesc.createEl("div");
		const updateFormatExample = (fmt: string) => {
			const m = getMoment();
			const formatted = m && fmt ? m().format(fmt) : "";
			formatExample.empty();
			formatExample.appendText("Your current syntax looks like this: ");
			formatExample.createEl("b", { text: formatted, cls: "u-pop" });
		};
		// An unset stored format is the documented built-in default (AC-SET-03.1),
		// and the placeholder says which. What the user types is shown as typed,
		// so an emptied field previews nothing instead of a hidden default.
		updateFormatExample(config.format || DEFAULT_FORMATS[granularity]);

		// US-FMT-05: errors keep the previous format saved, warnings save anyway.
		const formatProblem = formatDesc.createDiv({ cls: "calendaric-setting-problem" });
		const showFormatProblems = (fmt: string, errorOutcome = "Not saved:") => {
			const problems = validateFormat(fmt, granularity);
			formatProblem.empty();
			// Both share the error colour, so the words say which outcome it was.
			const messages = [...problems.errors, ...problems.warnings];
			const outcome = problems.errors.length > 0 ? errorOutcome : "Saved, but:";
			if (messages.length > 0) formatProblem.appendText([outcome, ...messages].join(" "));
			return problems;
		};
		// A stored format that warns says so when the tab reopens, not only on edit.
		// One with an error was stored before this check or by hand, and is in use.
		showFormatProblems(config.format || DEFAULT_FORMATS[granularity], "In use, but:");

		const formatControl = formatItem.createDiv({ cls: "setting-item-control" });
		const formatInput = formatControl.createEl("input", {
			type: "text",
			attr: { placeholder: DEFAULT_FORMATS[granularity], spellcheck: "false" },
		});
		formatInput.value = config.format;
		formatInput.addEventListener("input", () => {
			updateFormatExample(formatInput.value);
			showFormatProblems(formatInput.value);
		});
		formatInput.addEventListener("change", async () => {
			if (showFormatProblems(formatInput.value).errors.length > 0) return;
			config.format = formatInput.value;
			await this.save();
		});

		// Note Folder
		new Setting(content)
			.setName("Note Folder")
			.setDesc(`New ${periodicity} notes will be placed here`)
			.addText((text) => {
				text.setPlaceholder("e.g. folder 1/folder 2").setValue(config.folder);
				text.onChange(async (value) => {
					config.folder = value;
					await this.save();
				});
			});

		// Template
		const capitalPeriodicity = periodicity.charAt(0).toUpperCase() + periodicity.slice(1);
		const templateSetting = new Setting(content)
			.setName(`${capitalPeriodicity} Note Template`)
			.setDesc("Choose the file to use as a template");

		// The whole point of US-TPL-04: a bad template path says so here, where
		// it was typed, instead of waiting for the first note created from it.
		// Emptied and refilled rather than assigned, because an empty message is
		// how "nothing wrong" is drawn and `setText` is not in the DOM shim.
		const templateProblem = templateSetting.descEl.createDiv({ cls: "calendaric-setting-problem" });
		const showTemplateProblem = (value: string): void => {
			const problem = validateTemplatePath(value, this.ports.vault);
			templateProblem.empty();
			if (problem) templateProblem.appendText(problem.message);
		};
		showTemplateProblem(config.templatePath);

		templateSetting.addText((text) => {
			text.setPlaceholder("e.g. templates/template-file").setValue(config.templatePath);
			text.onChange(async (value) => {
				config.templatePath = value;
				showTemplateProblem(value);
				await this.save();
			});
		});

		// Allow prefix matching
		new Setting(content)
			.setName("Allow prefix matching")
			.setDesc(
				`Also recognise a ${periodicity} note whose filename starts with the date and then carries extra text, e.g. "${PREFIX_MATCH_EXAMPLE[granularity]}".`,
			)
			.addToggle((toggle) => {
				toggle.setValue(config.allowPrefixMatch);
				toggle.onChange(async (value) => {
					config.allowPrefixMatch = value;
					await this.save();
				});
			});

		// Open on startup
		new Setting(content)
			.setName("Open on startup")
			.setDesc(`Opens your ${periodicity} note automatically whenever you open this vault`)
			.addToggle((toggle) => {
				toggle.setValue(config.openAtStartup);
				toggle.onChange(async (value) => {
					if (value) {
						clearStartupNote(this.plugin.settings);
					}
					config.openAtStartup = value;
					await this.save();
					this.display();
				});
			});
	}

	private renderPlaceholderGroup(containerEl: HTMLElement, label: string): void {
		const group = containerEl.createDiv({ cls: "periodic-group" });
		const heading = group.createDiv({ cls: "setting-item setting-item-heading periodic-group-heading" });

		const infoEl = heading.createDiv({ cls: "setting-item-info" });
		const nameEl = infoEl.createEl("h3", { cls: "setting-item-name periodic-group-title" });
		const arrowEl = nameEl.createDiv({ cls: "arrow" });
		setIcon(arrowEl, "chevron-right");
		nameEl.createSpan({ text: label });

		const controlEl = heading.createDiv({ cls: "setting-item-control" });
		new Setting(controlEl)
			.addToggle((toggle) => {
				toggle.setValue(false);
				toggle.setDisabled(true);
			});
	}

	// -------------------------------------------------------------------------
	// Advanced section
	// -------------------------------------------------------------------------
	private renderAdvancedSection(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Advanced" });

		const m = getMoment();

		new Setting(containerEl)
			.setName("Override locale")
			.setDesc("Override the locale used for date formatting. Defaults to Obsidian's language.")
			.addDropdown((dd) => {
				dd.addOption("", "Same as Obsidian");
				if (m) {
					for (const locale of (m.locales() as string[]).sort()) {
						dd.addOption(locale, locale);
					}
				}
				dd.setValue(this.plugin.settings.overrideLocale);
				dd.onChange(async (value) => {
					// Saving applies it: the plugin resolves and sets the locale in one place.
					this.plugin.settings.overrideLocale = value;
					await this.save();
				});
			});
	}
}
