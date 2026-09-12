import { Notice, Plugin, TFile } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import { applySettings, defaultStoredConfig, DEFAULT_SETTINGS, loadStoredConfig, toSettings } from "./settings/model";
import type { CalendaricSettings, StoredConfig } from "./settings/model";
import { CalendarView } from "./ui/CalendarView";
import { VIEW_TYPE_CALENDAR } from "./ui/viewType";
import { computeNotePath } from "./notes/noteUtils";
import { createPeriodicNote } from "./notes/noteCreate";
import { RELEASE_GRANULARITIES } from "./types";
import type { ReleaseGranularity } from "./types";
import { openNoteIn, openNoteInNewTab } from "./notes/noteOpen";
import { ObsidianVaultAdapter } from "./adapters/obsidianVaultAdapter";
import { ObsidianWorkspaceAdapter } from "./adapters/obsidianWorkspaceAdapter";
import { ObsidianVaultConfigAdapter } from "./adapters/obsidianVaultConfigAdapter";
import { ObsidianCalendarLeafAdapter } from "./adapters/obsidianCalendarLeafAdapter";
import { calendarViewCommand, createCalendarCoordinator } from "./ui/calendarCommand";
import { PeriodicNoteIndex } from "./notes/periodicNoteIndex";
import type { JumpDirection, PeriodicConfigs } from "./notes/periodicNoteIndex";
import { GranularityCommands } from "./commands/granularityCommands";
import type { CommandAction } from "./commands/granularityCommands";
import { resolveEffectiveConfig } from "./settings/model";
import type { NoteFile } from "./adapters/vaultPort";
import { HOVER_LINK_SOURCE } from "./ui/cellActions";

/**
 * The date type, taken from the clock this plugin actually reads.
 *
 * Obsidian hangs moment off the window, and the bundle must not carry a copy of
 * the package, so the type is read back off `window.moment` rather than
 * imported from "moment" — which is what the `no-restricted-imports` rule asks
 * for, and what keeps this file off the repository's lint baseline.
 */
type Moment = ReturnType<typeof window.moment>;


export default class CalendaricPlugin extends Plugin {
	/**
	 * Everything that was on disk, groups this version cannot reach included.
	 *
	 * Obsidian constructs the plugin before onload() can read the saved data, so
	 * both this and `settings` start on the defaults rather than on an assertion
	 * that they are set (US-ARCH-04).
	 */
	private stored: StoredConfig = defaultStoredConfig();

	/** The group in use, flattened. What the settings screen and the views read and edit. */
	settings: CalendaricSettings = { ...DEFAULT_SETTINGS };

	/**
	 * Which file is each period's note. Built once the workspace is ready — it
	 * reads the whole vault — and kept current by the vault's own events after
	 * that. Null until then, and every reader treats that as "no note known",
	 * which is the same answer an empty vault gives.
	 */
	private index: PeriodicNoteIndex | null = null;

	/** The five navigation commands per active granularity (US-CMD-05). */
	private commands: GranularityCommands | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));

		this.addSettingTab(new CalendaricSettingsTab(this.app, this));

		// Lets the 'Page preview' plugin list the grid as a hover source and gate it on Mod.
		this.registerHoverLinkSource(HOVER_LINK_SOURCE, {
			display: "Calendaric",
			defaultMod: true,
		});

		// Apply saved locale override
		if (this.settings.overrideLocale) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).moment?.locale(this.settings.overrideLocale);
		}

		const calendarLeaves = new ObsidianCalendarLeafAdapter(this.app);
		// One coordinator for the whole plugin. Startup and the palette command
		// both reach for the calendar leaf, and they share this creation lock,
		// so neither can make a second one while the other is still creating.
		const calendar = createCalendarCoordinator(calendarLeaves, (message) => {
			new Notice(message);
		});

		this.app.workspace.onLayoutReady(() => {
			// Reading the whole vault is what building the index costs, so it
			// waits until the workspace says the vault is there to read.
			this.index = new PeriodicNoteIndex(
				new ObsidianVaultAdapter(this.app),
				new ObsidianVaultConfigAdapter(this.app),
				this.indexConfigs(),
			);

			// Startup parks the leaf without revealing or focusing it.
			void calendar.ensure();
			void this.openStartupNote();
		});

		this.addCommand(calendarViewCommand(calendarLeaves, calendar.open));

		// Registered during load, not on layout: the palette must already list
		// them when the user opens it, and a command that fires before the index
		// exists still opens or creates the period's note.
		this.commands = new GranularityCommands(this, (granularity, action) => {
			void this.runGranularityCommand(granularity, action);
		});
		this.commands.sync(this.settings);
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CALENDAR);
		this.index?.destroy();
		this.index = null;
	}

	onSettingsChange(): void {
		// Which files count as periodic notes, and which commands exist, are both
		// decided by the settings that just changed — so both are rebuilt here
		// rather than at the next restart (AC-CMD-05.2, AC-CMD-05.3).
		this.index?.applySettings(this.indexConfigs());
		this.commands?.sync(this.settings);

		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
		if (leaf?.view instanceof CalendarView) {
			leaf.view.refresh();
		}
	}

	/**
	 * What the index should count as a periodic note: one entry per ACTIVE
	 * release granularity.
	 *
	 * A granularity that is switched off is left out rather than passed in
	 * disabled, so its files stop counting the moment the setting changes, and
	 * the index never has to interpret an `enabled` flag of its own.
	 */
	private indexConfigs(): PeriodicConfigs {
		const configs: PeriodicConfigs = {};
		for (const granularity of RELEASE_GRANULARITIES) {
			if (!this.settings[granularity].enabled) continue;
			configs[granularity] = resolveEffectiveConfig(this.settings, granularity);
		}
		return configs;
	}

	/** One generated command, whichever granularity and action it was built for. */
	private async runGranularityCommand(granularity: ReleaseGranularity, action: CommandAction): Promise<void> {
		const today = window.moment();

		switch (action) {
			case "open-current":
				return this.openPeriodNote(granularity, today);
			case "open-next":
				return this.openPeriodNote(granularity, today.clone().add(1, granularity));
			case "open-previous":
				return this.openPeriodNote(granularity, today.clone().subtract(1, granularity));
			case "jump-forward":
				return this.jumpToExistingNote(granularity, today, "forward");
			case "jump-backward":
				return this.jumpToExistingNote(granularity, today, "backward");
		}
	}

	/** Open that period's note, writing it first when the vault holds none. */
	private async openPeriodNote(granularity: ReleaseGranularity, date: Moment): Promise<void> {
		const workspace = new ObsidianWorkspaceAdapter(this.app);

		// The index knows which file IS that period's note, and that is not
		// always the path the format would write: a prefix-matched name and a
		// frontmatter date both count. Asking it first is what keeps this command
		// from writing a second note beside one that is already there.
		const existing = this.index?.get(granularity, date) ?? null;
		if (existing) {
			await openNoteIn(existing, "reuse", workspace, existing.path);
			return;
		}

		const config = resolveEffectiveConfig(this.settings, granularity);
		const path = computeNotePath(date, config, new ObsidianVaultConfigAdapter(this.app));

		let file: NoteFile;
		try {
			const creation = await createPeriodicNote(
				path,
				date,
				granularity,
				config,
				new ObsidianVaultAdapter(this.app),
				(message) => new Notice(message),
			);
			file = creation.file;
		} catch (error) {
			// Something else answers to the path, or the folder chain is
			// unusable. createPeriodicNote already names which, and the user gets
			// that wording rather than a silent no-op.
			new Notice(error instanceof Error ? error.message : String(error));
			return;
		}

		await openNoteIn(file, "reuse", workspace, path);
	}

	/** Open the closest existing note in one direction, or say there is none. */
	private async jumpToExistingNote(
		granularity: ReleaseGranularity,
		date: Moment,
		direction: JumpDirection,
	): Promise<void> {
		const target = this.index?.closest(granularity, date, direction) ?? null;
		if (!target) {
			const side = direction === "forward" ? "later" : "earlier";
			new Notice(`Calendaric: no ${side} ${granularity} note exists.`);
			return;
		}

		await openNoteIn(target, "reuse", new ObsidianWorkspaceAdapter(this.app), target.path);
	}

	private async openStartupNote(): Promise<void> {
		// Quarter is reserved (DEC-23): a stored configuration may still carry it,
		// and it is skipped here exactly like a granularity that is switched off.
		// Every other granularity in the release set opens the same way, so a
		// monthly startup note is no longer silently dropped (AC-NOTE-04.2).
		for (const key of RELEASE_GRANULARITIES) {
			const config = this.settings[key];
			if (!config.openAtStartup || !config.enabled) continue;

			const date = window.moment();
			const path = computeNotePath(date, config, new ObsidianVaultConfigAdapter(this.app));
			const existing = this.app.vault.getAbstractFileByPath(path);

			let file: NoteFile;
			if (existing instanceof TFile) {
				file = existing;
			} else {
				// Create silently — bypass confirmBeforeCreate on startup.
				const creation = await createPeriodicNote(
					path,
					date,
					key,
					config,
					new ObsidianVaultAdapter(this.app),
					(message) => new Notice(message),
				);
				file = creation.file;
			}

			await openNoteInNewTab(file, new ObsidianWorkspaceAdapter(this.app), path);
			break; // Only one granularity can have openAtStartup (enforced by clearStartupNote)
		}
	}

	async loadSettings() {
		this.stored = loadStoredConfig(await this.loadData());
		this.settings = toSettings(this.stored);
	}

	async saveSettings() {
		// Writing through applySettings is what keeps a second configuration group,
		// and anything else on disk this version does not read, out of harm's way.
		const next = applySettings(this.stored, this.settings);
		await this.saveData(next);
		// Only after the write, so a failed save leaves this field equal to the disk.
		// The Daily Notes import relies on that: it rolls its values back on a throw.
		this.stored = next;
	}
}
