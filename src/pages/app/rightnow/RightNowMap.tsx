import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type { RightNowFeedItem } from "../../../services/apiFunctions";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useMediaBlur, useProfilePhotoPrivacy, type ProfilePhotoPrivacy } from "../../../hooks/useProfilePhotoPrivacy";
import { decodeGeohash } from "../../../utils/geohash";
import { getThumbImageUrl, validateMediaHash } from "../../../utils/media";
import { MAP_STYLE_DARK, applyRightNowMapTheme, relaxRoadZoomThresholds } from "../gridpage/components/mapStyles";
import { formatDistance } from "../gridpage/utils";
import { proxyMediaUrl } from "../../../utils/mediaProxy";

export type RightNowMapItem = RightNowFeedItem & { lat: number; lon: number };

export function hasMapPosition(item: RightNowFeedItem): item is RightNowMapItem {
	return (
		typeof item.lat === "number" && Number.isFinite(item.lat) &&
		typeof item.lon === "number" && Number.isFinite(item.lon)
	);
}

export function getRightNowItemKey(item: RightNowFeedItem): string {
	return `${item.id}-${item.profileId}`;
}

type Props = {
	items: RightNowMapItem[];
	selectedKey: string | null;
	onSelectKey: (key: string | null) => void;
	/** Changing this re-frames the map around the current markers (e.g. after a filter change). */
	fitKey: string;
	/** Height (px) covered by the page header at the top of the map. */
	topInset: number;
	/** Width (px) covered by the desktop nav rail at the left of the map. */
	leftInset?: number;
	/** Receives "frame all markers" so the page header can offer it as a pill. */
	recenterRef?: MutableRefObject<(() => void) | null>;
};

// Space kept free around the markers when framing, besides the header on top:
// the hint chip above them, the selected-post card, FAB and nav bar below.
const FIT_PADDING = { top: 56, bottom: 230, left: 48, right: 48 };
const FIT_MAX_ZOOM = 15;
const MARKER_SIZE = 48;

/** The poster's profile photo (ignoring any photo attached to the post). */
export function getRightNowProfileImageUrl(item: RightNowFeedItem): string | null {
	return item.profileImageMediaHash && validateMediaHash(item.profileImageMediaHash)
		? getThumbImageUrl(item.profileImageMediaHash, "320x320")
		: null;
}

/** Avatar for a Right Now post: the post's own photo when it has one, else the profile photo. */
export function getRightNowAvatarUrl(item: RightNowFeedItem): string | null {
	const postImage = item.media?.find((m) => m.data?.thumbnailUrl || m.data?.fullImageUrl)?.data;
	if (postImage) return postImage.thumbnailUrl || postImage.fullImageUrl || null;
	return item.profileImageMediaHash && validateMediaHash(item.profileImageMediaHash)
		? getThumbImageUrl(item.profileImageMediaHash, "320x320")
		: null;
}

/** How marker photos are shown under the NSFW settings (see useProfilePhotoPrivacy). */
type MarkerPhotoFilter = { profile: ProfilePhotoPrivacy; blurPostMedia: boolean };

function photoFilterKey(filter: MarkerPhotoFilter): string {
	return `${filter.profile}|${filter.blurPostMedia}`;
}

/** The marker photo after the NSFW settings: none in safe-for-work mode, blurred
 * when profile photos are, or when it's the post's own photo and post media is. */
function getMarkerPhoto(item: RightNowFeedItem, filter: MarkerPhotoFilter): { url: string; blur: boolean } | null {
	if (filter.profile === "hide") return null;
	const url = getRightNowAvatarUrl(item);
	if (!url) return null;
	const isPostPhoto = url !== getRightNowProfileImageUrl(item);
	return { url, blur: filter.profile === "blur" || (isPostPhoto && filter.blurPostMedia) };
}

function isOnline(item: RightNowFeedItem): boolean {
	return typeof item.onlineUntil === "number" && item.onlineUntil > Date.now();
}

const HOME_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="white"><path d="M11.47 3.84a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.06l-8.69-8.69a2.25 2.25 0 0 0-3.18 0l-8.69 8.69a.75.75 0 0 0 1.06 1.06l8.69-8.69Z"/><path d="m12 5.43 8.16 8.16c.03.03.06.06.09.08v6.2c0 1.04-.84 1.88-1.88 1.88H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.63a1.88 1.88 0 0 1-1.88-1.88v-6.2l.09-.08L12 5.43Z"/></svg>`;
const USER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1c0-2.76-3.58-5-8-5Z"/></svg>`;

// Session progress ring around the avatar (SVG, so it can count down).
// Hugs the avatar: 3px larger on each side, stroke centred on that gap.
const RING_SIZE = MARKER_SIZE + 6;
const RING_STROKE = 2.5;
const RING_RADIUS = RING_SIZE / 2 - RING_STROKE / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** Freshly posted sessions glow for this long. */
const FRESH_MS = 5 * 60_000;
/** Below this share of the session left, the ring blinks. */
const LOW_FRACTION = 0.15;
/** Zoom level from which every marker shows its name plate. */
const NAMEPLATE_ZOOM = 13;
/** Stagger between markers popping in, capped so large feeds don't drag. */
const POP_STAGGER_MS = 45;
const POP_STAGGER_MAX_MS = 600;

/** Share of the session still left (1 = just posted), or null when unknown. */
function remainingFraction(item: RightNowFeedItem, now: number): number | null {
	if (item.postedAt == null || item.expiresAt == null || item.expiresAt <= item.postedAt) return null;
	return Math.max(0, Math.min(1, (item.expiresAt - now) / (item.expiresAt - item.postedAt)));
}

/** Updates the countdown ring of a built marker to the current time. */
function updateMarkerRing(element: HTMLElement, item: RightNowFeedItem, now: number): void {
	const progress = element.querySelector<SVGCircleElement>("[data-role=ring-progress]");
	const ring = element.querySelector<SVGSVGElement>("[data-role=ring]");
	if (!progress || !ring) return;
	const fraction = remainingFraction(item, now) ?? 1;
	progress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));
	const isFresh = item.postedAt != null && now - item.postedAt < FRESH_MS;
	ring.classList.toggle("rn-ring-fresh", isFresh);
	ring.classList.toggle("rn-ring-low", !isFresh && fraction < LOW_FRACTION);
}

// Game-style avatar pin: round photo inside a countdown ring showing how much
// of the session is left, a home badge when hosting, a green dot when online
// and a name plate below. Built as plain DOM because maplibre markers live
// outside React's tree; styles are the .rn-* classes in index.css.
function buildMarkerElement(
	item: RightNowFeedItem,
	label: string,
	popDelayMs: number,
	photoFilter: MarkerPhotoFilter,
	onClick: () => void,
): HTMLDivElement {
	const el = document.createElement("div");
	el.className = "rn-marker";
	el.style.cssText = `width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;cursor:pointer;`;

	const pop = document.createElement("div");
	pop.className = "rn-marker-pop";
	pop.style.animationDelay = `${popDelayMs}ms`;

	const inner = document.createElement("div");
	inner.dataset.role = "inner";
	inner.className = "rn-marker-inner";

	const avatar = document.createElement("div");
	avatar.style.cssText = [
		"position:absolute",
		"inset:0",
		"border-radius:9999px",
		"border:1px solid var(--bg)",
		"background:var(--surface-2)",
		"color:var(--text-muted)",
		"box-shadow:0 4px 12px rgba(0,0,0,0.35)",
		"display:flex",
		"align-items:center",
		"justify-content:center",
		"overflow:hidden",
	].join(";");
	const photo = getMarkerPhoto(item, photoFilter);
	if (photo) {
		const img = document.createElement("img");
		img.src = proxyMediaUrl(photo.url);
		img.alt = "";
		img.draggable = false;
		img.style.cssText = `width:100%;height:100%;object-fit:cover;${photo.blur ? "filter:blur(6px);transform:scale(1.1);" : ""}`;
		avatar.appendChild(img);
	} else {
		avatar.innerHTML = USER_ICON_SVG;
	}
	inner.appendChild(avatar);

	const center = RING_SIZE / 2;
	const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	ring.dataset.role = "ring";
	ring.setAttribute("class", "rn-ring");
	ring.setAttribute("viewBox", `0 0 ${RING_SIZE} ${RING_SIZE}`);
	ring.innerHTML = [
		`<circle cx="${center}" cy="${center}" r="${RING_RADIUS}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="${RING_STROKE}"/>`,
		`<circle data-role="ring-progress" class="rn-ring-progress" cx="${center}" cy="${center}" r="${RING_RADIUS}" fill="none"`,
		` stroke="var(--right-now)" stroke-width="${RING_STROKE}" stroke-linecap="round" stroke-dasharray="${RING_CIRCUMFERENCE}"`,
		` transform="rotate(-90 ${center} ${center})"/>`,
	].join("");
	inner.appendChild(ring);
	updateMarkerRing(inner, item, Date.now());

	if (item.hosting) {
		const badge = document.createElement("div");
		badge.style.cssText = "position:absolute;top:-6px;right:-6px;width:19px;height:19px;border-radius:9999px;background:var(--right-now);border:2px solid var(--bg);display:flex;align-items:center;justify-content:center;";
		badge.innerHTML = HOME_ICON_SVG;
		inner.appendChild(badge);
	}

	if (isOnline(item)) {
		const dot = document.createElement("div");
		dot.style.cssText = "position:absolute;bottom:-2px;right:-2px;width:12px;height:12px;border-radius:9999px;background:#22c55e;border:2px solid var(--bg);";
		inner.appendChild(dot);
	}

	if (label) {
		const plate = document.createElement("div");
		plate.className = "rn-nameplate";
		plate.textContent = label;
		inner.appendChild(plate);
	}

	pop.appendChild(inner);
	el.appendChild(pop);
	el.addEventListener("click", (event) => {
		// Keep the map's own click (which deselects) from firing as well.
		event.stopPropagation();
		onClick();
	});
	return el;
}

/** Markers closer than this on screen are grouped into one cluster marker. */
const CLUSTER_RADIUS_PX = 56;
/** From this zoom on everyone is shown individually. */
const CLUSTER_MAX_ZOOM = 15;

/** Count shown on a cluster; anything above five reads "5+". */
const CLUSTER_COUNT_MAX = 5;
function formatClusterCount(count: number): string {
	return count > CLUSTER_COUNT_MAX ? `${CLUSTER_COUNT_MAX}+` : String(count);
}

// A group of nearby posts, drawn like a profile marker: the newest member's
// photo (dimmed) inside the usual ring, the member count in the middle and two
// offset circles behind it hinting at the stack.
function buildClusterElement(members: RightNowFeedItem[], photoFilter: MarkerPhotoFilter, onClick: () => void): HTMLDivElement {
	const el = document.createElement("div");
	el.className = "rn-cluster";
	el.style.cssText = `width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;`;
	const pop = document.createElement("div");
	pop.className = "rn-marker-pop";
	const inner = document.createElement("div");
	inner.className = "rn-marker-inner";

	for (let i = 0; i < 2; i++) {
		const stack = document.createElement("div");
		stack.className = "rn-cluster-stack";
		inner.appendChild(stack);
	}

	const face = document.createElement("div");
	face.className = "rn-cluster-face";
	const photo = members.map((member) => getMarkerPhoto(member, photoFilter)).find((p) => p != null);
	if (photo) {
		const img = document.createElement("img");
		img.src = proxyMediaUrl(photo.url);
		img.alt = "";
		img.draggable = false;
		if (photo.blur) img.style.filter = "blur(6px) brightness(0.5) saturate(1.2)";
		face.appendChild(img);
	}
	const count = document.createElement("span");
	count.className = "rn-cluster-count";
	count.textContent = formatClusterCount(members.length);
	face.appendChild(count);
	inner.appendChild(face);

	const center = RING_SIZE / 2;
	const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	ring.setAttribute("class", "rn-ring");
	ring.setAttribute("viewBox", `0 0 ${RING_SIZE} ${RING_SIZE}`);
	// Thinner than a profile's countdown ring — it's just an outline here.
	const clusterStroke = 1.75;
	ring.innerHTML = `<circle cx="${center}" cy="${center}" r="${RING_SIZE / 2 - clusterStroke / 2}" fill="none" stroke="var(--right-now)" stroke-width="${clusterStroke}"/>`;
	inner.appendChild(ring);

	pop.appendChild(inner);
	el.appendChild(pop);
	el.addEventListener("click", (event) => {
		event.stopPropagation();
		onClick();
	});
	return el;
}

// Hotspot heatmap under the markers. maplibre paint needs real color values,
// so --right-now is resolved once from the document.
const HOTSPOT_SOURCE = "rn-hotspots";
const HOTSPOT_LAYER = "rn-hotspots-heat";

function rightNowRgb(): [number, number, number] {
	const raw = getComputedStyle(document.documentElement).getPropertyValue("--right-now").trim();
	const hex = /^#([0-9a-f]{6})$/i.exec(raw)?.[1] ?? "9333ea";
	return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function hotspotData(items: RightNowMapItem[]) {
	return {
		type: "FeatureCollection" as const,
		features: items.map((item) => ({
			type: "Feature" as const,
			properties: {},
			geometry: { type: "Point" as const, coordinates: [item.lon, item.lat] },
		})),
	};
}

// The viewer's own position: a dot with pulsing radar rings and a "You" tag.
function buildRadarElement(label: string): HTMLDivElement {
	const el = document.createElement("div");
	el.className = "rn-radar";
	el.innerHTML = `<div class="rn-radar-ring"></div><div class="rn-radar-ring"></div><div class="rn-radar-ring"></div><div class="rn-radar-dot"></div>`;
	const tag = document.createElement("div");
	tag.className = "rn-radar-label";
	tag.textContent = label;
	el.appendChild(tag);
	return el;
}

// Rebuilding a marker is only needed when something it renders changed (the
// ring is updated in place, see updateMarkerRing).
function markerSignature(item: RightNowMapItem, label: string, photoFilter: MarkerPhotoFilter): string {
	const photo = getMarkerPhoto(item, photoFilter);
	return [item.lat, item.lon, photo?.url ?? "", photo?.blur ?? false, item.hosting, isOnline(item), label].join("|");
}

export function RightNowMap({ items, selectedKey, onSelectKey, fitKey, topInset, leftInset = 0, recenterRef }: Props) {
	const { t } = useTranslation();
	const { geohash, unitsPreset } = usePreferences();
	const { rightNow: blurRightNowMedia } = useMediaBlur();
	const profilePhotoPrivacy = useProfilePhotoPrivacy();
	// Read through a ref by syncMarkers/recluster; filterKey reruns them on change.
	const photoFilterRef = useRef<MarkerPhotoFilter>({ profile: profilePhotoPrivacy, blurPostMedia: blurRightNowMedia });
	photoFilterRef.current = { profile: profilePhotoPrivacy, blurPostMedia: blurRightNowMedia };
	const filterKey = photoFilterKey(photoFilterRef.current);
	// Name plate text per marker; read through a ref by syncMarkers.
	const labelForRef = useRef<(item: RightNowFeedItem) => string>(() => "");
	labelForRef.current = (item) => {
		const name = item.displayName?.trim() || t("common.unknown_display_name");
		const distance = item.distanceMeters != null ? formatDistance(item.distanceMeters, t, unitsPreset) : null;
		return distance ? `${name} · ${distance}` : name;
	};
	const radarRef = useRef<any>(null);
	// Cluster markers currently on the map, keyed by their sorted member keys
	// so an unchanged group keeps its marker (and doesn't pop in again).
	const clustersRef = useRef(new Map<string, any>());
	const selectedKeyRef = useRef(selectedKey);
	selectedKeyRef.current = selectedKey;
	const containerRef = useRef<HTMLDivElement | null>(null);
	const mapRef = useRef<any>(null);
	const maplibreRef = useRef<any>(null);
	const markersRef = useRef(new Map<string, { marker: any; signature: string; item: RightNowFeedItem }>());
	const itemsRef = useRef(items);
	itemsRef.current = items;
	const topInsetRef = useRef(topInset);
	topInsetRef.current = topInset;
	const leftInsetRef = useRef(leftInset);
	leftInsetRef.current = leftInset;
	const onSelectKeyRef = useRef(onSelectKey);
	onSelectKeyRef.current = onSelectKey;
	// fitKey the map was last framed for; null until the first markers arrive.
	const fittedForRef = useRef<string | null>(null);

	// Fallback center while nobody with a position is around: the user's own
	// browse location.
	const fallbackCenter = useMemo<[number, number] | null>(() => {
		if (!geohash) return null;
		try {
			const { lat, lon } = decodeGeohash(geohash);
			return [(lon[0] + lon[1]) / 2, (lat[0] + lat[1]) / 2];
		} catch {
			return null;
		}
	}, [geohash]);
	const fallbackCenterRef = useRef(fallbackCenter);
	fallbackCenterRef.current = fallbackCenter;

	const fitToItems = useCallback((duration: number) => {
		const map = mapRef.current;
		const maplibregl = maplibreRef.current;
		const current = itemsRef.current;
		if (!map || !maplibregl || current.length === 0) return;
		if (current.length === 1) {
			map.easeTo({
				center: [current[0].lon, current[0].lat],
				zoom: 14,
				padding: { ...FIT_PADDING, top: FIT_PADDING.top + topInsetRef.current, left: FIT_PADDING.left + leftInsetRef.current },
				duration,
			});
			return;
		}
		const bounds = new maplibregl.LngLatBounds();
		for (const item of current) bounds.extend([item.lon, item.lat]);
		map.fitBounds(bounds, {
			padding: { ...FIT_PADDING, top: FIT_PADDING.top + topInsetRef.current, left: FIT_PADDING.left + leftInsetRef.current },
			maxZoom: FIT_MAX_ZOOM,
			duration,
		});
	}, []);

	useEffect(() => {
		if (!recenterRef) return;
		const recenter = () => fitToItems(600);
		recenterRef.current = recenter;
		return () => {
			if (recenterRef.current === recenter) recenterRef.current = null;
		};
	}, [recenterRef, fitToItems]);

	const syncMarkers = useCallback(() => {
		const map = mapRef.current;
		const maplibregl = maplibreRef.current;
		if (!map || !maplibregl) return;

		const markers = markersRef.current;
		const nextKeys = new Set<string>();
		let popIndex = 0;
		for (const item of itemsRef.current) {
			const key = getRightNowItemKey(item);
			nextKeys.add(key);
			const label = labelForRef.current(item);
			const signature = markerSignature(item, label, photoFilterRef.current);
			const existing = markers.get(key);
			if (existing && existing.signature === signature) {
				existing.item = item;
				continue;
			}
			existing?.marker.remove();
			// Only brand-new markers pop in (staggered); rebuilt ones just swap.
			const popDelay = existing ? 0 : Math.min(popIndex++ * POP_STAGGER_MS, POP_STAGGER_MAX_MS);
			const element = buildMarkerElement(item, label, popDelay, photoFilterRef.current, () => onSelectKeyRef.current(key));
			if (existing) element.querySelector<HTMLElement>(".rn-marker-pop")!.style.animation = "none";
			const marker = new maplibregl.Marker({ element, anchor: "center" })
				.setLngLat([item.lon, item.lat])
				.addTo(map);
			markers.set(key, { marker, signature, item });
		}
		for (const [key, entry] of markers) {
			if (!nextKeys.has(key)) {
				entry.marker.remove();
				markers.delete(key);
			}
		}
	}, []);

	const applySelection = useCallback((key: string | null) => {
		let hasSelection = false;
		for (const [markerKey, entry] of markersRef.current) {
			const element: HTMLElement = entry.marker.getElement();
			const isSelected = markerKey === key;
			hasSelection ||= isSelected;
			// The marker's own element is maplibre's; the selected look lives on
			// .rn-marker (the first child we built inside it).
			const marker = element.classList.contains("rn-marker") ? element : element.querySelector<HTMLElement>(".rn-marker");
			if (marker) marker.dataset.selected = isSelected ? "true" : "false";
			element.style.zIndex = isSelected ? "10" : "";
		}
		containerRef.current?.classList.toggle("rn-map-has-selection", hasSelection);
	}, []);

	// Groups markers that overlap on screen at the current zoom. Members are
	// hidden and replaced by one cluster marker at their centroid; tapping it
	// zooms in until they separate. The selected post always stays on its own.
	const recluster = useCallback(() => {
		const map = mapRef.current;
		const maplibregl = maplibreRef.current;
		if (!map || !maplibregl) return;
		const markers = markersRef.current;
		const entries = [...markers.entries()];
		const groups: { keys: string[]; items: RightNowFeedItem[] }[] = [];

		if (map.getZoom() < CLUSTER_MAX_ZOOM) {
			const points = entries.map(([key, entry]) => ({
				key,
				item: entry.item,
				point: map.project(entry.marker.getLngLat()),
			}));
			// Newest posts lead their group (and show up front in the stack).
			points.sort((a, b) => (b.item.postedAt ?? 0) - (a.item.postedAt ?? 0));
			const assigned = new Set<string>();
			for (const leader of points) {
				if (assigned.has(leader.key) || leader.key === selectedKeyRef.current) continue;
				const members = points.filter(
					(other) =>
						!assigned.has(other.key) &&
						other.key !== selectedKeyRef.current &&
						Math.hypot(other.point.x - leader.point.x, other.point.y - leader.point.y) < CLUSTER_RADIUS_PX,
				);
				if (members.length < 2) continue;
				for (const member of members) assigned.add(member.key);
				groups.push({ keys: members.map((m) => m.key), items: members.map((m) => m.item) });
			}
		}

		const hidden = new Set(groups.flatMap((group) => group.keys));
		for (const [key, entry] of entries) {
			const element: HTMLElement = entry.marker.getElement();
			const wasHidden = element.style.display === "none";
			element.style.display = hidden.has(key) ? "none" : "";
			if (wasHidden && !hidden.has(key)) {
				// Leaving a group: pop it in quickly so the split reads as a reveal.
				const pop = element.querySelector<HTMLElement>(".rn-marker-pop");
				if (pop) {
					pop.style.animation = "none";
					void pop.offsetWidth; // restart the animation
					pop.style.animation = "rn-marker-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) both";
				}
			}
		}

		const clusters = clustersRef.current;
		const nextClusterKeys = new Set<string>();
		for (const group of groups) {
			// The photo filter is part of the key so a settings change rebuilds the face.
			const clusterKey = `${[...group.keys].sort().join(",")}|${photoFilterKey(photoFilterRef.current)}`;
			nextClusterKeys.add(clusterKey);
			const lng = group.items.reduce((sum, item) => sum + (item.lon ?? 0), 0) / group.items.length;
			const lat = group.items.reduce((sum, item) => sum + (item.lat ?? 0), 0) / group.items.length;
			const existing = clusters.get(clusterKey);
			if (existing) {
				existing.setLngLat([lng, lat]);
				continue;
			}
			const element = buildClusterElement(group.items, photoFilterRef.current, () => {
				const bounds = new maplibregl.LngLatBounds();
				for (const item of group.items) bounds.extend([item.lon, item.lat]);
				map.fitBounds(bounds, {
					padding: { ...FIT_PADDING, top: FIT_PADDING.top + topInsetRef.current, left: FIT_PADDING.left + leftInsetRef.current },
					// Never stop short of the level where clustering ends.
					maxZoom: Math.max(CLUSTER_MAX_ZOOM, map.getZoom() + 2),
					duration: 400,
				});
			});
			element.style.zIndex = "5";
			clusters.set(clusterKey, new maplibregl.Marker({ element, anchor: "center" }).setLngLat([lng, lat]).addTo(map));
		}
		for (const [clusterKey, marker] of clusters) {
			if (!nextClusterKeys.has(clusterKey)) {
				marker.remove();
				clusters.delete(clusterKey);
			}
		}
	}, []);

	// Hotspots: (re)adds the heatmap after every style load and keeps its data
	// in sync with the markers.
	const syncHotspots = useCallback(() => {
		const map = mapRef.current;
		if (!map || !map.isStyleLoaded()) return;
		const data = hotspotData(itemsRef.current);
		const source = map.getSource(HOTSPOT_SOURCE);
		if (source) {
			source.setData(data);
			return;
		}
		map.addSource(HOTSPOT_SOURCE, { type: "geojson", data });
		const [r, g, b] = rightNowRgb();
		const color = (alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
		// Below the first label layer, so street and place names stay readable.
		const beforeId = map.getStyle().layers?.find((layer: { type: string }) => layer.type === "symbol")?.id;
		map.addLayer(
			{
				id: HOTSPOT_LAYER,
				type: "heatmap",
				source: HOTSPOT_SOURCE,
				paint: {
					"heatmap-weight": 1,
					"heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 14, 1.4],
					"heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 6, 10, 20, 14, 36],
					// Fades out up close, where the individual markers take over.
					"heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.85, 15, 0.3, 16.5, 0],
					"heatmap-color": [
						"interpolate", ["linear"], ["heatmap-density"],
						0, color(0),
						0.2, color(0.18),
						0.5, color(0.38),
						0.8, color(0.58),
						1, "rgba(236, 72, 153, 0.7)",
					],
				},
			},
			beforeId,
		);
	}, []);

	// Count the rings down without rebuilding the markers.
	useEffect(() => {
		const timer = setInterval(() => {
			const now = Date.now();
			for (const entry of markersRef.current.values()) {
				updateMarkerRing(entry.marker.getElement(), entry.item, now);
			}
		}, 15_000);
		return () => clearInterval(timer);
	}, []);

	// The viewer's own position, radar style.
	const syncRadar = useCallback(() => {
		const map = mapRef.current;
		const maplibregl = maplibreRef.current;
		const center = fallbackCenterRef.current;
		if (!map || !maplibregl) return;
		if (!center) {
			radarRef.current?.remove();
			radarRef.current = null;
			return;
		}
		if (radarRef.current) {
			radarRef.current.setLngLat(center);
			return;
		}
		const element = buildRadarElement(t("right_now.map_you", { defaultValue: "You" }));
		element.style.zIndex = "0";
		radarRef.current = new maplibregl.Marker({ element, anchor: "center" }).setLngLat(center).addTo(map);
	}, [t]);

	useEffect(() => {
		let mounted = true;
		const container = containerRef.current;

		const init = async () => {
			try {
				const maplibregl = (await import("maplibre-gl")).default;
				await import("maplibre-gl/dist/maplibre-gl.css");
				if (!mounted || !containerRef.current || mapRef.current) return;
				maplibreRef.current = maplibregl;

				const first = itemsRef.current[0];
				const startCenter: [number, number] | null = first
					? [first.lon, first.lat]
					: fallbackCenterRef.current;
				const map = new maplibregl.Map({
					container: containerRef.current,
					// Always the dark base: the neon Right Now theme is drawn on top of it.
					style: MAP_STYLE_DARK,
					center: startCenter ?? [10, 50],
					zoom: startCenter ? 12 : 3,
					attributionControl: false,
				});
				map.on("style.load", () => {
					relaxRoadZoomThresholds(map);
					const [r, g, b] = rightNowRgb();
					applyRightNowMapTheme(map, `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
					// setStyle drops custom sources/layers, so re-add the hotspots.
					syncHotspots();
				});
				// Regroup while the map moves (once per frame), not only when it
				// stops — otherwise tapping a group shows nothing until the whole
				// zoom animation has finished, which feels like a hang.
				let reclusterFrame = 0;
				map.on("move", () => {
					if (reclusterFrame) return;
					reclusterFrame = requestAnimationFrame(() => {
						reclusterFrame = 0;
						recluster();
					});
				});
				map.on("moveend", recluster);
				map.on("click", () => onSelectKeyRef.current(null));
				// Name plates for everyone once zoomed in close enough.
				const updateZoomClass = () =>
					containerRef.current?.classList.toggle("rn-map-zoomed", map.getZoom() >= NAMEPLATE_ZOOM);
				map.on("zoom", updateZoomClass);
				map.once("load", updateZoomClass);
				mapRef.current = map;

				// Radar first, so the post markers stack above it.
				syncRadar();
				syncMarkers();
				recluster();
				if (itemsRef.current.length > 0) {
					fitToItems(0);
					fittedForRef.current = fitKey;
				}
			} catch {
				// map stays blank; the list view is still available
			}
		};

		void init();

		// The page header / nav can still be settling when the map is created.
		const resizeObserver = "ResizeObserver" in window && container
			? new ResizeObserver(() => mapRef.current?.resize())
			: null;
		if (container) resizeObserver?.observe(container);

		const markers = markersRef.current;
		return () => {
			mounted = false;
			resizeObserver?.disconnect();
			for (const entry of markers.values()) entry.marker.remove();
			markers.clear();
			radarRef.current?.remove();
			radarRef.current = null;
			for (const marker of clustersRef.current.values()) marker.remove();
			clustersRef.current.clear();
			mapRef.current?.remove();
			mapRef.current = null;
		};
		// Map is created once; theme/items updates are applied to the live instance below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Browse location changed: move over there right away, so the map doesn't
	// sit on the old area while the new feed loads (or if it comes back empty).
	const lastCenterRef = useRef(fallbackCenter);
	useEffect(() => {
		syncRadar();
		const previous = lastCenterRef.current;
		lastCenterRef.current = fallbackCenter;
		if (!fallbackCenter || !previous) return;
		if (previous[0] === fallbackCenter[0] && previous[1] === fallbackCenter[1]) return;
		mapRef.current?.jumpTo({ center: fallbackCenter, zoom: 12 });
	}, [fallbackCenter, syncRadar]);

	useEffect(() => {
		syncMarkers();
		applySelection(selectedKey);
		recluster();
		syncHotspots();
		// Frame the markers once when they first show up and again whenever the
		// filters change; plain refreshes keep wherever the user panned to.
		// (Framing ends in a moveend, which reclusters for the new view.)
		if (items.length > 0 && fittedForRef.current !== fitKey) {
			fitToItems(fittedForRef.current === null ? 0 : 600);
			fittedForRef.current = fitKey;
		}
		// filterKey isn't read here: it reruns the syncs so marker photos follow the NSFW settings.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [items, fitKey, selectedKey, syncMarkers, applySelection, recluster, syncHotspots, fitToItems, filterKey]);

	return (
		<div className="relative h-full w-full">
			<div ref={containerRef} className="absolute inset-0" style={{ isolation: "isolate" }} />
		</div>
	);
}
