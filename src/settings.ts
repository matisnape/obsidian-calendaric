import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import { DEFAULT_PERIODIC_CONFIG, PeriodicConfig } from "./types";
import { isDailyNotesPluginEnabled, getLegacyDailyNoteSettings, disableDailyNotesPlugin } from "./settings/dailyNotesImport";
import type CalendaricPlugin from "./main";

export type WeekStartOption =
	| "locale"
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday";

export interface CalendaricSettings {
	weekStart: WeekStartOption;
	showWeekNumbers: boolean;
	confirmBeforeCreate: boolean;
	overrideLocale: string;
	hasMigratedDailyNoteSettings: boolean;
	day: PeriodicConfig;
	week: PeriodicConfig;
	month: PeriodicConfig;
	quarter: PeriodicConfig;
	year: PeriodicConfig;
}

export const DEFAULT_SETTINGS: CalendaricSettings = {
	weekStart: "monday",
	showWeekNumbers: true,
	confirmBeforeCreate: true,
	overrideLocale: "",
	hasMigratedDailyNoteSettings: false,
	day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
	week: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
	month: { ...DEFAULT_PERIODIC_CONFIG },
	quarter: { ...DEFAULT_PERIODIC_CONFIG },
	year: { ...DEFAULT_PERIODIC_CONFIG },
};

export function clearStartupNote(settings: CalendaricSettings): void {
	for (const key of ["day", "week", "month", "quarter", "year"] as const) {
		settings[key].openAtStartup = false;
	}
}

const WEEK_START_OPTIONS: Record<WeekStartOption, string> = {
	locale: "Locale default",
	monday: "Monday",
	tuesday: "Tuesday",
	wednesday: "Wednesday",
	thursday: "Thursday",
	friday: "Friday",
	saturday: "Saturday",
	sunday: "Sunday",
};

type ActiveGranularity = "day" | "week";
type Granularity = ActiveGranularity | "month" | "quarter" | "year";

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

const DEFAULT_FORMAT: Record<ActiveGranularity, string> = {
	day: "YYYY-MM-DD",
	week: "gggg-[W]ww",
};

function getMoment() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (window as any).moment as typeof import("moment") | undefined;
}

export class CalendaricSettingsTab extends PluginSettingTab {
	private plugin: CalendaricPlugin;

	constructor(app: App, plugin: CalendaricPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderImportCard(containerEl);
		this.renderGeneralSection(containerEl);
		this.renderPeriodicNotesSection(containerEl);
		this.renderAdvancedSection(containerEl);
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.onSettingsChange();
	}

	// -------------------------------------------------------------------------
	// Daily Notes import card
	// -------------------------------------------------------------------------
	private renderImportCard(containerEl: HTMLElement): void {
		const { app, settings } = this.plugin;
		const isEnabled = isDailyNotesPluginEnabled(app);

		if (!isEnabled) return;

		if (settings.hasMigratedDailyNoteSettings) {
			const notice = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--info" });
			notice.createEl("strong", { text: "Daily Notes plugin is still active" });
			notice.createEl("p", {
				text: "Both plugins may create daily notes. Consider disabling the core Daily Notes plugin.",
			});
			const buttons = notice.createDiv({ cls: "calendaric-callout__buttons" });
			const disableBtn = buttons.createEl("button", { text: "Disable Daily Notes", cls: "mod-cta" });
			disableBtn.addEventListener("click", async () => {
				disableDailyNotesPlugin(app);
				await this.save();
				this.display();
			});
			const dismissBtn = buttons.createEl("button", { text: "Dismiss" });
			dismissBtn.addEventListener("click", () => {
				notice.remove();
			});
			return;
		}

		const card = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--info" });
		card.createEl("strong", { text: "Daily Notes plugin detected" });
		card.createEl("p", {
			text: "Calendaric can import your existing Daily Notes settings (format, folder, template). After import, you can disable the core Daily Notes plugin.",
		});

		const buttons = card.createDiv({ cls: "calendaric-callout__buttons" });

		const importBtn = buttons.createEl("button", { text: "Import settings", cls: "mod-cta" });
		importBtn.addEventListener("click", async () => {
			const legacy = getLegacyDailyNoteSettings(app);
			settings.day.format = legacy.format !== "" ? legacy.format : DEFAULT_FORMAT["day"];
			settings.day.folder = legacy.folder;
			settings.day.templatePath = legacy.template;
			settings.day.enabled = true;
			settings.hasMigratedDailyNoteSettings = true;
			await this.save();
			this.display();
		});

		const disableBtn = buttons.createEl("button", { text: "Disable Daily Notes plugin" });
		disableBtn.addEventListener("click", async () => {
			disableDailyNotesPlugin(app);
			settings.hasMigratedDailyNoteSettings = true;
			await this.save();
			this.display();
		});

		const dismissBtn = buttons.createEl("button", { text: "Dismiss" });
		dismissBtn.addEventListener("click", async () => {
			settings.hasMigratedDailyNoteSettings = true;
			await this.save();
			this.display();
		});
	}

	// -------------------------------------------------------------------------
	// General section
	// -------------------------------------------------------------------------
	private renderGeneralSection(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "General" });

		new Setting(containerEl)
			.setName("Start week on")
			.addDropdown((dd) => {
				for (const [value, label] of Object.entries(WEEK_START_OPTIONS)) {
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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const basePath: string = (this.app.vault.adapter as any).basePath ?? "";
			const guidePath = `${basePath}/.obsidian/plugins/obsidian-calendaric/docs/guide.md`;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const { shell } = (window as any).require("electron") as { shell: { openPath: (p: string) => void } };
			shell.openPath(guidePath);
		});
		const formatExample = formatDesc.createEl("div");
		const updateFormatExample = (fmt: string) => {
			const m = getMoment();
			const formatted = m ? m().format(fmt || DEFAULT_FORMAT[granularity]) : "";
			formatExample.empty();
			formatExample.appendText("Your current syntax looks like this: ");
			formatExample.createEl("b", { text: formatted, cls: "u-pop" });
		};
		updateFormatExample(config.format);

		const formatControl = formatItem.createDiv({ cls: "setting-item-control" });
		const formatInput = formatControl.createEl("input", {
			type: "text",
			attr: { placeholder: DEFAULT_FORMAT[granularity], spellcheck: "false" },
		});
		formatInput.value = config.format;
		formatInput.addEventListener("input", () => updateFormatExample(formatInput.value));
		formatInput.addEventListener("change", async () => {
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
		new Setting(content)
			.setName(`${capitalPeriodicity} Note Template`)
			.setDesc("Choose the file to use as a template")
			.addText((text) => {
				text.setPlaceholder("e.g. templates/template-file").setValue(config.templatePath);
				text.onChange(async (value) => {
					config.templatePath = value;
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
		const systemLocale = m ? m.locale() : "";
		const autoLabel = systemLocale ? `Same as system (${systemLocale})` : "Same as system (auto)";

		new Setting(containerEl)
			.setName("Override locale")
			.setDesc("Override the locale used for date formatting. Defaults to the system locale.")
			.addDropdown((dd) => {
				dd.addOption("", autoLabel);
				if (m) {
					for (const locale of (m.locales() as string[]).sort()) {
						dd.addOption(locale, locale);
					}
				}
				dd.setValue(this.plugin.settings.overrideLocale);
				dd.onChange(async (value) => {
					this.plugin.settings.overrideLocale = value;
					if (m) {
						m.locale(value || systemLocale);
					}
					await this.save();
				});
			});
	}
}
