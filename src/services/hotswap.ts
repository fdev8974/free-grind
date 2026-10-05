import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
	applyUpdate,
	checkUpdate,
	configure,
	notifyReady,
} from "tauri-plugin-hotswap-api";
import { appLog } from "../utils/logger";

// Subscribe to hotswap lifecycle events for debugging
if (typeof window !== "undefined") {
	void (async () => {
		if (!isTauri()) return;
		await listen("hotswap://lifecycle", (event) => {
			appLog.debug("[hotswap-lifecycle]", JSON.stringify(event.payload));
		});
		await listen("hotswap://download-progress", (event) => {
			const p = event.payload as { downloaded: number; total?: number };
			appLog.debug(`[hotswap-progress] ${p.downloaded}/${p.total ?? "?"}`);
		});
	})();
}

let startupReadyNotified = false;
const HOTSWAP_CHANNEL_STORAGE_KEY = "hotswap-channel";
const HOTSWAP_CHANNELS = ["main", "development"] as const;

/** A contributor channel is always prefixed with "contrib-" */
type ContributorChannel = `contrib-${string}`;

export type HotswapChannel = (typeof HOTSWAP_CHANNELS)[number] | ContributorChannel;

export function isContributorChannel(ch: string): ch is ContributorChannel {
	return /^contrib-[a-z0-9_-]{1,32}$/.test(ch);
}

export function getContributorHandle(ch: HotswapChannel): string | null {
	if (isContributorChannel(ch)) return ch.slice("contrib-".length);
	return null;
}

function isHotswapChannel(value: string): value is HotswapChannel {
	return (HOTSWAP_CHANNELS as readonly string[]).includes(value) || isContributorChannel(value);
}

function resolveDefaultChannel(): HotswapChannel {
	const envChannel = import.meta.env.VITE_HOTSWAP_CHANNEL;
	if (typeof envChannel === "string" && isHotswapChannel(envChannel)) {
		return envChannel;
	}

	return "main";
}

function readStoredChannel(): HotswapChannel | null {
	const value = window.localStorage.getItem(HOTSWAP_CHANNEL_STORAGE_KEY);
	if (!value || !isHotswapChannel(value)) {
		return null;
	}

	return value;
}

let currentChannel: HotswapChannel = readStoredChannel() ?? resolveDefaultChannel();

export interface HotswapCheckResult {
	available: boolean;
	requiresBinaryUpdate: boolean;
	notes: string | null;
}

const BINARY_REQUIRED_MARKER = "[BINARY_REQUIRED]";

function parseBinaryRequiredNotes(notes: string | null): {
	requiresBinaryUpdate: boolean;
	message: string | null;
} {
	if (!notes) {
		return { requiresBinaryUpdate: false, message: null };
	}

	if (!notes.includes(BINARY_REQUIRED_MARKER)) {
		return { requiresBinaryUpdate: false, message: notes };
	}

	return {
		requiresBinaryUpdate: true,
		message: notes.replace(BINARY_REQUIRED_MARKER, "").trim() || null,
	};
}

export function getHotswapChannels(): readonly HotswapChannel[] {
	return HOTSWAP_CHANNELS;
}

export function getHotswapChannelLabel(channel: HotswapChannel): string {
	if (isContributorChannel(channel)) return channel;
	if (channel === "main") return "Stable";
	if (channel === "development") return "Development";
	return channel;
}

export function getCurrentHotswapChannel(): HotswapChannel {
	return currentChannel;
}

export function isHotswapAvailable(): boolean {
	return isTauri();
}

export async function markHotswapStartupReady(): Promise<void> {
	if (!isHotswapAvailable() || startupReadyNotified) {
		return;
	}

	await configure({ channel: currentChannel });
	await notifyReady();
	startupReadyNotified = true;
}

export async function autoCheckAndInstallUpdate(): Promise<void> {
	if (!isHotswapAvailable()) {
		return;
	}

	try {
		const result = await checkForHotswapUpdate();

		// Skip if binary update is required (user needs to manually download APK)
		if (result.requiresBinaryUpdate) {
			appLog.debug(
				"[hotswap] Binary update required, skipping auto-install:",
				result.notes,
			);
			return;
		}

		if (result.available) {
			appLog.debug("[hotswap] Auto-installing available update...");
			await installHotswapUpdate();

			appLog.debug("[hotswap] Applying update immediately...");
			window.location.reload();
		}
	} catch (error) {
		appLog.error("[hotswap] Auto-update check failed:", error);
	}
}

export async function setHotswapChannel(channel: HotswapChannel): Promise<void> {
	currentChannel = channel;
	window.localStorage.setItem(HOTSWAP_CHANNEL_STORAGE_KEY, channel);

	if (!isHotswapAvailable()) {
		return;
	}

	await configure({ channel });
}

export async function clearContributorChannel(): Promise<void> {
	await setHotswapChannel("main");
}

export async function checkForHotswapUpdate(): Promise<HotswapCheckResult> {
	if (!isHotswapAvailable()) {
		return { available: false, requiresBinaryUpdate: false, notes: null };
	}

	const result = await checkUpdate();
	const parsedNotes = parseBinaryRequiredNotes(result.notes);

	return {
		available: result.available,
		requiresBinaryUpdate: parsedNotes.requiresBinaryUpdate,
		notes: parsedNotes.message,
	};
}

export async function installHotswapUpdate(): Promise<void> {
	if (!isHotswapAvailable()) {
		return;
	}

	await applyUpdate();
}
