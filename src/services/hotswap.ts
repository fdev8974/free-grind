import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
	applyUpdate,
	checkUpdate,
	configure,
	getVersionInfo,
	notifyReady,
} from "tauri-plugin-hotswap-api";
import { appLog } from "../utils/logger";
import { areUpdateChecksEnabled } from "./updateChecks";

export type HotswapProgress =
	| { phase: "idle" }
	| { phase: "checking" }
	| { phase: "downloading"; downloaded: number; total: number | null }
	| { phase: "installing" }
	| { phase: "done" };

let progress: HotswapProgress = { phase: "idle" };
const progressListeners = new Set<() => void>();

function setProgress(next: HotswapProgress): void {
	progress = next;
	for (const listener of progressListeners) listener();
}

export function getHotswapProgress(): HotswapProgress {
	return progress;
}

export function subscribeHotswapProgress(listener: () => void): () => void {
	progressListeners.add(listener);
	return () => progressListeners.delete(listener);
}

// Subscribe to hotswap lifecycle events for debugging and progress reporting
if (typeof window !== "undefined") {
	void (async () => {
		if (!isTauri()) return;
		await listen("hotswap://lifecycle", (event) => {
			appLog.debug("[hotswap-lifecycle]", JSON.stringify(event.payload));
			const name = (event.payload as { event?: string } | null)?.event;
			// applyUpdate() keeps running after the download (verify, extract, activate).
			if (name === "download-complete" && progress.phase === "downloading") {
				// Fill the bar first, then switch once its width transition has finished.
				if (progress.total) {
					setProgress({ phase: "downloading", downloaded: progress.total, total: progress.total });
				}
				setTimeout(() => {
					if (progress.phase === "downloading") setProgress({ phase: "installing" });
				}, 250);
			}
		});
		await listen("hotswap://download-progress", (event) => {
			const p = event.payload as { downloaded: number; total?: number | null };
			appLog.debug(`[hotswap-progress] ${p.downloaded}/${p.total ?? "?"}`);
			// Never move backwards: a retry restarts the stream at 0 and late events can
			// arrive out of order — the bar holds its position instead of jumping back.
			if (progress.phase === "downloading" && p.downloaded > progress.downloaded) {
				setProgress({ phase: "downloading", downloaded: p.downloaded, total: p.total ?? progress.total });
			}
		});
	})();
}

let startupReadyNotified = false;
const HOTSWAP_CHANNEL_STORAGE_KEY = "hotswap-channel";
// Version of a just-applied OTA bundle, written before the reload and read
// once by HotswapUpdatedToastBridge on the next startup.
const HOTSWAP_JUST_UPDATED_STORAGE_KEY = "hotswap-just-updated-version";
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
	version: string | null;
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

let settleStartupCheck: () => void = () => {};
const startupCheckSettled = new Promise<void>((resolve) => {
	settleStartupCheck = resolve;
});

/**
 * Resolves once the startup OTA check is done without reloading the page. When
 * it installs an update the page reloads instead and this never resolves, so
 * anything judging the frontend version (e.g. the outdated-APK prompt) doesn't
 * act on the version that's about to be replaced.
 */
export function whenStartupHotswapSettled(): Promise<void> {
	return startupCheckSettled;
}

// Opt-in: only when enabled are OTA bundles downloaded and applied without asking.
// Otherwise an available update waits in `pendingUpdate` for the user to confirm.
const HOTSWAP_AUTO_UPDATE_STORAGE_KEY = "hotswap-auto-update";

function readAutoUpdateEnabled(): boolean {
	try {
		return window.localStorage.getItem(HOTSWAP_AUTO_UPDATE_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

let autoUpdateEnabled = typeof window !== "undefined" && readAutoUpdateEnabled();
const autoUpdateListeners = new Set<() => void>();

export function isHotswapAutoUpdateEnabled(): boolean {
	return autoUpdateEnabled;
}

export function subscribeHotswapAutoUpdate(listener: () => void): () => void {
	autoUpdateListeners.add(listener);
	return () => autoUpdateListeners.delete(listener);
}

export function setHotswapAutoUpdateEnabled(enabled: boolean): void {
	autoUpdateEnabled = enabled;
	try {
		window.localStorage.setItem(HOTSWAP_AUTO_UPDATE_STORAGE_KEY, String(enabled));
	} catch {
		// Storage unavailable — the choice only lasts for this session.
	}
	for (const listener of autoUpdateListeners) listener();
}

export interface PendingHotswapUpdate {
	version: string | null;
	notes: string | null;
	/** Dev preview (UI Previews): "Update now" only simulates the download. */
	preview?: boolean;
	/** Install started from Settings: the prompt downloads right away and just shows the progress. */
	autoStart?: boolean;
}

// An update found by the startup check that waits for the user's confirmation.
let pendingUpdate: PendingHotswapUpdate | null = null;
const pendingUpdateListeners = new Set<() => void>();

function setPendingUpdate(next: PendingHotswapUpdate | null): void {
	pendingUpdate = next;
	for (const listener of pendingUpdateListeners) listener();
}

export function getPendingHotswapUpdate(): PendingHotswapUpdate | null {
	return pendingUpdate;
}

export function subscribePendingHotswapUpdate(listener: () => void): () => void {
	pendingUpdateListeners.add(listener);
	return () => pendingUpdateListeners.delete(listener);
}

/** Shows the OTA update prompt for an update found by a manual check. */
export function showHotswapUpdatePrompt(update: PendingHotswapUpdate): void {
	setPendingUpdate(update);
}

/** Drops the pending update until the next app start ("Later"). */
export function dismissPendingHotswapUpdate(): void {
	setPendingUpdate(null);
}

/**
 * Startup check (skipped when update checks are turned off): with auto-update enabled an available bundle is installed and
 * the page reloads right away; otherwise it becomes the pending update the
 * OTA update prompt asks about.
 */
export async function startupCheckForUpdate(): Promise<void> {
	if (!isHotswapAvailable() || !areUpdateChecksEnabled()) {
		settleStartupCheck();
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
			settleStartupCheck();
			return;
		}

		if (result.available) {
			if (!autoUpdateEnabled) {
				appLog.debug("[hotswap] Update available, waiting for confirmation:", result.version);
				setPendingUpdate({ version: result.version, notes: result.notes });
				settleStartupCheck();
				return;
			}

			appLog.debug("[hotswap] Auto-installing available update...");
			await installHotswapUpdate();

			appLog.debug("[hotswap] Applying update immediately...");
			window.location.reload();
			return;
		}
	} catch (error) {
		appLog.error("[hotswap] Auto-update check failed:", error);
	}
	settleStartupCheck();
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
		return { available: false, version: null, requiresBinaryUpdate: false, notes: null };
	}

	setProgress({ phase: "checking" });
	let result: Awaited<ReturnType<typeof checkUpdate>>;
	try {
		result = await checkUpdate();
	} finally {
		setProgress({ phase: "idle" });
	}
	const parsedNotes = parseBinaryRequiredNotes(result.notes);

	return {
		available: result.available,
		version: result.version,
		requiresBinaryUpdate: parsedNotes.requiresBinaryUpdate,
		notes: parsedNotes.message,
	};
}

/** Version of the active OTA bundle, or null while the embedded frontend runs. */
export async function getActiveHotswapVersion(): Promise<string | null> {
	if (!isHotswapAvailable()) return null;
	try {
		return (await getVersionInfo()).version;
	} catch {
		return null;
	}
}

// Shared so a manual install during the startup auto-install joins it instead of
// starting a second, interleaved download.
let installInFlight: Promise<void> | null = null;

export function installHotswapUpdate(): Promise<void> {
	if (!isHotswapAvailable()) {
		return Promise.resolve();
	}

	installInFlight ??= runInstall().finally(() => {
		installInFlight = null;
	});
	return installInFlight;
}

async function runInstall(): Promise<void> {
	setProgress({ phase: "downloading", downloaded: 0, total: null });
	let version: string;
	try {
		version = await applyUpdate();
	} catch (error) {
		setProgress({ phase: "idle" });
		throw error;
	}
	// Callers reload right after; "done" stays visible until then.
	setProgress({ phase: "done" });
	try {
		window.localStorage.setItem(HOTSWAP_JUST_UPDATED_STORAGE_KEY, version);
	} catch {
		// Storage unavailable — skip the post-reload toast.
	}
}

/** Returns the version of an OTA update applied before the last reload (once), else null. */
export function consumeHotswapJustUpdatedVersion(): string | null {
	try {
		const version = window.localStorage.getItem(HOTSWAP_JUST_UPDATED_STORAGE_KEY);
		if (version !== null) {
			window.localStorage.removeItem(HOTSWAP_JUST_UPDATED_STORAGE_KEY);
		}
		return version;
	} catch {
		return null;
	}
}
