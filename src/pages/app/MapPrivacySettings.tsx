import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import { ImagesFilled, MapPinFilled } from "../../components/icons/FilledIcons";
import { ToggleRow } from "../../components/ui/toggle-row";
import { Slider } from "../../components/ui/range-slider";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useApiFunctions } from "../../hooks/useApiFunctions";
import { useMySettings } from "../../hooks/queries/useProfileQueries";
import type { MySettings } from "../../types/api-functions";

// Location Randomizer range in the official app (26.21: "Less" … "More").
const MAP_FUZZ_RADIUS_MIN = 50;
const MAP_FUZZ_RADIUS_MAX = 1500;
const MAP_FUZZ_RADIUS_STEP = 50;

/** Account settings (/v3/me/prefs/settings), applied right away like the
 * rest of the privacy page: shown at once, rolled back if the server refuses. */
function useAccountSettings() {
	const { t } = useTranslation();
	const apiFunctions = useApiFunctions();
	const queryClient = useQueryClient();
	const { data: settings } = useMySettings();

	const update = async (patch: Partial<MySettings>) => {
		if (!settings) return;
		queryClient.setQueryData(["my-settings"], { ...settings, ...patch });
		try {
			await apiFunctions.updateMySettings(patch);
		} catch (error) {
			queryClient.setQueryData(["my-settings"], settings);
			toast.error(error instanceof Error ? error.message : t("profile_editor.toasts.error_update"));
		}
	};

	return { settings, update };
}

/** Privacy page section: whether you show up on the map, and how far your
 * position there is offset. Hidden until the settings have loaded. */
export function MapVisibilitySection({ highlightId }: { highlightId: string | null }) {
	const { t } = useTranslation();
	const { unitsPreset } = usePreferences();
	const { settings, update } = useAccountSettings();
	// The slider's value while dragging; it's only sent on release.
	const [draftRadius, setDraftRadius] = useState<number | null>(null);
	if (!settings) return null;

	const isImperial = unitsPreset === "uk" || unitsPreset === "american";
	const radius = draftRadius ?? settings.mapLocationFuzzRadius ?? null;

	return (
		<div>
			<p className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
				{t("privacy.map", { defaultValue: "Map" })}
			</p>
			<div className="native-group">
				<ToggleRow
					id="privacy-show-on-map"
					highlighted={highlightId === "privacy-show-on-map"}
					icon={<MapPinFilled className="h-5 w-5" />}
					iconClass="bg-emerald-500/15 text-emerald-400"
					label={t("profile_editor.sections.map.show_on_map", { defaultValue: "Show Me on Map" })}
					description={t("profile_editor.sections.map.show_on_map_desc", {
						defaultValue: "Your profile appears on the map, always offset from your actual location.",
					})}
					checked={settings.showOnMap}
					onChange={(checked) => void update({ showOnMap: checked })}
				/>
				{settings.showOnMap && (
					<div className="px-4 py-3.5">
						<Slider
							min={MAP_FUZZ_RADIUS_MIN}
							max={MAP_FUZZ_RADIUS_MAX}
							step={MAP_FUZZ_RADIUS_STEP}
							defaultValue={settings.mapLocationFuzzRadius ?? MAP_FUZZ_RADIUS_MIN}
							label={t("profile_editor.sections.map.location_randomizer", { defaultValue: "Location Randomizer" })}
							displayValue={
								radius == null
									? t("profile_editor.sections.map.radius_default", { defaultValue: "Default" })
									: isImperial
										? t("profile_editor.sections.map.radius_ft", {
												defaultValue: "~{{value}} ft radius",
												value: Math.round(radius * 3.280839895),
											})
										: t("profile_editor.sections.map.radius_m", {
												defaultValue: "~{{value}} m radius",
												value: radius,
											})
							}
							onChange={setDraftRadius}
							onCommit={(value) => {
								setDraftRadius(null);
								if (value !== settings.mapLocationFuzzRadius) {
									void update({ mapLocationFuzzRadius: value });
								}
							}}
						/>
						<p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
							{t("profile_editor.sections.map.location_randomizer_desc", {
								defaultValue: "For your privacy, your location on the map is offset within this range and updates as you move.",
							})}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

/** NSFW content row: opting in to explicit images in Right Now (server-side,
 * unlike the blur toggles beside it). Hidden until the settings have loaded. */
export function RightNowExplicitImagesRow({ highlightId }: { highlightId: string | null }) {
	const { t } = useTranslation();
	const { settings, update } = useAccountSettings();
	if (!settings) return null;

	return (
		<ToggleRow
			id="privacy-right-now-explicit-images"
			highlighted={highlightId === "privacy-right-now-explicit-images"}
			icon={<ImagesFilled className="h-5 w-5" />}
			iconClass="bg-purple-500/15 text-purple-400"
			label={t("profile_editor.sections.map.view_right_now_nsfw", { defaultValue: "Explicit Images in Right Now" })}
			description={t("profile_editor.sections.map.view_right_now_nsfw_desc", {
				defaultValue: "Opt in to seeing explicit sexual and other adult content in Right Now.",
			})}
			checked={settings.viewRightNowNsfw}
			onChange={(checked) => void update({ viewRightNowNsfw: checked })}
		/>
	);
}
