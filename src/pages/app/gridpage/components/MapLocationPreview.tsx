import { useEffect, useRef } from "react";
import { useEffectiveColorScheme } from "../../../../hooks/useEffectiveColorScheme";
import { applyDarkMapTheme, createPinMarkerElement, getMapStyleUrl, relaxRoadZoomThresholds } from "./mapStyles";

type Props = {
	lat: number;
	lon: number;
	className?: string;
	interactive?: boolean;
	zoom?: number;
	/** Draws a translucent accuracy circle of this radius (meters) around the pin. */
	radiusMeters?: number;
};

const ACCURACY_SOURCE_ID = "accuracy-circle";

function buildCirclePolygon(lat: number, lon: number, radiusMeters: number, steps = 64) {
	const latRadius = radiusMeters / 111320;
	const lonRadius = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
	const ring: [number, number][] = [];
	for (let i = 0; i <= steps; i++) {
		const angle = (i / steps) * 2 * Math.PI;
		ring.push([lon + lonRadius * Math.cos(angle), lat + latRadius * Math.sin(angle)]);
	}
	return {
		type: "Feature" as const,
		properties: {},
		geometry: { type: "Polygon" as const, coordinates: [ring] },
	};
}

// Adds (or updates) the accuracy circle. Safe to call before the style has
// loaded — it bails out and the style.load handler calls it again.
function syncAccuracyCircle(map: any, lat: number, lon: number, radiusMeters?: number) {
	if (!map.isStyleLoaded()) return;
	const hasRadius = Boolean(radiusMeters && radiusMeters > 0);
	const source = map.getSource(ACCURACY_SOURCE_ID);
	if (!hasRadius) {
		if (source) {
			map.removeLayer(`${ACCURACY_SOURCE_ID}-line`);
			map.removeLayer(`${ACCURACY_SOURCE_ID}-fill`);
			map.removeSource(ACCURACY_SOURCE_ID);
		}
		return;
	}
	const data = buildCirclePolygon(lat, lon, radiusMeters!);
	if (source) {
		source.setData(data);
		return;
	}
	const color =
		getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ffcc01";
	map.addSource(ACCURACY_SOURCE_ID, { type: "geojson", data });
	map.addLayer({
		id: `${ACCURACY_SOURCE_ID}-fill`,
		type: "fill",
		source: ACCURACY_SOURCE_ID,
		paint: { "fill-color": color, "fill-opacity": 0.15 },
	});
	map.addLayer({
		id: `${ACCURACY_SOURCE_ID}-line`,
		type: "line",
		source: ACCURACY_SOURCE_ID,
		paint: { "line-color": color, "line-width": 1.5, "line-opacity": 0.6 },
	});
}

// Frames the accuracy circle when there is one, otherwise just recenters.
function focusPosition(map: any, lat: number, lon: number, radiusMeters: number | undefined, duration: number) {
	if (radiusMeters && radiusMeters > 0) {
		const dLat = radiusMeters / 111320;
		const dLon = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
		map.fitBounds(
			[[lon - dLon, lat - dLat], [lon + dLon, lat + dLat]],
			{ padding: 40, maxZoom: 17, duration },
		);
		return;
	}
	map.easeTo({ center: [lon, lat], duration });
}

export function MapLocationPreview({
	lat,
	lon,
	className = "h-32 w-full",
	interactive = false,
	zoom = 15,
	radiusMeters,
}: Props) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const mapRef = useRef<any>(null);
	const markerRef = useRef<any>(null);
	const scheme = useEffectiveColorScheme();
	// Latest position, read by the (re)initialising effect so a position
	// change doesn't tear down and rebuild the whole map.
	const positionRef = useRef({ lat, lon, radiusMeters });
	positionRef.current = { lat, lon, radiusMeters };

	useEffect(() => {
		let mounted = true;

		const init = async () => {
			try {
				const maplibregl = (await import("maplibre-gl")).default;
				await import("maplibre-gl/dist/maplibre-gl.css");
				if (!mounted || !containerRef.current || mapRef.current) return;

				const start = positionRef.current;
				const map = new maplibregl.Map({
					container: containerRef.current,
					style: getMapStyleUrl(scheme),
					center: [start.lon, start.lat],
					zoom,
					interactive,
					attributionControl: false,
				});

				map.on("style.load", () => {
					relaxRoadZoomThresholds(map);
					if (scheme === "dark") applyDarkMapTheme(map);
					const current = positionRef.current;
					syncAccuracyCircle(map, current.lat, current.lon, current.radiusMeters);
				});

				markerRef.current = new maplibregl.Marker({ element: createPinMarkerElement(), anchor: "bottom" })
					.setLngLat([start.lon, start.lat])
					.addTo(map);

				if (start.radiusMeters && start.radiusMeters > 0) {
					focusPosition(map, start.lat, start.lon, start.radiusMeters, 0);
				}
				mapRef.current = map;
			} catch {
				// silently fail
			}
		};

		void init();

		return () => {
			mounted = false;
			markerRef.current = null;
			if (mapRef.current) {
				mapRef.current.remove();
				mapRef.current = null;
			}
		};
	}, [scheme, interactive, zoom]);

	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;
		markerRef.current?.setLngLat([lon, lat]);
		syncAccuracyCircle(map, lat, lon, radiusMeters);
		focusPosition(map, lat, lon, radiusMeters, 600);
	}, [lat, lon, radiusMeters]);

	return <div ref={containerRef} className={className} style={{ isolation: "isolate" }} />;
}
