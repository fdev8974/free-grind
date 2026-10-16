import { Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { BottomSheet, SheetClose } from "../../../components/ui/bottom-sheet";
import { HomeFilled, LocateFixedFilled, MapPinFilled } from "../../../components/icons/FilledIcons";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useHomeLocation } from "../../../hooks/queries/useProfileQueries";
import { loadSavedLocations, type SavedLocation } from "../../../services/savedLocations";
import { decodeGeohash, encodeGeohash } from "../../../utils/geohash";
import { LocationChip, SavedLocationChip, useGeohashLabel } from "../gridpage/components/LocationChips";
import { MapLocationPicker } from "../gridpage/components/MapLocationPicker";
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
			panelClassName="px-4"
		>
			<div className="mb-4 flex items-center justify-between">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{t("chat.share_location_label")}
				</h3>
				<SheetClose className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
					<X className="h-4 w-4" />
				</SheetClose>
			</div>

			<div className="relative overflow-hidden rounded-2xl" style={{ height: isDesktop ? "45vh" : "40dvh" }}>
				<MapLocationPicker
					selectedLocation={location}
					onPick={(lat, lon) => onChange({ lat, lon })}
					onError={(msg) => toast.error(msg)}
					className="h-full w-full"
					defaultZoom={18}
				/>
				{/* Resolved address of the pin, floating over the map. */}
				<div className="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center">
					<div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
						<MapPinFilled className="h-3.5 w-3.5 shrink-0" />
						<span className="truncate">
							{pinAddress.resolved
								? pinAddress.value ?? `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`
								: t("browse_location.resolving_location")}
						</span>
					</div>
				</div>
			</div>

			<div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
			</div>
			{savedLocations.length === 0 ? (
				<p className="mt-2 px-1 text-[11px] text-[var(--text-muted)]">{t("chat.share_location_saved_hint")}</p>
			) : null}

			<div className="-mx-4 mt-3 flex border-t border-[var(--border)] px-4 pt-3">
				<SheetClose
					onClick={() => onSend(location)}
					className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110"
				>
					<Send className="h-4 w-4" />
					<span className="truncate">{t("chat.send")}</span>
				</SheetClose>
			</div>
		</BottomSheet>
	);
}
