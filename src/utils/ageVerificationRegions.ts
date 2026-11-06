import { AGE_VERIFICATION_REGION_POLYGONS } from "./ageVerificationRegions.data";
import { decodeGeohash } from "./geohash";

/**
 * Regions where Grindr locks the account behind a legal age verification
 * (session JWT `restriction` = `AGE_RESTRICTED`, `restrictionReason` =
 * `UK_/BR_/AU_VERIFICATION_REQUIRED`) as soon as its location lands there.
 * Free Grind can't complete that verification, and the location can't be
 * moved back out until it's done in the official app.
 *
 * Grindr exposes no list of these regions, so they're hardcoded here — keep
 * in sync with `VerificationRegion` in grindr-patched/src/auth.rs. The US
 * (`US_VERIFICATION_REQUIRED`) is left out on purpose: it only asks for an
 * app store age signal and doesn't block the account.
 */
export type AgeVerificationRegion = keyof typeof AGE_VERIFICATION_REGION_POLYGONS;

type Polygon = { ring: number[]; minLon: number; maxLon: number; minLat: number; maxLat: number };

let indexed: { region: AgeVerificationRegion; polygons: Polygon[] }[] | null = null;

function getIndex() {
	if (indexed) return indexed;
	indexed = (Object.keys(AGE_VERIFICATION_REGION_POLYGONS) as AgeVerificationRegion[]).map((region) => ({
		region,
		polygons: AGE_VERIFICATION_REGION_POLYGONS[region].map((ring) => {
			let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
			for (let i = 0; i < ring.length; i += 2) {
				minLon = Math.min(minLon, ring[i]);
				maxLon = Math.max(maxLon, ring[i]);
				minLat = Math.min(minLat, ring[i + 1]);
				maxLat = Math.max(maxLat, ring[i + 1]);
			}
			return { ring, minLon, maxLon, minLat, maxLat };
		}),
	}));
	return indexed;
}

/** Even-odd ray casting over a flat [lon, lat, ...] ring. */
function ringContains(ring: number[], lon: number, lat: number): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
		const xi = ring[i], yi = ring[i + 1];
		const xj = ring[j], yj = ring[j + 1];
		if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/** Rough distance in km from the point to the nearest edge of the ring. */
function ringDistanceKm(ring: number[], lon: number, lat: number): number {
	const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
	const ky = 110.57;
	let best = Infinity;
	for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
		const ax = (ring[j] - lon) * kx, ay = (ring[j + 1] - lat) * ky;
		const bx = (ring[i] - lon) * kx, by = (ring[i + 1] - lat) * ky;
		const dx = bx - ax, dy = by - ay;
		const lenSq = dx * dx + dy * dy;
		const t = lenSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq)) : 0;
		best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
	}
	return best;
}

/**
 * Margin around the outlines. They're simplified to ~2 km, so without it
 * coastal towns could fall just outside; the cost is a warning for points
 * a few km across a land border (e.g. on the Irish side of Northern Ireland).
 */
const MARGIN_KM = 4;
const MARGIN_DEG = MARGIN_KM / 50; // generous: bbox prefilter only

/** The age-verification region containing (or within a few km of) this point, or null. */
export function getAgeVerificationRegion(lat: number, lon: number): AgeVerificationRegion | null {
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	for (const { region, polygons } of getIndex()) {
		for (const p of polygons) {
			if (
				lon < p.minLon - MARGIN_DEG || lon > p.maxLon + MARGIN_DEG ||
				lat < p.minLat - MARGIN_DEG || lat > p.maxLat + MARGIN_DEG
			) continue;
			if (ringContains(p.ring, lon, lat) || ringDistanceKm(p.ring, lon, lat) <= MARGIN_KM) return region;
		}
	}
	return null;
}

export function getAgeVerificationRegionForGeohash(geohash: string | null | undefined): AgeVerificationRegion | null {
	if (!geohash) return null;
	try {
		const decoded = decodeGeohash(geohash);
		return getAgeVerificationRegion(
			(decoded.lat[0] + decoded.lat[1]) / 2,
			(decoded.lon[0] + decoded.lon[1]) / 2,
		);
	} catch {
		return null;
	}
}
