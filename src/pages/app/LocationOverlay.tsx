import { Bookmark, Check, Compass, Home, Loader2, MapPin, Navigation, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import z from "zod";
import { BottomSheet, useBottomSheetClose, SheetCloseButton, SHEET_ICON_BUTTON_CLASS } from "../../components/ui/bottom-sheet";
import { SlidingTabs } from "../../components/ui/sliding-tabs";
import { HomeFilled, LocateFixedFilled, MapPinFilled } from "../../components/icons/FilledIcons";
import { usePreferences } from "../../contexts/PreferencesContext";
import { appLog } from "../../utils/logger";
import { getCurrentLocation, getLocationErrorMessageKey } from "../../services/currentLocation";
import { decodeGeohash, encodeGeohash } from "../../utils/geohash";
import { type GeocodeResult, type SelectedLocation, geocodeResultSchema } from "./GridPage.types";
import { LocationChip, SavedLocationChip } from "./gridpage/components/LocationChips";
import { MapLocationPicker } from "./gridpage/components/MapLocationPicker";
import {
	formatNominatimAddress,
	getCityFromAddress,
	reverseGeocodeCityForGeohash,
	reverseGeocodeGeohash,
} from "./gridpage/geocoding";
import {
	addSavedLocation,
	deleteSavedLocation,
	loadSavedLocations,
	type SavedLocation,
} from "../../services/savedLocations";
import {
	useHomeLocation,
	useUpdateHomeLocation,
	useUpdateVisitingMode,
	useVisitingMode,
} from "../../hooks/queries/useProfileQueries";
import { VISITING_MODES, getVisitingModeTranslationKey, type VisitingMode } from "../../types/visiting";

export type ExploreLocation = { geohash: string; label: string } | null;

// Explore gets its own accent (distinct from the app's --accent, used for the
// real/"set" location) so the two modes are never visually ambiguous — same
// color everywhere it shows up: this sheet's tab/chips/buttons and
// GridPage's header pill.
export const EXPLORE_COLOR = "#3b82f6";

interface LocationOverlayProps {
	onClose: () => void;
	exploreLocation: ExploreLocation;
	onSetExploreLocation: (next: ExploreLocation) => void;
	isDesktop: boolean;
}

// The map pin. isAuto marks a pick that came from GPS, so confirming it turns
// on auto-location instead of saving a fixed spot.
type PinnedLocation = SelectedLocation & { isAuto?: boolean };

function geohashCenter(geohash: string): { lat: number; lon: number } | null {
	try {
		const decoded = decodeGeohash(geohash);
		return { lat: (decoded.lat[0] + decoded.lat[1]) / 2, lon: (decoded.lon[0] + decoded.lon[1]) / 2 };
	} catch {
		return null;
	}
}

export function LocationOverlay({ onClose, isDesktop, ...props }: LocationOverlayProps) {
	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="max-h-[92dvh] px-4"
		>
			<LocationSheetContent isDesktop={isDesktop} {...props} />
		</BottomSheet>
	);
}

function LocationSheetContent({
	exploreLocation,
	onSetExploreLocation,
	isDesktop,
}: Omit<LocationOverlayProps, "onClose">) {
	const { t } = useTranslation();
	const close = useBottomSheetClose();
	const { setPreferences, geohash, locationName, useAutoLocation, autoFocusLocationSearch } = usePreferences();

	// Which of the two ways to pick a location is active: "set" changes the
	// real geohash (visible to others, persisted). "explore" browses a
	// different area via /v7/search's exploreGeoHash without touching it —
	// see GridPage's exploreLocation state for why this stays out of
	// preferences. Defaults to whichever is already in effect.
	const [activeTab, setActiveTab] = useState<"set" | "explore">(exploreLocation ? "explore" : "set");
	const isExploreTab = activeTab === "explore";
	const tabColor = isExploreTab ? EXPLORE_COLOR : "var(--accent)";
	const tabContrast = isExploreTab ? "#fff" : "var(--accent-contrast)";

	const [isDetectingLocation, setIsDetectingLocation] = useState(false);
	const [locationQuery, setLocationQuery] = useState("");
	const [isSearchingLocation, setIsSearchingLocation] = useState(false);
	const [locationResults, setLocationResults] = useState<GeocodeResult[]>([]);
	const [mapPickerError, setMapPickerError] = useState<string | null>(null);
	const [lastSearchedQuery, setLastSearchedQuery] = useState("");
	const [selectedLocation, setSelectedLocation] = useState<PinnedLocation | null>(null);
	const [locationError, setLocationError] = useState<string | null>(null);
	const [currentLocationError, setCurrentLocationError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
	const [isNamingLocation, setIsNamingLocation] = useState(false);
	const [newLocationName, setNewLocationName] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		void loadSavedLocations().then(setSavedLocations);
	}, []);

	// Home location + visiting mode are account-wide profile settings (not
	// grid-browsing preferences like geohash above), but they're both about
	// "where/how your profile shows up" so they live in this same sheet
	// rather than the profile editor. Both save immediately, no separate
	// "Save" step. Visiting mode is rarely changed, so it sits in its own
	// sheet behind the header icon.
	const { data: homeLocation } = useHomeLocation();
	const updateHomeLocation = useUpdateHomeLocation();
	const { data: visitingMode } = useVisitingMode();
	const [isVisitingModeOpen, setIsVisitingModeOpen] = useState(false);
	const VisitingModeIcon = VISITING_MODE_ICONS[visitingMode ?? "AUTO"];

	const handleSetAsHome = async (lat: number, lon: number) => {
		try {
			await updateHomeLocation.mutateAsync({ lat, lon });
			toast.success(t("browse_location.home_updated_toast"));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("browse_location.home_update_failed"));
		}
	};

	// Derived directly from geohash (not one-time state) so it can never go
	// stale — geohash itself can change while this sheet is open (e.g. right
	// after saving a pick, before the close animation has unmounted it).
	const savedCenter = useMemo<[number, number] | undefined>(() => {
		const center = geohash ? geohashCenter(geohash) : null;
		return center ? [center.lat, center.lon] : undefined;
	}, [geohash]);
	const [gpsFallbackCenter, setGpsFallbackCenter] = useState<[number, number] | undefined>(undefined);
	const initialCenter = savedCenter ?? gpsFallbackCenter;

	// Keeps the pin on the active location of the current tab — the saved
	// geohash for "set", the explore location (or the real location as a
	// starting point) for "explore". Re-runs on tab switch and whenever the
	// underlying location changes, not just once on mount.
	useEffect(() => {
		const source = isExploreTab
			? exploreLocation ?? (geohash ? { geohash, label: locationName ?? t("browse_location.current_location_label") } : null)
			: geohash
				? { geohash, label: locationName ?? t("browse_location.current_location_label") }
				: null;
		if (!source) return;
		const center = geohashCenter(source.geohash);
		if (!center) return;
		const isAuto = !isExploreTab && useAutoLocation;
		setSelectedLocation((current) =>
			current && current.lat === center.lat && current.lon === center.lon && !!current.isAuto === isAuto
				? current
				: { ...center, label: source.label, isAuto },
		);
	}, [isExploreTab, exploreLocation, geohash, locationName, useAutoLocation, t]);

	// No saved location to center on yet (fresh user) — try the device's
	// current position just to position the map sensibly. This only nudges
	// where the map opens; it doesn't pick/select anything, so no
	// permission-denied error needs surfacing.
	useEffect(() => {
		if (geohash) return;
		void (async () => {
			try {
				const tauriGeo = await import("@tauri-apps/plugin-geolocation").catch(() => null);
				if (tauriGeo) {
					const perms = await tauriGeo.checkPermissions();
					if (perms.location !== "granted") return;
					const pos = await tauriGeo.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
					setGpsFallbackCenter([pos.coords.latitude, pos.coords.longitude]);
					return;
				}
				if (!("geolocation" in navigator)) return;
				const pos = await new Promise<GeolocationPosition>((res, rej) =>
					navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }),
				);
				setGpsFallbackCenter([pos.coords.latitude, pos.coords.longitude]);
			} catch {
				// no permission yet / unavailable — map just opens at the world view
			}
		})();
	}, [geohash]);

	useEffect(() => {
		if (!autoFocusLocationSearch) return;
		// Wait for the sheet's slide-in before focusing (and opening the keyboard).
		const timer = setTimeout(() => searchInputRef.current?.focus(), 320);
		return () => clearTimeout(timer);
	}, [autoFocusLocationSearch]);

	const saveAndClose = async (lat: number, lon: number, label: string, isAuto = false) => {
		setIsSaving(true);
		try {
			await setPreferences({ geohash: encodeGeohash(lat, lon), locationName: label, useAutoLocation: isAuto });
			// Setting your real location while still "exploring" elsewhere would
			// leave the grid showing a place you just moved away from — end
			// explore whenever you actually commit a new real location.
			if (exploreLocation) {
				onSetExploreLocation(null);
			}
			close();
		} catch {
			setLocationError(t("browse_location.error_search_failed"));
		} finally {
			setIsSaving(false);
		}
	};

	// Explore is local-only state (see GridPage), so unlike saveAndClose there's
	// no request to await — it just updates the parent and closes.
	const confirmExplore = (lat: number, lon: number, label: string) => {
		onSetExploreLocation({ geohash: encodeGeohash(lat, lon), label });
		close();
	};

	const stopExploring = () => {
		onSetExploreLocation(null);
		close();
	};

	// Resolves the geocoded place name for a GPS fix, so the header pill shows
	// the same "Street Number, City, District" format as every other way of
	// picking a location. Falls back to the generic text if the lookup fails.
	const resolveGpsLabel = async (lat: number, lon: number): Promise<string> => {
		const label = await reverseGeocodeGeohash(encodeGeohash(lat, lon)).catch(() => null);
		return label ?? t("browse_location.current_location_label");
	};

	// Only moves the pin (flagged as auto) — confirming happens via the footer
	// button, same as every other chip.
	const handleUseCurrentLocation = async () => {
		setIsDetectingLocation(true);
		setCurrentLocationError(null);
		try {
			const { lat, lon } = await getCurrentLocation();
			const label = await resolveGpsLabel(lat, lon);
			setSelectedLocation({ lat, lon, label, isAuto: true });
		} catch (e) {
			appLog.error("Geolocation failed", e);
			setCurrentLocationError(t(getLocationErrorMessageKey(e)));
		} finally {
			setIsDetectingLocation(false);
		}
	};

	const performSearch = async (query: string, signal?: AbortSignal) => {
		if (!query || query === lastSearchedQuery) { setIsSearchingLocation(false); return; }
		setLastSearchedQuery(query);
		setIsSearchingLocation(true);
		try {
			const res = await fetch(
				`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`,
				{ signal, headers: { "User-Agent": "Mozilla/5.0 (compatible)" } },
			);
			if (!res.ok) throw new Error("search failed");
			setLocationResults(z.array(geocodeResultSchema).parse(await res.json()));
			setLocationError(null);
		} catch (e) {
			if (e instanceof Error && e.name === "AbortError") return;
			appLog.error("Location search failed", e);
			setLocationError(t("browse_location.error_search_failed"));
		} finally {
			setIsSearchingLocation(false);
		}
	};

	useEffect(() => {
		const query = locationQuery.trim();
		if (query.length < 2) { setLocationResults([]); setIsSearchingLocation(false); setLastSearchedQuery(""); return; }
		const ctrl = new AbortController();
		const timer = setTimeout(() => void performSearch(query, ctrl.signal), 500);
		return () => { clearTimeout(timer); ctrl.abort(); };
	}, [locationQuery]);

	const clearSearch = () => { setLocationQuery(""); setLocationResults([]); setLastSearchedQuery(""); searchInputRef.current?.focus(); };
	const isSearching = locationQuery.trim().length > 0;

	const pinGeohash = selectedLocation ? encodeGeohash(selectedLocation.lat, selectedLocation.lon) : null;
	const isPinManual = !selectedLocation?.isAuto;
	const homeGeohash = homeLocation ? encodeGeohash(homeLocation.lat, homeLocation.lon) : null;
	const pinnedSavedLocation = isPinManual ? savedLocations.find((saved) => saved.geohash === pinGeohash) : undefined;
	// Home already has its own chip, so saving it again would only duplicate it.
	const isPinOnHome = isPinManual && !!homeGeohash && pinGeohash === homeGeohash;

	// Whether the pin already is the active location of this tab — nothing to
	// confirm then, so the footer button stays disabled.
	const isActiveLocationSelected = isExploreTab
		? !!exploreLocation && pinGeohash === exploreLocation.geohash
		: !!geohash && pinGeohash === geohash && !!selectedLocation?.isAuto === useAutoLocation;

	const pinLocation = (lat: number, lon: number, label: string) => {
		setSelectedLocation({ lat, lon, label, city: null });
		setIsNamingLocation(false);
	};

	const handleMapPick = (lat: number, lon: number) => {
		const fallbackLabel = t("browse_location.lat_lon_label", { lat: lat.toFixed(4), lon: lon.toFixed(4) });
		pinLocation(lat, lon, t("browse_location.resolving_location"));
		const geohashForPick = encodeGeohash(lat, lon);
		void reverseGeocodeGeohash(geohashForPick).then((label) => {
			setSelectedLocation((current) =>
				current && current.lat === lat && current.lon === lon
					? { ...current, label: label ?? fallbackLabel }
					: current,
			);
		});
		void reverseGeocodeCityForGeohash(geohashForPick).then((city) => {
			setSelectedLocation((current) =>
				current && current.lat === lat && current.lon === lon ? { ...current, city } : current,
			);
		});
	};

	const handleSelectSearchResult = (result: GeocodeResult) => {
		const lat = Number(result.lat);
		const lon = Number(result.lon);
		// Search results carry an address breakdown (addressdetails=1), so
		// format it the same way as everywhere else right away; the
		// reverse-geocode call below still refines it afterwards in case
		// that lookup resolves a more precise/different address.
		const initialLabel = (result.address && formatNominatimAddress(result.address, result.display_name)) ?? result.display_name;
		const initialCity = result.address ? getCityFromAddress(result.address) : null;
		setSelectedLocation({ lat, lon, label: initialLabel, city: initialCity });
		setIsNamingLocation(false);
		setLocationQuery("");
		setLocationResults([]);
		setLastSearchedQuery("");
		searchInputRef.current?.blur();
		const geohashForResult = encodeGeohash(lat, lon);
		void reverseGeocodeGeohash(geohashForResult).then((label) => {
			if (!label) return;
			setSelectedLocation((current) =>
				current && current.lat === lat && current.lon === lon ? { ...current, label } : current,
			);
		});
		if (!initialCity) {
			void reverseGeocodeCityForGeohash(geohashForResult).then((city) => {
				if (!city) return;
				setSelectedLocation((current) =>
					current && current.lat === lat && current.lon === lon ? { ...current, city } : current,
				);
			});
		}
	};

	// Bookmark/trash button in the footer: removes the pinned spot if it's
	// already saved, otherwise opens the naming field to save it.
	const handleToggleBookmark = () => {
		if (pinnedSavedLocation) {
			void deleteSavedLocation(pinnedSavedLocation.id).then(setSavedLocations);
			return;
		}
		setIsNamingLocation((v) => {
			const next = !v;
			if (next && !newLocationName.trim() && selectedLocation?.city) {
				setNewLocationName(selectedLocation.city);
			}
			return next;
		});
	};

	const handleSaveCurrentAsNamedLocation = () => {
		const name = newLocationName.trim();
		if (!name || !selectedLocation) return;
		void addSavedLocation({
			name,
			geohash: encodeGeohash(selectedLocation.lat, selectedLocation.lon),
			lat: selectedLocation.lat,
			lon: selectedLocation.lon,
		}).then(setSavedLocations);
		// Saved locations apply under their name, so the pin takes it too.
		setSelectedLocation((current) => (current ? { ...current, label: name, isAuto: false } : current));
		setNewLocationName("");
		setIsNamingLocation(false);
	};

	const handleConfirm = () => {
		if (!selectedLocation) return;
		if (isExploreTab) {
			confirmExplore(selectedLocation.lat, selectedLocation.lon, selectedLocation.label);
		} else {
			void saveAndClose(selectedLocation.lat, selectedLocation.lon, selectedLocation.label, !!selectedLocation.isAuto);
		}
	};

	return (
		<>
			{/* Header */}
			<div className="mb-3 flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h3 className="text-sm font-semibold text-[var(--text)]">{t("browse_location.title")}</h3>
					{exploreLocation ? (
						<p className="mt-0.5 flex items-center gap-1 text-xs" style={{ color: EXPLORE_COLOR }}>
							<Search className="h-3 w-3 shrink-0" />
							<span className="truncate">{t("browse_location.exploring_label", { label: exploreLocation.label })}</span>
						</p>
					) : locationName ? (
						<p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
							{useAutoLocation
								? <Navigation className="h-3 w-3 shrink-0 text-[var(--accent)]" />
								: <MapPin className="h-3 w-3 shrink-0 text-[var(--accent)]" />}
							<span className="truncate">{locationName}</span>
						</p>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{!isExploreTab && (
						<button
							type="button"
							onClick={() => setIsVisitingModeOpen(true)}
							title={t("profile_editor.sections.visiting_mode.title")}
							aria-label={t("profile_editor.sections.visiting_mode.title")}
							className={SHEET_ICON_BUTTON_CLASS}
						>
							<VisitingModeIcon className="h-4 w-4" />
						</button>
					)}
					<SheetCloseButton />
				</div>
			</div>

			{/* Set vs. Explore: "set" changes your real, visible location;
			    "explore" only changes what you browse — see confirmExplore.
			    Explore gets its own color (EXPLORE_COLOR) everywhere, kept
			    distinct from the app's --accent used for "set". */}
			{/* Override only for explore: setting --accent to var(--accent) would be a
			    self-referencing custom property, which CSS treats as invalid. */}
			<div
				className="mb-3 shrink-0"
				style={isExploreTab ? ({ "--accent": EXPLORE_COLOR, "--accent-contrast": "#fff" } as React.CSSProperties) : undefined}
			>
				<SlidingTabs<"set" | "explore">
					value={activeTab}
					onChange={(tab) => {
						setActiveTab(tab);
						// Leaving the explore tab ends explore right away, not just
						// once a new real location is confirmed — otherwise the grid
						// would keep showing the explored area while this tab implies
						// you're back to your real location.
						if (tab === "set" && exploreLocation) {
							onSetExploreLocation(null);
						}
					}}
					tabs={[
						{ value: "set", icon: <MapPin className="h-3.5 w-3.5" />, label: t("browse_location.tab_set") },
						{ value: "explore", icon: <Search className="h-3.5 w-3.5" />, label: t("browse_location.tab_explore") },
					]}
				/>
			</div>

			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-1" data-lenis-prevent>
				{locationError && (
					<div className="mb-3 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
						<X className="h-4 w-4 shrink-0" />
						{locationError}
					</div>
				)}

				{/* Search bar */}
				<div
					className="relative mb-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] transition focus-within:border-[var(--tab-color)]"
					style={{ "--tab-color": tabColor } as React.CSSProperties}
				>
					<Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
					<input
						ref={searchInputRef}
						type="text"
						value={locationQuery}
						onChange={(e) => setLocationQuery(e.target.value)}
						placeholder={t("browse_location.search_placeholder")}
						className="h-11 w-full bg-transparent pl-10 pr-10 text-sm text-[var(--text)] outline-none"
					/>
					{isSearchingLocation ? (
						<Loader2 className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />
					) : locationQuery ? (
						<button
							type="button"
							onClick={clearSearch}
							className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--text-muted)] transition hover:text-[var(--text)]"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					) : null}
				</div>

				{/* Map, with search results laid over it while searching — the map
				    stays mounted so it doesn't reload after picking a result. */}
				<div className="relative overflow-hidden rounded-2xl" style={{ height: isDesktop ? "42vh" : "34dvh" }}>
					{mapPickerError ? (
						<p className="px-4 py-4 text-sm text-[var(--text-muted)]">{mapPickerError}</p>
					) : (
						<MapLocationPicker
							selectedLocation={selectedLocation}
							onPick={handleMapPick}
							onError={setMapPickerError}
							className="h-full w-full"
							defaultZoom={11}
							initialCenter={initialCenter}
							pinColor={isExploreTab ? EXPLORE_COLOR : undefined}
							modifierWheelZoom
						/>
					)}
					{selectedLocation && !isSearching ? (
						<div className="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center">
							<div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
								<MapPinFilled className="h-3.5 w-3.5 shrink-0" />
								<span className="truncate">{selectedLocation.label}</span>
							</div>
						</div>
					) : null}
					{isSearching ? (
						// z-10: MapLibre's controls carry their own z-index and would poke through.
						<div className="absolute inset-0 z-10 overflow-y-auto bg-[var(--surface-2)]" data-lenis-prevent>
							{locationResults.length > 0 ? (
								<div className="divide-y divide-[var(--border)]">
									{locationResults.map((result) => (
										<button
											key={`${result.lat}:${result.lon}`}
											type="button"
											onClick={() => handleSelectSearchResult(result)}
											className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition hover:bg-[var(--surface-3,var(--surface))] active:bg-[var(--surface)]"
										>
											<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--surface)] text-[var(--text-muted)]">
												<MapPin className="h-3.5 w-3.5" />
											</div>
											<span className="line-clamp-2 text-sm text-[var(--text)]">
												{(result.address && formatNominatimAddress(result.address, result.display_name)) ?? result.display_name}
											</span>
										</button>
									))}
								</div>
							) : !isSearchingLocation ? (
								<p className="px-4 py-4 text-sm text-[var(--text-muted)]">{t("browse_location.error_search_failed_general")}</p>
							) : null}
						</div>
					) : null}
				</div>

				{/* Quick picks — same chip row as the chat's share-location sheet.
				    Tapping one only moves the pin; the footer button confirms. */}
				<div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{isExploreTab && exploreLocation ? (
						<LocationChip
							icon={<X className="h-4 w-4" />}
							title={t("browse_location.stop_explore")}
							subtitle={exploreLocation.label}
							isActive={false}
							onClick={stopExploring}
							accentColor={EXPLORE_COLOR}
							accentContrast="#fff"
						/>
					) : null}
					{!isExploreTab ? (
						<LocationChip
							icon={isDetectingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixedFilled className="h-4 w-4" />}
							title={t("browse_location.current_location_label")}
							subtitle={
								isDetectingLocation
									? t("browse_location.detecting_location")
									: useAutoLocation && locationName
										? locationName
										: t("browse_location.mode_gps")
							}
							isActive={!!selectedLocation?.isAuto}
							disabled={isDetectingLocation}
							onClick={() => void handleUseCurrentLocation()}
						/>
					) : null}
					{!isExploreTab && homeLocation ? (
						<LocationChip
							icon={<HomeFilled className="h-4 w-4" />}
							title={t("browse_location.home_location_label")}
							subtitle={homeLocation.name ?? null}
							isActive={isPinOnHome}
							onClick={() => pinLocation(homeLocation.lat, homeLocation.lon, homeLocation.name)}
						/>
					) : null}
					{savedLocations.map((saved) => (
						<SavedLocationChip
							key={saved.id}
							location={saved}
							isActive={pinnedSavedLocation?.id === saved.id}
							onClick={() => pinLocation(saved.lat, saved.lon, saved.name)}
							accentColor={tabColor}
							accentContrast={tabContrast}
						/>
					))}
				</div>
				{currentLocationError && !isExploreTab ? (
					<p className="mt-2 px-1 text-[11px] text-red-500">{currentLocationError}</p>
				) : savedLocations.length === 0 ? (
					<p className="mt-2 px-1 text-[11px] text-[var(--text-muted)]">
						{t("browse_location.saved_hint", { defaultValue: "Tap the bookmark below to save the pinned spot for quick access." })}
					</p>
				) : null}

				{isNamingLocation && (
					<div className="mt-3 flex gap-2">
						<input
							type="text"
							autoFocus
							value={newLocationName}
							onChange={(e) => setNewLocationName(e.target.value)}
							onKeyDown={(e) => { if (e.key === "Enter") handleSaveCurrentAsNamedLocation(); }}
							placeholder={t("browse_location.save_as_placeholder")}
							style={{ "--tab-color": tabColor } as React.CSSProperties}
							className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--tab-color)]"
						/>
						<button
							type="button"
							disabled={!newLocationName.trim()}
							onClick={handleSaveCurrentAsNamedLocation}
							style={{ backgroundColor: tabColor, color: tabContrast }}
							className="shrink-0 rounded-xl px-4 text-sm font-bold transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
						>
							{t("travel_plans.save")}
						</button>
					</div>
				)}
			</div>

			{/* Footer: pin actions + confirm */}
			<div className="-mx-4 mt-3 flex shrink-0 gap-2 border-t border-[var(--border)] px-4 pt-3">
				{!isExploreTab && (
					<button
						type="button"
						onClick={() => selectedLocation && void handleSetAsHome(selectedLocation.lat, selectedLocation.lon)}
						disabled={!selectedLocation || updateHomeLocation.isPending || isPinOnHome}
						title={t("browse_location.set_as_home")}
						aria-label={t("browse_location.set_as_home")}
						className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-50"
					>
						{updateHomeLocation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Home className="h-4 w-4" />}
					</button>
				)}
				<button
					type="button"
					onClick={handleToggleBookmark}
					disabled={!selectedLocation || (isPinOnHome && !pinnedSavedLocation)}
					title={pinnedSavedLocation ? t("browse_location.delete_saved_location") : t("browse_location.save_as")}
					aria-label={pinnedSavedLocation ? t("browse_location.delete_saved_location") : t("browse_location.save_as")}
					style={isNamingLocation ? { color: tabColor } : undefined}
					className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] transition disabled:opacity-50 ${
						pinnedSavedLocation ? "hover:bg-red-500/10 hover:text-red-400" : "hover:text-[var(--text)]"
					}`}
				>
					{pinnedSavedLocation ? <Trash2 className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
				</button>
				<button
					type="button"
					disabled={!selectedLocation || isActiveLocationSelected || isSaving}
					onClick={handleConfirm}
					style={{ backgroundColor: tabColor, borderColor: tabColor, color: tabContrast }}
					className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
				>
					{isSaving ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<>
							<Check className="h-4 w-4 shrink-0" />
							<span className="truncate">
								{isExploreTab ? t("browse_location.start_explore") : t("browse_location.use_selected_location")}
							</span>
						</>
					)}
				</button>
			</div>

			{/* Portaled out: this sheet's transformed panel would otherwise become
			    the containing block for the nested sheet's position: fixed. */}
			{isVisitingModeOpen &&
				createPortal(
					<VisitingModeSheet isDesktop={isDesktop} onClose={() => setIsVisitingModeOpen(false)} />,
					document.body,
				)}
		</>
	);
}

const VISITING_MODE_ICONS: Record<VisitingMode, typeof MapPin> = { AUTO: Compass, OFF: Home, ON: MapPin };

// Profile mode: Auto/Home/Visiting. Only applies to your real location, not
// the explore tab's local-only browsing. Saves immediately on tap.
function VisitingModeSheet({ isDesktop, onClose }: { isDesktop: boolean; onClose: () => void }) {
	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} zIndex="z-[70]" panelClassName="max-h-[82dvh]">
			<VisitingModeSheetContent />
		</BottomSheet>
	);
}

function VisitingModeSheetContent() {
	const { t } = useTranslation();
	const close = useBottomSheetClose();
	const { data: visitingMode, isLoading, isError } = useVisitingMode();
	const updateVisitingModeMutation = useUpdateVisitingMode();
	const disabled = isLoading || isError || updateVisitingModeMutation.isPending;

	const handleChange = async (mode: VisitingMode) => {
		if (mode === visitingMode) {
			close();
			return;
		}
		try {
			await updateVisitingModeMutation.mutateAsync(mode);
			close();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("api.errors.save_visiting_mode"));
		}
	};

	return (
		<>
			<div className="flex items-center justify-between px-4 pb-3">
				<p className="text-sm font-semibold text-[var(--text)]">{t("profile_editor.sections.visiting_mode.title")}</p>
				<SheetCloseButton />
			</div>
			<div
				role="radiogroup"
				aria-label={t("profile_editor.sections.visiting_mode.title")}
				className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto pb-2"
				data-lenis-prevent
			>
				{VISITING_MODES.map((mode) => {
					const active = mode === visitingMode;
					const Icon = VISITING_MODE_ICONS[mode];
					const modeKey = getVisitingModeTranslationKey(mode);
					return (
						<button
							key={mode}
							type="button"
							role="radio"
							aria-checked={active}
							disabled={disabled}
							onClick={() => void handleChange(mode)}
							className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
						>
							<span
								className={`shrink-0 rounded-2xl p-2.5 ${
									active ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-[var(--surface-2)] text-[var(--text-muted)]"
								}`}
							>
								<Icon className="h-5 w-5" strokeWidth={2.1} />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block text-sm font-semibold leading-snug text-[var(--text)]">
									{t(`profile_editor.sections.visiting_mode.options.${modeKey}.label`)}
								</span>
								<span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-muted)]">
									{t(`profile_editor.sections.visiting_mode.options.${modeKey}.description`)}
								</span>
							</span>
							{updateVisitingModeMutation.isPending && updateVisitingModeMutation.variables === mode ? (
								<Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--text-muted)]" />
							) : active ? (
								<Check className="h-5 w-5 shrink-0 text-[var(--accent)]" />
							) : null}
						</button>
					);
				})}
			</div>
			{isLoading || isError ? (
				<p className={`px-4 pb-2 text-xs leading-relaxed ${isError ? "text-red-400" : "text-[var(--text-muted)]"}`}>
					{isError ? t("profile_editor.sections.visiting_mode.error") : t("profile_editor.sections.visiting_mode.loading")}
				</p>
			) : null}
		</>
	);
}
