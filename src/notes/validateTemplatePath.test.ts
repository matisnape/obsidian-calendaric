import { describe, it, expect } from "vitest";
import { validateTemplatePath } from "./validateTemplatePath";
import { FakeVaultPort } from "../adapters/fakeVaultPort";

describe("validateTemplatePath", () => {
	it("AC-TPL-04.1: reports nothing when the path resolves to an existing note", () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");

		expect(validateTemplatePath("Templates/daily.md", vault)).toBeNull();
	});

	// An empty file is a configured template that happens to say nothing. It
	// resolves, so validation has no complaint; what it produces when a note is
	// created from it is AC-TPL-04.5's business, over in noteCreate.
	it("AC-TPL-04.1: reports nothing for a template file that is empty", () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/empty.md", "");

		expect(validateTemplatePath("Templates/empty.md", vault)).toBeNull();
	});

	it("AC-TPL-04.2: names the template as not found when nothing in the vault resolves", () => {
		const vault = new FakeVaultPort();

		const problem = validateTemplatePath("Templates/missing.md", vault);

		expect(problem?.reason).toBe("not-found");
		expect(problem?.message).toContain("Templates/missing.md");
		expect(problem?.message).toContain("not found");
	});

	it("AC-TPL-04.3: reports a path that resolves to a folder, naming it a folder", () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("Templates/daily");

		const problem = validateTemplatePath("Templates/daily", vault);

		expect(problem?.reason).toBe("is-folder");
		expect(problem?.message).toContain("Templates/daily");
		expect(problem?.message).toContain("folder");
	});

	// The two failures must not read alike, and must not be one reason with two
	// wordings: a caller that reports them on different surfaces branches on the
	// reason, so the distinction has to survive being read by code as well as by
	// a person.
	it("AC-TPL-04.3: distinguishes a folder from an unresolvable path", () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("Templates/daily");

		const folder = validateTemplatePath("Templates/daily", vault);
		const missing = validateTemplatePath("Templates/missing.md", vault);

		expect(folder?.reason).not.toEqual(missing?.reason);
		expect(folder?.message).not.toEqual(missing?.message);
		expect(folder?.message).not.toContain("not found");
	});

	it("AC-TPL-04.4: reports nothing when no template is configured for the granularity", () => {
		const vault = new FakeVaultPort();

		expect(validateTemplatePath("", vault)).toBeNull();
	});
});
