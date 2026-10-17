/**
 * Free, key-less CARTO basemap styles (vector, MapLibre GL JSON).
 * https://carto.com/basemaps — usable without authentication for both
 * the light ("voyager") and dark ("dark-matter") themes used across the app.
 */
export const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
export const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export function getMapStyleUrl(scheme: "light" | "dark"): string {
	return scheme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
}

function readCssColor(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/** Mixes two #rrggbb colors; `amount` is the share of `b` (0..1). */
function mixHex(a: string, b: string, amount: number): string {
	const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
	return `#${[0, 1, 2]
		.map((i) => Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount).toString(16).padStart(2, "0"))
		.join("")}`;
}

/**
 * CARTO's dark-matter style defaults to a near-monochrome black map where
 * roads/rail barely register. Re-tint it with the app's own dark palette
 * (the --dark-* tokens, so AMOLED mode follows too, plus a hint of the user's
 * accent) so the map reads as part of the app. Call after the style has
 * (re)loaded, e.g. on the MapLibre "style.load" event.
 */
export function applyDarkMapTheme(map: any): void {
	const bg = readCssColor("--dark-bg", "#0f131a");
	const surface2 = readCssColor("--dark-surface-2", "#1f2835");
	const textMuted = readCssColor("--dark-text-muted", "#96a2b6");
	const accent = readCssColor("--accent", "#7c3aed");

	// Land a step lighter than surface-2: maps sit inside dialogs/sheets whose
	// backgrounds are surface/surface-2, and land in exactly those colors made
	// the map melt into them. Water stays dark, so the contrast reads clearly.
	// AMOLED keeps it darker: only a hair above surface-2 so it stays distinct.
	const isAmoled = document.documentElement.getAttribute("data-amoled") === "true";
	const LAND = mixHex(surface2, textMuted, isAmoled ? 0.03 : 0.08);
	const PARK = mixHex(LAND, "#2f7a55", 0.22);
	const BUILDING = mixHex(LAND, textMuted, 0.08);
	const WATER = mixHex(bg, accent, 0.12);
	const ROAD_CASE = mixHex(LAND, bg, 0.5);
	const ROAD_FILL = mixHex(LAND, textMuted, 0.4);
	// The accent marks the road hierarchy (like Google's highway color):
	// motorways/trunks clearly in the accent, primaries a light touch, the
	// rest stays neutral so the map isn't drowned in it.
	const ROAD_MAJOR_FILL = mixHex(ROAD_FILL, accent, 0.6);
	const ROAD_PRIMARY_FILL = mixHex(ROAD_FILL, accent, 0.25);
	const ROAD_MINOR_FILL = mixHex(LAND, textMuted, 0.16);
	const RAIL = mixHex(LAND, textMuted, 0.25);
	const RAIL_DASH = mixHex(LAND, textMuted, 0.12);
	const LABEL = textMuted;
	const PLACE_LABEL = mixHex(mixHex(textMuted, "#ffffff", 0.25), accent, 0.2);
	// Dense and secondary: a step quieter than street/place names.
	const HOUSENUMBER = mixHex(textMuted, LAND, 0.3);

	try {
		for (const layer of map.getStyle()?.layers ?? []) {
			const id: string = layer.id;
			try {
				if (layer.type === "background") {
					map.setPaintProperty(id, "background-color", LAND);
				} else if (layer.type === "fill") {
					if (/^park/.test(id)) {
						map.setPaintProperty(id, "fill-color", PARK);
					} else if (/water/i.test(id)) {
						map.setPaintProperty(id, "fill-color", WATER);
					} else if (/building/i.test(id)) {
						map.setPaintProperty(id, "fill-color", BUILDING);
					} else if (id === "landcover" || id === "landuse") {
						map.setPaintProperty(id, "fill-color", LAND);
					}
				} else if (layer.type === "symbol" && layer.layout?.["text-field"] != null) {
					const isHousenumber = id === "housenumber" || layer["source-layer"] === "housenumber";
					const isPlace = /^place_(city|town|capital)/.test(id);
					map.setPaintProperty(id, "text-color", isHousenumber ? HOUSENUMBER : isPlace ? PLACE_LABEL : LABEL);
					map.setPaintProperty(id, "text-halo-color", bg);
					if (isHousenumber) map.setPaintProperty(id, "text-halo-width", 1);
				} else if (layer.type === "line") {
					if (layer["source-layer"] === "transportation") {
						if (/rail/.test(id)) {
							map.setPaintProperty(id, "line-color", /dash/.test(id) ? RAIL_DASH : RAIL);
						} else if (/case/.test(id)) {
							map.setPaintProperty(id, "line-color", ROAD_CASE);
						} else if (/service|path|minor/.test(id)) {
							map.setPaintProperty(id, "line-color", ROAD_MINOR_FILL);
						} else if (/_(mot|trunk)_fill/.test(id)) {
							map.setPaintProperty(id, "line-color", ROAD_MAJOR_FILL);
						} else if (/_pri_fill/.test(id)) {
							map.setPaintProperty(id, "line-color", ROAD_PRIMARY_FILL);
						} else {
							map.setPaintProperty(id, "line-color", ROAD_FILL);
						}
					} else if (/water/i.test(id)) {
						map.setPaintProperty(id, "line-color", WATER);
					}
				}
			} catch {
				// skip a layer that doesn't take this property
			}
		}
	} catch {
		// best-effort theming; skip if the upstream style schema changed
	}
}

/**
 * Futuristic "neon night" look for the Right Now map, built on CARTO's
 * dark-matter style: near-black violet land, deep water, major roads as
 * softly glowing lines in the Right Now color, minor roads in a muted violet
 * and lavender labels. `accent` is a hex color (the resolved --right-now).
 * Call after the style has (re)loaded, e.g. on the MapLibre "style.load" event.
 */
export function applyRightNowMapTheme(map: any, accent: string): void {
	const LAND = "#0c0918";
	const PARK = "#110d22";
	const BUILDING = "#16102b";
	const WATER = "#05040f";
	const ROAD_CASE = "#08060f";
	const ROAD_MINOR = "#2a1f47";
	const RAIL = "#3a2c62";
	const BOUNDARY = "#3b2d66";
	const LABEL = "#c4b5fd";
	const LABEL_HALO = "#0a0714";
	// House numbers are dense; keep them a step quieter than street/place names.
	const HOUSENUMBER = "#7d70a8";

	try {
		for (const layer of map.getStyle()?.layers ?? []) {
			const id: string = layer.id;
			try {
				if (layer.type === "background") {
					map.setPaintProperty(id, "background-color", LAND);
				} else if (layer.type === "fill") {
					if (/water/i.test(id)) {
						map.setPaintProperty(id, "fill-color", WATER);
					} else if (/building/i.test(id)) {
						map.setPaintProperty(id, "fill-color", BUILDING);
					} else if (/^park|landcover|landuse/.test(id)) {
						map.setPaintProperty(id, "fill-color", /^park/.test(id) ? PARK : LAND);
					}
				} else if (layer.type === "line") {
					if (layer["source-layer"] === "transportation") {
						if (/rail/.test(id)) {
							map.setPaintProperty(id, "line-color", RAIL);
						} else if (/case/.test(id)) {
							map.setPaintProperty(id, "line-color", ROAD_CASE);
						} else if (/service|path|minor/.test(id)) {
							map.setPaintProperty(id, "line-color", ROAD_MINOR);
						} else {
							// Major roads: neon lines with a slight blur for the glow.
							map.setPaintProperty(id, "line-color", accent);
							map.setPaintProperty(id, "line-opacity", 0.55);
							map.setPaintProperty(id, "line-blur", 0.6);
						}
					} else if (/water/i.test(id)) {
						map.setPaintProperty(id, "line-color", WATER);
					} else if (/boundary/i.test(id)) {
						map.setPaintProperty(id, "line-color", BOUNDARY);
					}
				} else if (layer.type === "symbol" && layer.layout?.["text-field"] != null) {
					const isHousenumber = id === "housenumber" || layer["source-layer"] === "housenumber";
					map.setPaintProperty(id, "text-color", isHousenumber ? HOUSENUMBER : LABEL);
					map.setPaintProperty(id, "text-halo-color", LABEL_HALO);
					map.setPaintProperty(id, "text-opacity", isHousenumber ? 0.6 : 0.75);
				}
			} catch {
				// skip a layer that doesn't take this property
			}
		}
	} catch {
		// best-effort theming; skip if the upstream style schema changed
	}
}

/**
 * CARTO's basemap styles only switch on street-name labels quite late
 * (minor roads need zoom 16+), and house numbers later still (zoom 17+,
 * the "housenumber" layer). Lower both thresholds so they become visible
 * sooner while zooming in — useful for picking a precise location. Call
 * after the style has (re)loaded, e.g. on the MapLibre "style.load" event.
 */
export function relaxRoadZoomThresholds(map: any): void {
	try {
		for (const layer of map.getStyle()?.layers ?? []) {
			if (layer.type !== "symbol") continue;
			if (/^roadname_/.test(layer.id) && typeof layer.minzoom === "number") {
				map.setLayerZoomRange(layer.id, Math.max(0, layer.minzoom - 2), layer.maxzoom ?? 24);
			} else if (layer.id === "housenumber" || layer["source-layer"] === "housenumber") {
				// The underlying tile source's real data tops out at zoom 14
				// (everything past that is the same tile overzoomed), so 14 is
				// the earliest this layer can show anything regardless of the
				// style's declared minzoom. Its default text-size is also a
				// zoom-stop function starting at 17 (9px), which clamps to
				// that same tiny size for any zoom below it — fix the size too
				// so house numbers are actually legible once they appear.
				map.setLayerZoomRange(layer.id, 14, layer.maxzoom ?? 24);
				try {
					map.setLayoutProperty(layer.id, "text-size", 11);
				} catch {
					// non-fatal — zoom range relaxation above still applies
				}
			}
		}
	} catch {
		// best-effort tweak; skip if the upstream style schema changed
	}
}

export function createPinMarkerElement(accentColor?: string): HTMLDivElement {
	const color =
		accentColor ||
		getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() ||
		"#7c3aed";

	const el = document.createElement("div");
	el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3" fill="white" stroke="white"/></svg>`;
	return el;
}
