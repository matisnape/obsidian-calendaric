import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import { ObsidianPeriodicNotesAdapter } from "./obsidianPeriodicNotesAdapter";

/** A community-plugin registry that answers for the ids it was given. */
function makeApp(plugins: Record<string, unknown>): App {
	return {
		plugins: {
			getPlugin: (id: string) => plugins[id] ?? null,
		},
	} as unknown as App;
}

/**
 * A Periodic Notes instance shaped the way the surveyed plugin really is:
 * `calendarSetManager.getActiveGranularities()` computes the answer, and
 * `settings` is a Svelte store rather than a record
 * (docs/mapping/sources/pn.json, api_surface entries for
 * `CalendarSetManager.getActiveGranularities` and `settings`).
 */
function periodicNotes(active: unknown = ["day", "week"]) {
	return {
		calendarSetManager: {
			getActiveGranularities: () => active,
		},
		settings: { subscribe: (run: (value: unknown) => void) => (run({}), () => undefined) },
	};
}

function read(plugins: Record<string, unknown>) {
	return new ObsidianPeriodicNotesAdapter(makeApp(plugins)).readActiveGranularities();
}

describe("ObsidianPeriodicNotesAdapter.readActiveGranularities", () => {
	it("AC-MIG-05.1: reports the granularities the active calendar set enables", () => {
		const result = read({ "periodic-notes": periodicNotes(["day", "month"]) });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect([...result.value]).toEqual(["day", "month"]);
	});

	// The recorded P1: `settings` is a Svelte store, so a build that reads
	// `settings.day.enabled` reads undefined for every granularity while still
	// reporting success (docs/mapping/sources/cal.json, capability
	// `periodic-notes-weekly-detection`). The manager is the live answer.
	it("AC-MIG-05.1: takes the answer from the calendar set manager, not from the settings object", () => {
		const plugin = {
			calendarSetManager: { getActiveGranularities: () => ["month"] },
			settings: { day: { enabled: true }, month: { enabled: false } },
		};
		const result = read({ "periodic-notes": plugin });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect([...result.value]).toEqual(["month"]);
	});

	// The manager's own method reads the plugin's settings store off its
	// receiver; a detached call would throw or answer for the wrong instance.
	it("AC-MIG-05.1: calls getActiveGranularities with the manager as its receiver", () => {
		let receiverId = "";
		const plugin = {
			calendarSetManager: {
				id: "calendar-set-manager",
				getActiveGranularities(this: { id: string }) {
					receiverId = this?.id ?? "";
					return ["day"];
				},
			},
		};
		read({ "periodic-notes": plugin });
		expect(receiverId).toBe("calendar-set-manager");
	});

	// Both legacy plugins probe the side-loaded dev build first, so a vault that
	// runs the fork resolves to the plugin it is actually using
	// (docs/mapping/sources/dni.json, capability `detect-periodic-notes-plugin`).
	it("AC-MIG-05.1: prefers the side-loaded dev build over the community-store build", () => {
		const result = read({
			"periodic-notes-anks": periodicNotes(["week"]),
			"periodic-notes": periodicNotes(["year"]),
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect([...result.value]).toEqual(["week"]);
	});

	it("AC-MIG-05.1: falls back to the community-store build when the dev build is absent", () => {
		const result = read({ "periodic-notes": periodicNotes(["year"]) });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect([...result.value]).toEqual(["year"]);
	});

	describe("AC-MIG-05.4: a plugin that exposes no readable active set", () => {
		it("AC-MIG-05.4: reports a mismatch when the plugin carries no calendar set manager", () => {
			const result = read({ "periodic-notes": { settings: { day: { enabled: true } } } });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/calendar set manager/i);
		});

		it("AC-MIG-05.4: reports a mismatch when getActiveGranularities is missing", () => {
			const result = read({ "periodic-notes": { calendarSetManager: { getFormat: vi.fn() } } });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/getActiveGranularities/);
		});

		// The real manager throws "No active calendar set found" when the stored
		// active set id names a set that is gone (calendarSetManager.ts:95-103 of
		// the surveyed plugin). That must read as unavailable, never as a crash.
		it("AC-MIG-05.4: reports a mismatch when the plugin throws instead of answering", () => {
			const plugin = {
				calendarSetManager: {
					getActiveGranularities: () => {
						throw new Error("No active calendar set found");
					},
				},
			};
			const result = read({ "periodic-notes": plugin });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/No active calendar set found/);
		});

		it("AC-MIG-05.4: does not let the exception escape the adapter", () => {
			const plugin = {
				calendarSetManager: {
					getActiveGranularities: () => {
						throw new Error("boom");
					},
				},
			};
			expect(() => read({ "periodic-notes": plugin })).not.toThrow();
		});

		it("AC-MIG-05.4: reports a mismatch when the answer is not a list", () => {
			const result = read({ "periodic-notes": periodicNotes("day") });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
		});

		it("AC-MIG-05.4: reports a mismatch when the list holds something other than names", () => {
			const result = read({ "periodic-notes": periodicNotes(["day", 7]) });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
		});

		it("AC-MIG-05.4: reports a mismatch when the plugin is not an object", () => {
			const result = read({ "periodic-notes": "nonsense" });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
		});
	});

	// Not having the plugin is ordinary, and stays apart from a shape that broke.
	describe("AC-MIG-05.3: a vault without Periodic Notes", () => {
		it("AC-MIG-05.3: reports the plugin as absent when neither id is installed", () => {
			const result = read({});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("absent");
			expect(result.problem).toMatch(/not installed/i);
		});

		it("AC-MIG-05.3: reports absence when the host exposes no community plugin registry", () => {
			const result = new ObsidianPeriodicNotesAdapter({} as unknown as App).readActiveGranularities();
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("absent");
		});

		it("AC-MIG-05.4: reports a mismatch when the registry exposes no getPlugin", () => {
			const app = { plugins: { enabledPlugins: new Set<string>() } } as unknown as App;
			const result = new ObsidianPeriodicNotesAdapter(app).readActiveGranularities();
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/getPlugin/);
		});

		it("AC-MIG-05.3: does not throw when the registry itself throws", () => {
			const app = {
				plugins: {
					getPlugin: () => {
						throw new Error("registry exploded");
					},
				},
			} as unknown as App;
			expect(() => new ObsidianPeriodicNotesAdapter(app).readActiveGranularities()).not.toThrow();
		});
	});
});

/**
 * A Periodic Notes instance shaped like this vault's: two calendar sets with one
 * of them active, and the stale top-level per-granularity keys its stored data
 * still carries beside them (docs/mapping/sources/pn.json OBS-pn-05, which
 * records those keys as read exactly once at migration time and dead after;
 * docs/mapping/sources/vault.json OBS-vault-03, which records the second set).
 *
 * The stale keys are readable here on purpose. A fake that hid them could not
 * fail for an implementation that read them, which is the whole of AC-MIG-04.2.
 */
function periodicNotesWithSets(activeCalendarSet: string) {
	const calendarSets = [
		{
			id: "Default",
			ctime: 1,
			day: {
				enabled: true,
				format: "YYYY-MM-DD",
				folder: "Journal/Daily",
				templatePath: "Templates/Day.md",
				allowPrefixMatch: false,
			},
			week: {
				enabled: true,
				format: "gggg-[W]ww",
				folder: "Journal/Weekly",
				templatePath: "",
				allowPrefixMatch: true,
			},
		},
		{
			id: "Work",
			ctime: 2,
			day: {
				enabled: true,
				format: "YYYY-MM-DD",
				folder: "Kurs/Daily",
				templatePath: "Kurs/Day.md",
				allowPrefixMatch: false,
			},
		},
	];
	const raw = {
		activeCalendarSet,
		calendarSets,
		daily: { folder: "Stale/Daily", format: "DD-MM-YYYY", template: "Stale/Day.md" },
		weekly: { folder: "Stale/Weekly", format: "YYYY-[W]ww", template: "Stale/Week.md" },
	};
	return {
		calendarSetManager: {
			getActiveGranularities: () => ["day", "week"],
			// The real manager's own lookup, its throw included: getActiveSet()
			// raises "No active calendar set found" rather than falling back to
			// the first set (docs/mapping/sources/pn.json, get-active-calendar-set).
			getActiveSet: () => {
				const active = calendarSets.find((set) => set.id === raw.activeCalendarSet);
				if (!active) throw new Error("No active calendar set found");
				return active;
			},
			getSets: () => calendarSets,
		},
		settings: Object.assign({ subscribe: (run: (value: unknown) => void) => (run(raw), () => undefined) }, raw),
	};
}

function readSet(plugins: Record<string, unknown>) {
	return new ObsidianPeriodicNotesAdapter(makeApp(plugins)).readActiveCalendarSet();
}

describe("ObsidianPeriodicNotesAdapter.readActiveCalendarSet", () => {
	it("AC-MIG-04.1: reports the active calendar set's enabled flag, format, folder and template per granularity", () => {
		const result = readSet({ "periodic-notes": periodicNotesWithSets("Default") });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.id).toBe("Default");
		// DEC-18: the prefix-match flag is one of the five fields that come across.
		expect(result.value.granularities.week).toEqual({
			enabled: true,
			format: "gggg-[W]ww",
			folder: "Journal/Weekly",
			templatePath: "",
			allowPrefixMatch: true,
		});
	});

	// `ctime` is a number and `id` a string, so neither can pass for an entry.
	it("AC-MIG-04.1: reads only the set's granularity entries, not its own bookkeeping fields", () => {
		const result = readSet({ "periodic-notes": periodicNotesWithSets("Default") });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(Object.keys(result.value.granularities)).toEqual(["day", "week"]);
	});

	it("AC-MIG-04.2: takes the folder and template from the active calendar set, never from the stale top-level keys beside it", () => {
		const result = readSet({ "periodic-notes": periodicNotesWithSets("Default") });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.granularities.day).toEqual({
			enabled: true,
			format: "YYYY-MM-DD",
			folder: "Journal/Daily",
			templatePath: "Templates/Day.md",
			allowPrefixMatch: false,
		});
		// Nothing from the disagreeing top-level keys reaches the caller at all.
		expect(JSON.stringify(result.value)).not.toContain("Stale");
	});

	it("AC-MIG-04.3: reports the active set alone and merges no other set into it", () => {
		const result = readSet({ "periodic-notes": periodicNotesWithSets("Work") });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.id).toBe("Work");
		expect(result.value.granularities.day?.folder).toBe("Kurs/Daily");
		// The other set enables week; this one does not, so week stays absent.
		expect(result.value.granularities.week).toBeUndefined();
		expect(JSON.stringify(result.value)).not.toContain("Journal");
	});

	it("names the problem when the build publishes no calendar set manager", () => {
		const result = readSet({ "periodic-notes": { settings: {} } });

		expect(result).toEqual({
			ok: false,
			reason: "mismatch",
			problem: "The Periodic Notes plugin exposes no calendar set manager.",
		});
	});

	it("names the problem when the manager publishes no 'getActiveSet'", () => {
		const result = readSet({ "periodic-notes": { calendarSetManager: { getActiveGranularities: () => [] } } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("mismatch");
		expect(result.problem).toContain("getActiveSet");
	});

	// The real manager throws when the stored active id names a set that is gone.
	it("reports a throwing getActiveSet as unreadable instead of letting it escape", () => {
		const plugins = { "periodic-notes": periodicNotesWithSets("Gone") };

		expect(() => readSet(plugins)).not.toThrow();
		const result = readSet(plugins);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("mismatch");
		expect(result.problem).toContain("No active calendar set found");
	});

	it("stays quiet when the plugin is not installed", () => {
		expect(readSet({})).toEqual({
			ok: false,
			reason: "absent",
			problem: "The Periodic Notes plugin is not installed.",
		});
	});
});

/**
 * A Periodic Notes instance wired the way the plugin wires itself (its
 * main.ts): the manager answers from the settings store's current value, and a
 * subscriber saves every value the store takes, then triggers
 * 'periodic-notes:settings-updated' on the workspace. The store takes the
 * value first, so a save that fails leaves memory patched and the event
 * unfired -- and nobody awaits that save, so its failure is otherwise silent.
 */
function storedPeriodicNotes(settings: Record<string, unknown>, save: "works" | "rejects" = "works") {
	const listeners = new Map<string, Set<() => void>>();
	const workspace = {
		on(name: string, callback: () => void) {
			if (!listeners.has(name)) listeners.set(name, new Set());
			listeners.get(name)!.add(callback);
			return { name, callback };
		},
		offref(ref: { name: string; callback: () => void }) {
			listeners.get(ref.name)?.delete(ref.callback);
		},
		trigger(name: string) {
			for (const callback of [...(listeners.get(name) ?? [])]) callback();
		},
	};

	let value: unknown = settings;
	const disk = { data: JSON.parse(JSON.stringify(settings)) as unknown };
	const store = {
		update(this: unknown, change: (current: unknown) => unknown) {
			if (this !== store) throw new Error("update called off its store");
			value = change(value);
			void onUpdateSettings(value);
		},
	};
	async function onUpdateSettings(next: unknown): Promise<void> {
		await Promise.resolve();
		if (save === "rejects") return; // saveData rejected; the trigger below never runs
		disk.data = JSON.parse(JSON.stringify(next)) as unknown;
		workspace.trigger("periodic-notes:settings-updated");
	}

	const activeSet = () => {
		const current = value as { activeCalendarSet: string; calendarSets: Record<string, unknown>[] };
		return current.calendarSets.find((set) => set["id"] === current.activeCalendarSet)!;
	};
	const plugin = {
		settings: store,
		loadData: async () => JSON.parse(JSON.stringify(disk.data)) as unknown,
		calendarSetManager: {
			getActiveSet: activeSet,
			getActiveGranularities: () =>
				Object.entries(activeSet())
					.filter(([, entry]) => (entry as { enabled?: boolean })?.enabled === true)
					.map(([name]) => name),
		},
	};
	const app = (id: string): App => ({ plugins: { getPlugin: (asked: string) => (asked === id ? plugin : null) }, workspace }) as unknown as App;
	return { plugin, app, disk, current: () => value, listeners };
}

const twoSets = () => ({
	activeCalendarSet: "Work",
	calendarSets: [
		{ id: "Default", ctime: 1, day: { enabled: true, format: "YYYY" } },
		{ id: "Work", ctime: 2, day: { enabled: true, format: "DD" }, week: { enabled: true, format: "ww" } },
	],
});

describe("ObsidianPeriodicNotesAdapter.disableGranularity", () => {
	it("AC-MIG-06.5: switches the granularity off in the active set through the plugin's own store, which saves it", async () => {
		const { app, disk } = storedPeriodicNotes(twoSets());
		const adapter = new ObsidianPeriodicNotesAdapter(app("periodic-notes"));

		expect(await adapter.disableGranularity("day")).toEqual({ ok: true });

		const reread = adapter.readActiveGranularities();
		expect(reread.ok && [...reread.value]).toEqual(["week"]);
		const written = disk.data as ReturnType<typeof twoSets>;
		expect(written.calendarSets[1]!.day).toEqual({ enabled: false, format: "DD" });
	});

	it("AC-MIG-06.5: leaves every other calendar set as it was", async () => {
		const { app, disk } = storedPeriodicNotes(twoSets());
		await new ObsidianPeriodicNotesAdapter(app("periodic-notes")).disableGranularity("day");

		expect((disk.data as ReturnType<typeof twoSets>).calendarSets[0]).toEqual(twoSets().calendarSets[0]);
	});

	it("AC-MIG-06.3: writes to the dev build when that is the one installed", async () => {
		const { app } = storedPeriodicNotes(twoSets());
		const adapter = new ObsidianPeriodicNotesAdapter(app("periodic-notes-anks"));

		expect(await adapter.disableGranularity("week")).toEqual({ ok: true });

		const reread = adapter.readActiveGranularities();
		expect(reread.ok && [...reread.value]).toEqual(["day"]);
	});

	it("AC-MIG-06.6: reports a save that failed, although the plugin already reads the granularity off", async () => {
		vi.useFakeTimers();
		try {
			const { app, disk, listeners } = storedPeriodicNotes(twoSets(), "rejects");
			const adapter = new ObsidianPeriodicNotesAdapter(app("periodic-notes"));

			const pending = adapter.disableGranularity("day");
			await vi.advanceTimersByTimeAsync(5000);
			const result = await pending;

			const reread = adapter.readActiveGranularities();
			expect(reread.ok && [...reread.value]).toEqual(["week"]);
			expect((disk.data as ReturnType<typeof twoSets>).calendarSets[1]!.day.enabled).toBe(true);
			expect(result.ok).toBe(false);
			expect(listeners.get("periodic-notes:settings-updated")?.size ?? 0).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("AC-MIG-06.6: a store of an unexpected shape is left unchanged and reported, so the refusal stays", async () => {
		const { app, current } = storedPeriodicNotes({ activeCalendarSet: "Work", calendarSets: "not a list" });
		const result = await new ObsidianPeriodicNotesAdapter(app("periodic-notes")).disableGranularity("day");

		expect(current()).toEqual({ activeCalendarSet: "Work", calendarSets: "not a list" });
		expect(result.ok).toBe(false);
	});

	it("AC-MIG-06.6: reports a plugin with no writable settings store instead of claiming the write", async () => {
		const plugin = { calendarSetManager: { getActiveGranularities: () => ["day"] }, settings: { day: {} } };
		const result = await new ObsidianPeriodicNotesAdapter(makeApp({ "periodic-notes": plugin })).disableGranularity("day");

		expect(result.ok).toBe(false);
	});

	it("AC-MIG-06.4: reports an unqueryable registry as a failed write, never a throw", async () => {
		const app = {
			plugins: {
				getPlugin: () => {
					throw new Error("registry exploded");
				},
			},
		} as unknown as App;

		expect((await new ObsidianPeriodicNotesAdapter(app).disableGranularity("day")).ok).toBe(false);
	});
});
