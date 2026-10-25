import { Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet, SheetClose, SheetCloseButton, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { HomeFilled, LocateFixedFilled } from "../../../components/icons/FilledIcons";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useHomeLocation } from "../../../hooks/queries/useProfileQueries";
import { loadSavedLocations, type SavedLocation } from "../../../services/savedLocations";
import { decodeGeohash, encodeGeohash } from "../../../utils/geohash";
import { LocationChip, SavedLocationChip, useGeohashLabel } from "../gridpage/components/LocationChips";
import { MapLocationPicker } from "../gridpage/components/MapLocationPicker";
import { MAP_SHEET_HINT_CLASS, MapSheetLayout, MapSheetQuickPicks, mapSheetPanelClass } from "../gridpage/components/MapSheetLayout";
import { reverseGeocodeGeohash } from "../gridpage/geocoding";

type LatLon = { lat: number; lon: number };

interface ShareLocationSheetProps {
	location: LatLon;
	onChange: (next: LatLon) => void;
	onClose: () => void;
	onSend: (location: LatLon) => void;
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

function isSameSpot(a: LatLon, b: LatLon): boolean {
	return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
}

export function ShareLocationSheet({ location, onChange, onClose, onSend, isDesktop }: ShareLocationSheetProps) {
	const { t } = useTranslation();
	const { geohash, locationName } = usePreferences();
	const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
	const { data: homeLocation } = useHomeLocation();

	useEffect(() => {
		void loadSavedLocations().then(setSavedLocations);
	}, []);

	const currentLocation = useMemo(() => decodeGeohashCenter(geohash), [geohash]);
	const pinGeohash = useMemo(() => encodeGeohash(location.lat, location.lon), [location.lat, location.lon]);
	const pinAddress = useGeohashLabel(pinGeohash, reverseGeocodeGeohash, 400);

	const isCurrentActive = currentLocation != null && isSameSpot(location, currentLocation);

	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName={mapSheetPanelClass(isDesktop)}
		>
			<div className="mb-3 flex shrink-0 items-center justify-between">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{t("chat.share_location_label")}
				</h3>
				<SheetCloseButton />
			</div>

			<MapSheetLayout
				map={
					<MapLocationPicker
						selectedLocation={location}
						onPick={(lat, lon) => onChange({ lat, lon })}
						onError={(msg) => toast.error(msg)}
						className="h-full w-full"
						defaultZoom={18}
					/>
				}
				pinLabel={
					pinAddress.resolved
						? pinAddress.value ?? `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`
						: t("browse_location.resolving_location")
				}
				picks={
					<>
						<MapSheetQuickPicks>
							{currentLocation ? (
								<LocationChip
									icon={<LocateFixedFilled className="h-4 w-4" />}
									title={t("chat.share_location_current")}
									subtitle={locationName ?? null}
									isActive={isCurrentActive}
									onClick={() => onChange(currentLocation)}
								/>
							) : null}
							{homeLocation ? (
								<LocationChip
									icon={<HomeFilled className="h-4 w-4" />}
									title={t("browse_location.home_location_label")}
									subtitle={homeLocation.name ?? null}
									isActive={isSameSpot(location, homeLocation)}
									onClick={() => onChange({ lat: homeLocation.lat, lon: homeLocation.lon })}
								/>
							) : null}
							{savedLocations.map((saved) => (
								<SavedLocationChip
									key={saved.id}
									location={saved}
									isActive={isSameSpot(location, saved)}
									onClick={() => onChange({ lat: saved.lat, lon: saved.lon })}
								/>
							))}
						</MapSheetQuickPicks>
						{savedLocations.length === 0 ? (
							<p className={MAP_SHEET_HINT_CLASS}>{t("chat.share_location_saved_hint")}</p>
						) : null}
					</>
				}
				footer={
					<SheetClose
						onClick={() => onSend(location)}
						className={sheetButtonClass()}
					>
						<Send className="h-4 w-4" />
						<span className="truncate">{t("chat.send")}</span>
					</SheetClose>
				}
			/>
		</BottomSheet>
	);
}
