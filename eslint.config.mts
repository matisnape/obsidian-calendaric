import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";

export default defineConfig(
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"package-lock.json",
		"tsconfig.json",
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						"eslint.config.mts",
						"manifest.json",
						"scripts/templateGuard.test.ts",
						// A glob: 4 files today, 7 matches in all. Past
						// typescript-eslint's default limit of 8, `eslint .` fails outright.
						"scripts/*.mjs",
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ["package.json"],
		rules: {
			// moment stays: test-setup installs it as window.moment, the library Obsidian ships to plugins.
			"depend/ban-dependencies": [
				"error",
				{ presets: ["native", "microutilities", "preferred"], allowed: ["moment"] },
			],
		},
	},
	{
		// Node CLI scripts: console is their output, not stray debugging. The
		// plugin reports no-console through rule-custom-message, so that rule is
		// re-set here with its no-new-func entry kept and no-console left out.
		files: ["scripts/**"],
		rules: {
			"obsidianmd/rule-custom-message": [
				"error",
				{
					"no-new-func": {
						messages: {
							"The Function constructor is eval":
								"Using the `Function` constructor is dangerous because it executes arbitrary code, similar to `eval()`",
						},
					},
				},
			],
		},
	},
);
