import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet, SheetClose, SheetCloseButton, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { HomeFilled, LocateFixedFilled } from "../../../components/icons/FilledIcons";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useHomeLocation } from "../../../hooks/queries/useProfileQueries";
import { loadSavedLocations, type SavedLocation } from "../../../services/savedLocations";
import { decodeGeohash, encodeGeohash } from "../../../utils/geohash";
import { LocationChip, SavedLocationChip, useGeohashLabel } from "../gridpage/components/LocationChips";
import { MapLocationPicker } from "../gridpage/components/MapLocationPicker";
import { MapSheetLayout, MapSheetQuickPicks, MapSheetSearch, mapSheetProps } from "../gridpage/components/MapSheetLayout";
import { useLocationSearch } from "../gridpage/hooks/useLocationSearch";
import { reverseGeocodeGeohash } from "../gridpage/geocoding";

type LatLon = { lat: number; lon: number };

interface TravelDestinationSheetProps {
	/** The trip's current destination, if it has one. */
	initialLocation: LatLon | null;
	onConfirm: (location: LatLon) => void;
	onClose: () => void;
	isDesktop: boolean;
}

function decodeGeohashCenter(geohash: string | null | undefined): LatLon | null {
	if (!geohash) return null;
	try {
		const decoded = decodeGeohash(geohash);
		return { lat: (decoded.lat[0] + decoded.lat[1]) / 2, lon: (decoded.lon[0] + decoded.lon[1]) / 2 };
	} catch {
		return null;
	}
}

function isSameSpot(a: LatLon | null, b: LatLon): boolean {
	return a != null && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
}

/** Picks a trip's destination on the big map, like the chat's share-location sheet. */
export function TravelDestinationSheet({ initialLocation, onConfirm, onClose, isDesktop }: TravelDestinationSheetProps) {
	const { t } = useTranslation();
	const { geohash, locationName } = usePreferences();
	const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
	const { data: homeLocation } = useHomeLocation();
	const search = useLocationSearch();

	useEffect(() => {
		void loadSavedLocations().then(setSavedLocations);
	}, []);

	const currentLocation = useMemo(() => decodeGeohashCenter(geohash), [geohash]);
	// A new trip starts on the current location, so the map isn't the whole globe.
	const [location, setLocation] = useState<LatLon | null>(initialLocation ?? currentLocation);
	const pinGeohash = useMemo(() => (location ? encodeGeohash(location.lat, location.lon) : null), [location]);
	const pinAddress = useGeohashLabel(pinGeohash, reverseGeocodeGeohash, 400);

	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			bg={NATIVE_SHEET_BG}
			{...mapSheetProps(isDesktop)}
		>
			<div className="mb-3 flex shrink-0 items-center justify-between">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{t("travel_plans.destination")}
				</h3>
				<SheetCloseButton />
			</div>

			<MapSheetLayout
				search={
					<MapSheetSearch
						search={search}
						onSelect={(result) => setLocation({ lat: Number(result.lat), lon: Number(result.lon) })}
						placeholder={t("travel_plans.search_placeholder")}
						focusColor="var(--accent)"
					/>
				}
				map={
					<MapLocationPicker
						selectedLocation={location}
						onPick={(lat, lon) => setLocation({ lat, lon })}
						onError={(msg) => toast.error(msg)}
						className="h-full w-full"
						defaultZoom={11}
					/>
				}
				pinLabel={
					search.isActive || !location
						? undefined
						: pinAddress.resolved
							? pinAddress.value ?? t("travel_plans.lat_lon_label", { lat: location.lat.toFixed(4), lon: location.lon.toFixed(4) })
							: t("travel_plans.resolving_location")
				}
				picks={search.isActive ? undefined : (
					<MapSheetQuickPicks>
						{currentLocation ? (
							<LocationChip
								icon={<LocateFixedFilled className="h-4 w-4" />}
								title={t("chat.share_location_current")}
								subtitle={locationName ?? null}
								isActive={isSameSpot(location, currentLocation)}
								onClick={() => setLocation(currentLocation)}
							/>
						) : null}
						{homeLocation ? (
							<LocationChip
								icon={<HomeFilled className="h-4 w-4" />}
								title={t("browse_location.home_location_label")}
								subtitle={homeLocation.name ?? null}
								isActive={isSameSpot(location, homeLocation)}
								onClick={() => setLocation({ lat: homeLocation.lat, lon: homeLocation.lon })}
							/>
						) : null}
						{savedLocations.map((saved) => (
							<SavedLocationChip
								key={saved.id}
								location={saved}
								isActive={isSameSpot(location, saved)}
								onClick={() => setLocation({ lat: saved.lat, lon: saved.lon })}
							/>
						))}
					</MapSheetQuickPicks>
				)}
				footer={
					<SheetClose
						onClick={() => location && onConfirm(location)}
						disabled={!location}
						className={sheetButtonClass()}
					>
						<Check className="h-4 w-4" />
						<span className="truncate">{t("travel_plans.use_destination", { defaultValue: "Use this destination" })}</span>
					</SheetClose>
				}
			/>
		</BottomSheet>
	);
}
