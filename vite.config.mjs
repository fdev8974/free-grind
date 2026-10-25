import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const packageJsonPath = fileURLToPath(new URL("./package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const appVersion = packageJson.version ?? "0.0.0";

// Short commit the frontend was built from, shown next to the version in
// Settings. Always read from git (not CI env), so a rebuild of the same commit
// bakes in the same string and stays reproducible. Empty outside a checkout.
function shortCommitHash() {
	try {
		return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}
const commitHash = shortCommitHash();

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react(), tailwindcss()],
	// Release builds (ci/build) must not pick up local .env files.
	// @ts-expect-error process is a nodejs global
	envDir: process.env.FG_REPRODUCIBLE_BUILD ? false : undefined,
	define: {
		"import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
		"import.meta.env.VITE_COMMIT_HASH": JSON.stringify(commitHash),
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: "chrome69",
		cssTarget: "chrome69",
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (
						id.includes("/node_modules/react/") ||
						id.includes("/node_modules/react-dom/") ||
						id.includes("/node_modules/scheduler/")
					) {
						return "vendor-react";
					}
					if (
						id.includes("/node_modules/react-router") ||
						id.includes("/node_modules/@remix-run/")
					) {
						return "vendor-router";
					}
					if (
						id.includes("/node_modules/leaflet/") ||
						id.includes("/node_modules/react-leaflet/")
					) {
						return "vendor-map";
					}
					if (id.includes("/node_modules/@tauri-apps/")) {
						return "vendor-tauri";
					}
					if (
						id.includes("/node_modules/zod/") ||
						id.includes("/node_modules/@msgpack/")
					) {
						return "vendor-data";
					}
				},
			},
		},
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1420,
				}
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},
}));
