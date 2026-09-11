#!/usr/bin/env node
// The three release gates run as one command: AC-ARCH-06.5 (any one failing fails
// the build, none is skipped) and AC-ARCH-06.6 (a gate that cannot run fails
// loudly and names itself).
//
// Why a runner instead of `npm run typecheck && npm run lint && npm test`: a shell
// chain collapses to one exit code, so a gate that never ran looks exactly like a
// gate that passed. The Periodic Notes fork dropped lint from its build over a
// tooling bug and the build still went green — that is the failure this guards.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const GATES = ["typecheck", "lint", "test"];

/**
 * Turns one gate's result into a verdict. `null` means the gate passed.
 *
 * `missing` says package.json has no such script, which is the tooling defect
 * AC-ARCH-06.6 describes: the gate cannot run at all. eslint exits 2 for a config
 * or internal error rather than for lint errors, and a shell exits 126 or 127 when
 * a binary is missing or not executable — all three mean "did not run", not
 * "ran and found problems".
 */
export function classify(gate, result) {
	if (result.missing) {
		return { gate, ran: false, reason: `package.json has no "${gate}" script` };
	}
	if (result.error) {
		return { gate, ran: false, reason: `could not start the gate: ${result.error}` };
	}
	if (result.status === 0) {
		return null;
	}
	if (result.status === null) {
		return { gate, ran: false, reason: `killed by signal ${result.signal}` };
	}
	if ([126, 127].includes(result.status) || (gate === "lint" && result.status === 2)) {
		return { gate, ran: false, reason: `tool reported it could not run (exit ${result.status})` };
	}
	return { gate, ran: true, reason: `failed (exit ${result.status})` };
}

/**
 * Runs every gate, even after one fails. Running them all is what makes "none of
 * the three is skipped" observable in the log: a reader sees three verdicts, not a
 * chain that stopped early.
 */
export function runGates(gates, run) {
	const verdicts = [];
	for (const gate of gates) {
		const verdict = classify(gate, run(gate));
		console.log(verdict ? `gate ${gate}: ${verdict.ran ? "FAILED" : "COULD NOT RUN"}` : `gate ${gate}: ok`);
		if (verdict) verdicts.push(verdict);
	}
	return verdicts;
}

function runNpmScript(gate) {
	const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
	if (!scripts[gate]) return { missing: true };

	console.log(`\n--- ${gate} ---`);
	const result = spawnSync("npm", ["run", "--silent", gate], { stdio: "inherit" });
	return { status: result.status, signal: result.signal, error: result.error?.message };
}

function main() {
	const failures = runGates(GATES, runNpmScript);
	if (failures.length === 0) {
		console.log(`\nall ${GATES.length} gates passed.`);
		return 0;
	}

	console.error(`\nverify FAILED — ${failures.length} of ${GATES.length} gates did not pass:`);
	for (const f of failures) {
		console.error(`  - ${f.gate}: ${f.ran ? "" : "COULD NOT RUN — "}${f.reason}`);
	}
	return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(main());
}
