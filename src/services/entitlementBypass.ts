/**
 * The Honduras entitlement bypass (https://opengrind.org/guides/bypasses),
 * ported from open-grind. Grindr decides a session's entitlements from the
 * geohash sent when its token is minted; re-issuing the token from Honduras
 * unlocks paid features (expiring photos, unsending, album sharing) for that
 * token. The Rust `entitlement_bypass` command does the handover and always
 * moves the server-side location back home.
 *
 * Opt-in (Behavior settings). When enabled, a paid action Grindr refuses
 * stays pending behind a prompt instead of failing: confirming runs the
 * handover and retries it, cancelling fails it with the original error.
 */
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { ApiFunctionError } from "./apiHelpers";
import { decodeGeohash, encodeGeohash } from "../utils/geohash";
import { appLog } from "../utils/logger";
import i18n from "../i18n";

const RUN_TIMEOUT_MS = 15_000;

const PAYWALL_URNS = new Set(["urn:gr:err:entitlement_limit", "urn:gr:err:tiered_feature"]);

/** Whether Grindr refused the call because it needs a subscription. */
export function isPaywallError(error: unknown): boolean {
	if (!(error instanceof ApiFunctionError)) return false;
	const payload = error.payload;
	if (!payload || typeof payload !== "object") return false;
	const type = (payload as { type?: unknown }).type;
	return typeof type === "string" && PAYWALL_URNS.has(type);
}

// --- Honduras location ---

type Box = { south: number; north: number; west: number; east: number };

// Inland boxes only, so the picked point never lands at sea.
const HONDURAS_INLAND_BOXES: readonly Box[] = [
	{ south: 14.24, north: 15.49, west: -88.22, east: -85.61 },
	{ south: 15.0, north: 15.59, west: -85.6, east: -84.41 },
	{ south: 14.3, north: 15.09, west: -88.74, east: -88.23 },
	{ south: 13.62, north: 14.23, west: -87.52, east: -86.97 },
];

const boxArea = ({ south, north, west, east }: Box) => (north - south) * (east - west);

function randomBoxByArea(): Box {
	const total = HONDURAS_INLAND_BOXES.reduce((sum, box) => sum + boxArea(box), 0);
	let remaining = Math.random() * total;
	for (const box of HONDURAS_INLAND_BOXES) {
		remaining -= boxArea(box);
		if (remaining <= 0) return box;
	}
	return HONDURAS_INLAND_BOXES[0];
}

// Rounded to a ~100 m grid before it's sent, like open-grind does for every
// location it reports.
const toCoarseGrid = (degrees: number) => Math.round(degrees * 1000) / 1000;

function coarsenGeohash(hash: string): string {
	const { lat, lon } = decodeGeohash(hash);
	const mid = (range: [number, number]) => (range[0] + range[1]) / 2;
	return encodeGeohash(toCoarseGrid(mid(lat)), toCoarseGrid(mid(lon)));
}

function randomHondurasGeohash(): string {
	const { south, north, west, east } = randomBoxByArea();
	return coarsenGeohash(
		encodeGeohash(south + Math.random() * (north - south), west + Math.random() * (east - west)),
	);
}

// --- configuration, synced from React by EntitlementBypassPrompt ---

let enabled = false;
let homeGeohash: string | null = null;

export function configureEntitlementBypass(config: { enabled: boolean; homeGeohash: string | null }): void {
	enabled = config.enabled;
	homeGeohash = config.homeGeohash;
	if (!enabled) dismissEntitlementBypass();
}

// --- prompt state (read via useSyncExternalStore) ---

export type EntitlementBypassState = { open: boolean; reason: string; busy: boolean };

let state: EntitlementBypassState = { open: false, reason: "", busy: false };
const listeners = new Set<() => void>();

function setState(next: Partial<EntitlementBypassState>): void {
	state = { ...state, ...next };
	for (const listener of listeners) listener();
}

export function subscribeEntitlementBypass(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getEntitlementBypassState(): EntitlementBypassState {
	return state;
}

// --- blocked actions ---

type Blocked = {
	reason: string;
	error: unknown;
	retry: () => Promise<unknown>;
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
};

let blocked: Blocked[] = [];
let granting: Promise<void> | null = null;
let active: Promise<void> | null = null;

function syncPromptToQueue(): void {
	const oldest = blocked[0];
	setState({ open: oldest !== undefined, reason: oldest?.reason ?? state.reason });
}

/**
 * Runs `action`; if Grindr refuses it as a paid feature and the bypass is
 * enabled, the returned promise stays pending behind the prompt and settles
 * with the retry (or the original error if the user cancels).
 */
export function withEntitlementBypass<T>(reason: string, action: () => Promise<T>): Promise<T> {
	return action().catch((error: unknown) => {
		if (!enabled || !isPaywallError(error)) throw error;
		return new Promise<T>((resolve, reject) => {
			blocked.push({
				reason,
				error,
				retry: action,
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			if (!state.open) syncPromptToQueue();
		});
	});
}

/** Closes the prompt; every action waiting on it fails with its original error. */
export function dismissEntitlementBypass(): void {
	const dropped = blocked;
	blocked = [];
	for (const action of dropped) action.reject(action.error);
	setState({ open: false });
}

/** Grid fetches wait for this, so none goes out while the server-side location is in Honduras. */
export function awaitEntitlementGrant(): Promise<void> {
	return granting ?? Promise.resolve();
}

async function startBypass(home: string): Promise<void> {
	const actions = blocked;
	blocked = [];
	const grant = invoke<void>("entitlement_bypass", { honduras: randomHondurasGeohash(), home });
	granting = grant.catch(() => undefined);
	try {
		await grant;
	} catch (error) {
		for (const action of actions) action.reject(action.error);
		throw error;
	} finally {
		granting = null;
	}
	let refusedAgain = false;
	await Promise.all(
		actions.map((action) =>
			action.retry().then(action.resolve, (error: unknown) => {
				refusedAgain = true;
				action.reject(error);
			}),
		),
	);
	if (refusedAgain) {
		toast.error(
			i18n.t("entitlement_bypass.still_refused", {
				defaultValue: "Grindr still refused this paid feature",
			}),
			{ id: "entitlement-bypass" },
		);
	}
}

export async function runEntitlementBypass(): Promise<void> {
	if (homeGeohash === null) {
		dismissEntitlementBypass();
		toast.error(
			i18n.t("entitlement_bypass.no_location", {
				defaultValue: "Set your location before using this bypass",
			}),
			{ id: "entitlement-bypass" },
		);
		return;
	}
	const home = coarsenGeohash(homeGeohash);
	const run = (active ??= startBypass(home).finally(() => {
		active = null;
	}));
	setState({ busy: true });
	try {
		await Promise.race([
			run,
			new Promise((_, reject) =>
				window.setTimeout(() => reject(new Error("The bypass timed out")), RUN_TIMEOUT_MS),
			),
		]);
	} catch (error) {
		appLog.error("[entitlements] bypass failed", error);
		toast.error(
			i18n.t("entitlement_bypass.failed", { defaultValue: "Failed to bypass this paid feature" }),
			{ id: "entitlement-bypass" },
		);
	} finally {
		setState({ busy: false });
		syncPromptToQueue();
	}
}
