import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import { ObsidianCompanionPluginAdapter } from "./obsidianCompanionPluginAdapter";

function makeApp(plugin: unknown): App {
	return {
		internalPlugins: {
			getPluginById: (_id: string) => plugin,
		},
	} as unknown as App;
}

/** A plugin object shaped the way an enabled core Daily Notes plugin really is. */
function validPlugin(options: unknown = { format: "DD-MM-YYYY", folder: "Journal", template: "t/daily" }) {
	return { enabled: true, instance: { options }, disable: vi.fn() };
}

function read(plugin: unknown) {
	return new ObsidianCompanionPluginAdapter(makeApp(plugin)).readDailyNotes();
}

describe("ObsidianCompanionPluginAdapter.readDailyNotes", () => {
	it("AC-ARCH-04.3: narrows a well-shaped plugin to the depended-on fields", () => {
		const result = read(validPlugin());
		expect(result.ok).toBe(true);
		if (!result.ok || !result.value.enabled) return;
		expect(result.value).toMatchObject({
			enabled: true,
			format: "DD-MM-YYYY",
			folder: "Journal",
			template: "t/daily",
		});
	});

	it("AC-ARCH-04.3: reports the plugin as absent when the host has no internalPlugins registry", () => {
		const result = new ObsidianCompanionPluginAdapter({} as unknown as App).readDailyNotes();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("absent");
		expect(result.problem).toMatch(/registry/i);
	});

	it("AC-ARCH-04.3: reports the plugin as absent when the registry returns nothing", () => {
		const result = read(null);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("absent");
		expect(result.problem).toMatch(/not installed/i);
	});

	// A registry that exists but is not shaped like one is a broken assumption,
	// not the ordinary case of a user without the plugin.
	it("AC-ARCH-04.4: reports a mismatch when the registry is present but not a record", () => {
		const app = { internalPlugins: "nonsense" } as unknown as App;
		const result = new ObsidianCompanionPluginAdapter(app).readDailyNotes();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("mismatch");
	});

	it("AC-ARCH-04.4: reports a mismatch when the registry exposes no getPluginById", () => {
		const app = { internalPlugins: { plugins: {} } } as unknown as App;
		const result = new ObsidianCompanionPluginAdapter(app).readDailyNotes();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("mismatch");
		expect(result.problem).toMatch(/getPluginById/);
	});

	it("AC-ARCH-04.4: reports a mismatch when the lookup returns a non-object instead of a plugin", () => {
		const result = read(42);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("mismatch");
	});

	// The registry's own method may rely on its receiver; a detached call would
	// throw or read the wrong state.
	it("AC-ARCH-04.3: calls getPluginById with the registry as its receiver", () => {
		const registry = {
			id: "internal-plugins",
			getPluginById(this: { id: string }, _id: string) {
				if (this?.id !== "internal-plugins") throw new Error("lost receiver");
				return validPlugin();
			},
		};
		const app = { internalPlugins: registry } as unknown as App;
		const result = new ObsidianCompanionPluginAdapter(app).readDailyNotes();
		expect(result.ok).toBe(true);
	});

	it("AC-ARCH-04.3: reads the daily-notes plugin id", () => {
		const getPluginById = vi.fn(() => validPlugin());
		const app = { internalPlugins: { getPluginById } } as unknown as App;
		new ObsidianCompanionPluginAdapter(app).readDailyNotes();
		expect(getPluginById).toHaveBeenCalledWith("daily-notes");
	});

	// AC-ARCH-04.4: a companion plugin that throws must degrade visibly rather
	// than take the settings screen down with it.
	describe("AC-ARCH-04.4: a host that throws", () => {
		it("reports a mismatch when getPluginById throws", () => {
			const app = {
				internalPlugins: {
					getPluginById: () => {
						throw new Error("internal plugin registry exploded");
					},
				},
			} as unknown as App;
			const result = new ObsidianCompanionPluginAdapter(app).readDailyNotes();
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/exploded/);
		});

		it("reports a mismatch when a property getter throws", () => {
			const plugin = {
				enabled: true,
				disable: vi.fn(),
				get instance(): unknown {
					throw new Error("instance getter exploded");
				},
			};
			const result = read(plugin);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/exploded/);
		});

		it("does not let the exception escape the adapter", () => {
			const app = {
				internalPlugins: {
					getPluginById: () => {
						throw new Error("boom");
					},
				},
			} as unknown as App;
			expect(() => new ObsidianCompanionPluginAdapter(app).readDailyNotes()).not.toThrow();
		});
	});

	// AC-MIG-01.6: a disabled companion plugin has no settings instance to read,
	// so the disabled answer must not depend on one.
	describe("AC-MIG-01.6: a disabled plugin", () => {
		it("reads as a successful disabled state even with no instance at all", () => {
			const result = read({ enabled: false });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.enabled).toBe(false);
		});

		it("reads as disabled even when the options container is malformed", () => {
			const result = read({ enabled: false, instance: { options: "nonsense" } });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.enabled).toBe(false);
		});

		it("reads as disabled even when the disable method is missing", () => {
			const result = read({ enabled: false, instance: {} });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.enabled).toBe(false);
		});
	});

	describe("AC-ARCH-04.4: an enabled plugin whose shape does not match", () => {
		it("reports a mismatch when enabled is not a boolean", () => {
			const result = read({ enabled: "yes", instance: { options: {} }, disable: vi.fn() });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/enabled/);
		});

		// AC-ARCH-04.4: a missing method is a shape mismatch, not a no-op.
		it("reports a mismatch when the disable method is missing", () => {
			const plugin = validPlugin();
			delete (plugin as { disable?: unknown }).disable;
			const result = read(plugin);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/disable/);
		});

		it("reports a mismatch when the instance is absent", () => {
			const result = read({ enabled: true, disable: vi.fn() });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/instance|options/i);
		});

		it("reports a mismatch when the options record is absent", () => {
			const result = read({ enabled: true, instance: {}, disable: vi.fn() });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/options/i);
		});

		// AC-ARCH-04.4: the defect this story was written for — a state container
		// that needs an accessor, read as if it were a plain record of values.
		it("reports a mismatch when the options container requires a subscribe accessor", () => {
			const result = read(validPlugin({ subscribe: () => () => undefined }));
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/accessor/i);
		});

		it("reports a mismatch when the options container requires a get accessor", () => {
			const result = read(validPlugin({ get: () => ({ format: "YYYY" }) }));
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toMatch(/accessor/i);
		});

		// A number where a format string belongs is a wrong assumption about the
		// companion plugin, so it is refused rather than read through as "".
		it.each(["format", "folder", "template"])("reports a mismatch when %s is not a string", (key) => {
			const result = read(validPlugin({ format: "YYYY", folder: "f", template: "t", [key]: 7 }));
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toBe("mismatch");
			expect(result.problem).toContain(key);
		});
	});

	// The old plugin's contract, recorded in docs/mapping/calendaric-map.json:
	// every combination of present and missing format/folder/template is normal,
	// and an unstored value falls back rather than failing (AC-MIG-01.3).
	describe("AC-MIG-01.3: values the companion plugin never stored", () => {
		it("accepts an empty options record and reports empty values", () => {
			const result = read(validPlugin({}));
			expect(result.ok).toBe(true);
			if (!result.ok || !result.value.enabled) return;
			expect(result.value).toMatchObject({ format: "", folder: "", template: "" });
		});

		it("accepts an absent format and reports it empty for the default to replace", () => {
			const result = read(validPlugin({ folder: "Journal", template: "t/daily" }));
			expect(result.ok).toBe(true);
			if (!result.ok || !result.value.enabled) return;
			expect(result.value.format).toBe("");
			expect(result.value.folder).toBe("Journal");
		});

		it("accepts an explicitly empty format string", () => {
			const result = read(validPlugin({ format: "", folder: "Journal", template: "t/daily" }));
			expect(result.ok).toBe(true);
			if (!result.ok || !result.value.enabled) return;
			expect(result.value.format).toBe("");
		});
	});

	describe("AC-ARCH-04.4: disableDailyNotes", () => {
		it("confirms the disable on the host", () => {
			const plugin = validPlugin();
			new ObsidianCompanionPluginAdapter(makeApp(plugin)).disableDailyNotes();
			expect(plugin.disable).toHaveBeenCalledWith(true);
		});

		it("calls disable with the plugin as its receiver", () => {
			let receiverId = "";
			const plugin = {
				id: "daily-notes",
				enabled: true,
				instance: { options: {} },
				disable(this: { id: string }, _confirm: boolean) {
					receiverId = this?.id ?? "";
				},
			};
			new ObsidianCompanionPluginAdapter(makeApp(plugin)).disableDailyNotes();
			expect(receiverId).toBe("daily-notes");
		});

		// The button that calls this only exists because a read just succeeded.
		// A plugin that vanished in between needs no disabling, and the tab
		// re-renders without the card, so the state corrects itself.
		it("does nothing when the companion plugin cannot be reached", () => {
			expect(() => new ObsidianCompanionPluginAdapter(makeApp(null)).disableDailyNotes()).not.toThrow();
		});

		it("does not let a throwing host escape", () => {
			const plugin = {
				enabled: true,
				instance: { options: {} },
				disable: () => {
					throw new Error("boom");
				},
			};
			expect(() => new ObsidianCompanionPluginAdapter(makeApp(plugin)).disableDailyNotes()).not.toThrow();
		});
	});
});
