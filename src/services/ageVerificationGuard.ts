import {
	getAgeVerificationRegion,
	getAgeVerificationRegionForGeohash,
	type AgeVerificationRegion,
} from "../utils/ageVerificationRegions";
import { appLog } from "../utils/logger";

/**
 * One-time warning before the browse location is set inside a region where
 * Grindr requires legal age verification (see utils/ageVerificationRegions.ts).
 * Landing there by accident locks the account until the verification is done
 * in the official app, and the location can't be changed back meanwhile.
 *
 * Callers await confirmAgeVerificationRegion() before saving a location;
 * <AgeVerificationRegionPrompt /> (mounted once in App.tsx) renders the
 * dialog. Once confirmed, a region is remembered on this device and never
 * asked about again.
 */

const STORAGE_KEY = "free-grind:age-verification-regions-acknowledged";

type PromptState = { open: boolean; region: AgeVerificationRegion | null };

let state: PromptState = { open: false, region: null };
let pendingResolve: ((confirmed: boolean) => void) | null = null;
const listeners = new Set<() => void>();

function setState(next: PromptState) {
	state = next;
	for (const listener of listeners) listener();
}

export function subscribeAgeVerificationPrompt(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getAgeVerificationPromptState() {
	return state;
}

function loadAcknowledged(): Set<string> {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
	} catch {
		return new Set();
	}
}

function acknowledge(region: AgeVerificationRegion) {
	try {
		const acknowledged = loadAcknowledged();
		acknowledged.add(region);
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...acknowledged]));
	} catch (error) {
		appLog.warn("[ageVerificationGuard] failed to persist acknowledgement", error);
	}
}

function settle(confirmed: boolean) {
	const region = state.region;
	if (confirmed && region) acknowledge(region);
	const resolve = pendingResolve;
	pendingResolve = null;
	setState({ open: false, region });
	resolve?.(confirmed);
}

export function confirmAgeVerificationPrompt() {
	settle(true);
}

export function cancelAgeVerificationPrompt() {
	settle(false);
}

/**
 * Resolves true when the location may be saved: it's outside every
 * age-verification region, the user already confirmed that region once, or
 * the current location is already inside it (the account is past the
 * verification there, or already locked — moving within it changes nothing).
 * Otherwise asks, and resolves with the answer.
 */
export function confirmAgeVerificationRegion(
	lat: number,
	lon: number,
	currentGeohash: string | null | undefined,
): Promise<boolean> {
	const region = getAgeVerificationRegion(lat, lon);
	if (!region) return Promise.resolve(true);
	if (getAgeVerificationRegionForGeohash(currentGeohash) === region) return Promise.resolve(true);
	if (loadAcknowledged().has(region)) return Promise.resolve(true);

	// A second request while one is open replaces it; the first one is declined.
	pendingResolve?.(false);
	return new Promise<boolean>((resolve) => {
		pendingResolve = resolve;
		setState({ open: true, region });
	});
}
