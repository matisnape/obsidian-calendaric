import { describe, expect, it } from "vitest";
import { classify, runGates, GATES } from "./verify.mjs";

const ok = () => ({ status: 0 });

describe("AC-ARCH-06.5 — every gate runs and any failure fails the build", () => {
	it("covers type-checking, linting and the test suite", () => {
		expect(GATES).toEqual(["typecheck", "lint", "test"]);
	});

	it("reports no failures when all three gates pass", () => {
		expect(runGates(GATES, ok)).toEqual([]);
	});

	it.each(GATES)("fails the build when the %s gate fails", (failing) => {
		const failures = runGates(GATES, (gate) => (gate === failing ? { status: 1 } : { status: 0 }));
		expect(failures).toEqual([{ gate: failing, ran: true, reason: "failed (exit 1)" }]);
	});

	it("runs the remaining gates after the first one fails, so none is skipped", () => {
		const seen = [];
		runGates(GATES, (gate) => {
			seen.push(gate);
			return { status: gate === "typecheck" ? 1 : 0 };
		});
		expect(seen).toEqual(GATES);
	});
});

describe("AC-ARCH-06.6 — a gate that cannot run fails loudly and names itself", () => {
	it("names a gate whose npm script does not exist", () => {
		const verdict = classify("lint", { missing: true });
		expect(verdict).toMatchObject({ gate: "lint", ran: false });
		expect(verdict.reason).toContain('no "lint" script');
	});

	it("names a gate whose tool could not be started", () => {
		const verdict = classify("test", { error: "spawn npm ENOENT" });
		expect(verdict).toMatchObject({ gate: "test", ran: false });
		expect(verdict.reason).toContain("ENOENT");
	});

	it("treats eslint exit code 2 as could-not-run, not as lint errors", () => {
		expect(classify("lint", { status: 2 })).toMatchObject({ gate: "lint", ran: false });
	});

	it("treats a missing binary (exit 127) as could-not-run", () => {
		expect(classify("typecheck", { status: 127 })).toMatchObject({ gate: "typecheck", ran: false });
	});

	it("treats a killed gate as could-not-run", () => {
		expect(classify("test", { status: null, signal: "SIGKILL" })).toMatchObject({ ran: false });
	});

	it("still distinguishes a gate that ran and found real problems", () => {
		expect(classify("test", { status: 1 })).toMatchObject({ gate: "test", ran: true });
	});
});
