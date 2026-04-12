import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		setupFiles: ["src/ui/test-setup.ts"],
	},
	resolve: {
		alias: {
			obsidian: new URL("src/__mocks__/obsidian.ts", import.meta.url).pathname,
		},
	},
});
