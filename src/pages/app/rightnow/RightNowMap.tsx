import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { RightNowFeedItem } from "../../../services/apiFunctions";
import { useEffectiveColorScheme } from "../../../hooks/useEffectiveColorScheme";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { decodeGeohash } from "../../../utils/geohash";
import { getThumbImageUrl, validateMediaHash } from "../../../utils/media";
import { applyDarkMapTheme, getMapStyleUrl, relaxRoadZoomThresholds } from "../gridpage/components/mapStyles";

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
	/** Receives "frame all markers" so the page header can offer it as a pill. */
	recenterRef?: MutableRefObject<(() => void) | null>;
};

// Space kept free around the markers when framing, besides the header on top:
// the hint chip above them, the selected-post card, FAB and nav bar below.
const FIT_PADDING = { top: 56, bottom: 230, left: 48, right: 48 };
const FIT_MAX_ZOOM = 15;
const MARKER_SIZE = 48;

/** Avatar for a Right Now post: the post's own photo when it has one, else the profile photo. */
export function getRightNowAvatarUrl(item: RightNowFeedItem): string | null {
	const postImage = item.media?.find((m) => m.data?.thumbnailUrl || m.data?.fullImageUrl)?.data;
	if (postImage) return postImage.thumbnailUrl || postImage.fullImageUrl || null;
	return item.profileImageMediaHash && validateMediaHash(item.profileImageMediaHash)
		? getThumbImageUrl(item.profileImageMediaHash, "320x320")
		: null;
}

function isOnline(item: RightNowFeedItem): boolean {
	return typeof item.onlineUntil === "number" && item.onlineUntil > Date.now();
}

const HOME_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="white"><path d="M11.47 3.84a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.06l-8.69-8.69a2.25 2.25 0 0 0-3.18 0l-8.69 8.69a.75.75 0 0 0 1.06 1.06l8.69-8.69Z"/><path d="m12 5.43 8.16 8.16c.03.03.06.06.09.08v6.2c0 1.04-.84 1.88-1.88 1.88H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.63a1.88 1.88 0 0 1-1.88-1.88v-6.2l.09-.08L12 5.43Z"/></svg>`;
const USER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1c0-2.76-3.58-5-8-5Z"/></svg>`;

// Grindr-style avatar pin: round profile photo with a Right Now colored ring,
// a home badge when hosting and a green dot when online. Built as plain DOM
// because maplibre markers live outside React's tree.
function buildMarkerElement(item: RightNowFeedItem, onClick: () => void): HTMLDivElement {
	const el = document.createElement("div");
	el.style.cssText = `width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;cursor:pointer;`;

	const inner = document.createElement("div");
	inner.dataset.role = "inner";
	inner.style.cssText = [
		"position:relative",
		"width:100%",
		"height:100%",
		"border-radius:9999px",
		"border:3px solid var(--right-now)",
		"background:var(--surface-2)",
		"color:var(--text-muted)",
		"box-shadow:0 4px 12px rgba(0,0,0,0.35)",
		"transition:transform 150ms ease",
		"display:flex",
		"align-items:center",
		"justify-content:center",
	].join(";");

	const imageUrl = getRightNowAvatarUrl(item);
	if (imageUrl) {
		const img = document.createElement("img");
		img.src = imageUrl;
		img.alt = "";
		img.draggable = false;
		img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:9999px;";
		inner.appendChild(img);
	} else {
		inner.innerHTML = USER_ICON_SVG;
	}

	if (item.hosting) {
		const badge = document.createElement("div");
		badge.style.cssText = "position:absolute;top:-5px;right:-5px;width:19px;height:19px;border-radius:9999px;background:var(--right-now);border:2px solid var(--bg);display:flex;align-items:center;justify-content:center;";
		badge.innerHTML = HOME_ICON_SVG;
		inner.appendChild(badge);
	}

	if (isOnline(item)) {
		const dot = document.createElement("div");
		dot.style.cssText = "position:absolute;bottom:-1px;right:-1px;width:12px;height:12px;border-radius:9999px;background:#22c55e;border:2px solid var(--bg);";
		inner.appendChild(dot);
	}

	el.appendChild(inner);
	el.addEventListener("click", (event) => {
		// Keep the map's own click (which deselects) from firing as well.
		event.stopPropagation();
		onClick();
	});
	return el;
}

// Rebuilding a marker is only needed when something it renders changed.
function markerSignature(item: RightNowMapItem): string {
	return [item.lat, item.lon, item.profileImageMediaHash ?? "", item.hosting, isOnline(item)].join("|");
}

export function RightNowMap({ items, selectedKey, onSelectKey, fitKey, topInset, recenterRef }: Props) {
	const scheme = useEffectiveColorScheme();
	const { geohash } = usePreferences();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const mapRef = useRef<any>(null);
	const maplibreRef = useRef<any>(null);
	const markersRef = useRef(new Map<string, { marker: any; signature: string }>());
	const schemeRef = useRef(scheme);
	schemeRef.current = scheme;
	const itemsRef = useRef(items);
	itemsRef.current = items;
	const topInsetRef = useRef(topInset);
	topInsetRef.current = topInset;
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
				padding: { ...FIT_PADDING, top: FIT_PADDING.top + topInsetRef.current },
				duration,
			});
			return;
		}
		const bounds = new maplibregl.LngLatBounds();
		for (const item of current) bounds.extend([item.lon, item.lat]);
		map.fitBounds(bounds, {
			padding: { ...FIT_PADDING, top: FIT_PADDING.top + topInsetRef.current },
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
		for (const item of itemsRef.current) {
			const key = getRightNowItemKey(item);
			nextKeys.add(key);
			const signature = markerSignature(item);
			const existing = markers.get(key);
			if (existing && existing.signature === signature) continue;
			existing?.marker.remove();
			const element = buildMarkerElement(item, () => onSelectKeyRef.current(key));
			const marker = new maplibregl.Marker({ element, anchor: "center" })
				.setLngLat([item.lon, item.lat])
				.addTo(map);
			markers.set(key, { marker, signature });
		}
		for (const [key, entry] of markers) {
			if (!nextKeys.has(key)) {
				entry.marker.remove();
				markers.delete(key);
			}
		}
	}, []);

	const applySelection = useCallback((key: string | null) => {
		for (const [markerKey, entry] of markersRef.current) {
			const element: HTMLElement = entry.marker.getElement();
			const inner = element.querySelector<HTMLElement>("[data-role=inner]");
			const isSelected = markerKey === key;
			if (inner) inner.style.transform = isSelected ? "scale(1.25)" : "";
			element.style.zIndex = isSelected ? "10" : "";
		}
	}, []);

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
					style: getMapStyleUrl(schemeRef.current),
					center: startCenter ?? [10, 50],
					zoom: startCenter ? 12 : 3,
					attributionControl: false,
				});
				map.on("style.load", () => {
					relaxRoadZoomThresholds(map);
					if (schemeRef.current === "dark") applyDarkMapTheme(map);
				});
				map.on("click", () => onSelectKeyRef.current(null));
				mapRef.current = map;

				syncMarkers();
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
			mapRef.current?.remove();
			mapRef.current = null;
		};
		// Map is created once; theme/items updates are applied to the live instance below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		mapRef.current?.setStyle(getMapStyleUrl(scheme));
	}, [scheme]);

	useEffect(() => {
		syncMarkers();
		applySelection(selectedKey);
		// Frame the markers once when they first show up and again whenever the
		// filters change; plain refreshes keep wherever the user panned to.
		if (items.length > 0 && fittedForRef.current !== fitKey) {
			fitToItems(fittedForRef.current === null ? 0 : 600);
			fittedForRef.current = fitKey;
		}
	}, [items, fitKey, selectedKey, syncMarkers, applySelection, fitToItems]);

	return (
		<div className="relative h-full w-full">
			<div ref={containerRef} className="absolute inset-0" style={{ isolation: "isolate" }} />
		</div>
	);
}
