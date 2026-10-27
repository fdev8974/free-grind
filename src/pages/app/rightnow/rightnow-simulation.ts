import type { RightNowCreatePostRequest, RightNowFeedItem, RightNowUpdatePostRequest } from "../../../services/apiFunctions";
import { appLog } from "../../../utils/logger";
import { getRightNowSessionDuration } from "./rightnow-constants";

export async function simulateFetchActivePost(
	text: string,
	isHosting: boolean,
	showOnMap: boolean,
	mediaId: number | null,
	thumbnailUrl: string | null,
	isHidden: boolean,
) {
	appLog.info("Simulating GET Active RightNow Post");
	await new Promise((resolve) => setTimeout(resolve, 800));

	const response = {
		post: {
			activeText: text || "This is a simulated active post",
			hosting: isHosting,
			postStatus: isHidden ? "HIDDEN" : "ACTIVE",
			shareLocation: showOnMap ? "DISTANCE_AND_MAP" : "DISTANCE_ONLY",
			media: mediaId ? [{ data: { mediaId, thumbnailUrl } }] : [],
		},
	};
	appLog.info("Simulating GET Active RightNow Post RESPONSE:", response);
	return response;
}

export async function simulateCreatePost(payload: RightNowCreatePostRequest) {
	appLog.info("Simulating POST RightNow Post:", payload);
	await new Promise((resolve) => setTimeout(resolve, 1500));

	const mockId = Math.floor(Math.random() * 1000000);
	const mockExpiration = Date.now() + getRightNowSessionDuration(true);

	const response = {
		id: mockId,
		expiresAt: mockExpiration,
	};
	appLog.info("Simulating POST RightNow Post RESPONSE:", response);
	return response;
}

export async function simulateUpdatePost(id: number, payload: RightNowUpdatePostRequest) {
	appLog.info("Simulating PATCH RightNow Post:", id, payload);
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const response = { success: true };
	appLog.info("Simulating PATCH RightNow Post RESPONSE:", response);
	return response;
}

export async function simulateEndSession(id: number) {
	appLog.info("Simulating DELETE RightNow Post:", id);
	await new Promise((resolve) => setTimeout(resolve, 1000));
	const response = { success: true };
	appLog.info("Simulating PATCH RightNow Post RESPONSE:", response);
	return response;
}

export async function simulateUploadMedia(file: File) {
	appLog.info("Simulating RightNow Media Upload:", file.name);
	await new Promise((resolve) => setTimeout(resolve, 1200));

	const response = {
		mediaId: Math.floor(Math.random() * 1000000),
		thumbnailUrl: URL.createObjectURL(file), // Use the actual file for preview
	};
	appLog.info("Simulating RightNow Media Upload RESPONSE:", response);
	return response;
}

// Deterministic 0..1 value per seed so simulated map positions stay put
// across feed refetches.
function seededRandom(seed: string): number {
	let hash = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return ((hash >>> 0) % 100000) / 100000;
}

// Random point within radiusMeters of the center.
function scatterAround(center: { lat: number; lon: number }, seed: string, radiusMeters: number) {
	const angle = seededRandom(`${seed}:a`) * 2 * Math.PI;
	const distance = Math.sqrt(seededRandom(`${seed}:d`)) * radiusMeters;
	const lat = center.lat + (distance * Math.sin(angle)) / 111320;
	const lon = center.lon + (distance * Math.cos(angle)) / (111320 * Math.cos((center.lat * Math.PI) / 180));
	return { lat, lon, distanceMeters: Math.round(distance) };
}

const SIMULATED_TEXTS = [
	"Bored at home, come over?",
	"Looking for a drink nearby 🍻",
	null,
	"Hosting now, discreet",
	"Anyone up for a walk?",
	"Just landed, show me around",
	null,
	"Gym later, coffee first ☕",
];

const SIMULATED_FEED_MIN_SIZE = 10;
const SIMULATED_RADIUS_METERS = 4000;
// Share of posts left without coordinates, to exercise the "not on the map" path.
const SIMULATED_NO_POSITION_RATIO = 0.25;

/**
 * Right Now test mode: turns the real feed into one that exercises the map
 * UI. Real posts keep their photos but get scattered positions (except a
 * share that stays list-only), and synthetic posts are added when the real
 * feed is too small. Synthetic profile IDs don't exist on the server.
 */
export function simulateRightNowMapFeed(
	items: RightNowFeedItem[],
	center: { lat: number; lon: number },
	hostingOnly: boolean,
): RightNowFeedItem[] {
	const now = Date.now();
	const withPositions = items.map((item) => {
		if (item.lat != null && item.lon != null) return item;
		if (seededRandom(`${item.profileId}:skip`) < SIMULATED_NO_POSITION_RATIO) return item;
		const point = scatterAround(center, item.profileId, SIMULATED_RADIUS_METERS);
		return { ...item, lat: point.lat, lon: point.lon, distanceMeters: item.distanceMeters ?? point.distanceMeters };
	});

	const synthetic: RightNowFeedItem[] = [];
	for (let i = 0; withPositions.length + synthetic.length < SIMULATED_FEED_MIN_SIZE; i++) {
		const profileId = `sim-${i}`;
		const hosting = i % 3 === 0;
		if (hostingOnly && !hosting) continue;
		const hasPosition = i % 4 !== 3;
		const point = scatterAround(center, profileId, SIMULATED_RADIUS_METERS);
		synthetic.push({
			id: -(i + 1),
			profileId,
			displayName: `Test ${i + 1}`,
			profileImageMediaHash: null,
			media: null,
			text: SIMULATED_TEXTS[i % SIMULATED_TEXTS.length],
			hosting,
			postedAt: now - (i + 1) * 4 * 60 * 1000,
			expiresAt: now + 60 * 60 * 1000,
			distanceMeters: point.distanceMeters,
			lat: hasPosition ? point.lat : null,
			lon: hasPosition ? point.lon : null,
			onlineUntil: i % 2 === 0 ? now + 10 * 60 * 1000 : null,
			isFavorite: i === 1,
			recentlyChatted: false,
			mpuScore: null,
			premiumType: null,
		});
	}
	return [...withPositions, ...synthetic];
}
