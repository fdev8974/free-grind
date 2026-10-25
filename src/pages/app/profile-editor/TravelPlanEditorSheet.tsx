import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ChevronRight, Loader2, MapPin, Trash2 } from "lucide-react";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { reverseGeocodeGeohash } from "../gridpage/geocoding";
import {
	useCreateTravelPlan,
	useDeleteTravelPlan,
	useUpdateTravelPlan,
} from "../../../hooks/queries/useProfileQueries";
import { encodeGeohash, decodeGeohash } from "../../../utils/geohash";
import type { TravelPlan } from "../../../types/travel";
import { formatDateInput, parseDateInput } from "./profileEditorUtils";
import {
	BottomSheet,
	SheetCloseButton,
	SHEET_FOOTER_CLASS,
	SHEET_FOOTER_ICON_BUTTON_CLASS,
	sheetButtonClass,
} from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { SheetSection, SheetToggleList } from "../../../components/ui/sheet-section";
import { TravelDestinationSheet } from "./TravelDestinationSheet";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { cn } from "../../../utils/cn";

type SelectedLocation = { lat: number; lon: number; label: string };

type TravelPlanEditorSheetProps = {
	profileId: number;
	plan: TravelPlan | null;
	onClose: () => void;
};

export function TravelPlanEditorSheet({ profileId, plan, onClose }: TravelPlanEditorSheetProps) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const isEditing = plan != null;
	// The sheet's animated close (slides out and pops its history entry).
	const closeRef = useRef<(() => void) | null>(null);

	const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(null);
	const [isDestinationSheetOpen, setIsDestinationSheetOpen] = useState(false);

	const [startDate, setStartDate] = useState(() => formatDateInput(plan?.startDate ?? null));
	const [endDate, setEndDate] = useState(() => formatDateInput(plan?.endDate ?? null));
	const [notes, setNotes] = useState(plan?.notes ?? "");
	const [showOnProfile, setShowOnProfile] = useState(plan?.showOnProfile ?? true);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const createTravelPlan = useCreateTravelPlan();
	const updateTravelPlan = useUpdateTravelPlan();
	const deleteTravelPlan = useDeleteTravelPlan();
	const isSaving = createTravelPlan.isPending || updateTravelPlan.isPending;
	const isDeleting = deleteTravelPlan.isPending;

	// Pre-fill the selected location from the existing plan's geohash, resolving a readable label.
	useEffect(() => {
		if (!plan?.geohash) return;
		let cancelled = false;
		try {
			const decoded = decodeGeohash(plan.geohash);
			const lat = (decoded.lat[0] + decoded.lat[1]) / 2;
			const lon = (decoded.lon[0] + decoded.lon[1]) / 2;
			setSelectedLocation({ lat, lon, label: t("travel_plans.resolving_location") });
			void reverseGeocodeGeohash(plan.geohash).then((label) => {
				if (!cancelled && label) {
					setSelectedLocation({ lat, lon, label });
				}
			});
		} catch {
			// ignore invalid stored geohash
		}
		return () => {
			cancelled = true;
		};
	}, [plan?.geohash, t]);

	const handleClose = () => closeRef.current?.();

	const handleMapPick = (lat: number, lon: number) => {
		const fallbackLabel = t("travel_plans.lat_lon_label", { lat: lat.toFixed(4), lon: lon.toFixed(4) });
		setSelectedLocation({ lat, lon, label: t("travel_plans.resolving_location") });
		void reverseGeocodeGeohash(encodeGeohash(lat, lon)).then((label) => {
			setSelectedLocation((current) =>
				current && current.lat === lat && current.lon === lon
					? { ...current, label: label ?? fallbackLabel }
					: current,
			);
		});
	};

	const handleSave = async () => {
		if (!selectedLocation) {
			toast.error(t("travel_plans.error_no_location"));
			return;
		}
		const startMs = parseDateInput(startDate);
		const endMs = parseDateInput(endDate);
		if (!startMs || !endMs) {
			toast.error(t("travel_plans.error_no_dates"));
			return;
		}
		if (endMs < startMs) {
			toast.error(t("travel_plans.error_end_before_start"));
			return;
		}

		const geohash = encodeGeohash(selectedLocation.lat, selectedLocation.lon);
		const trimmedNotes = notes.trim() || null;

		try {
			if (isEditing && plan) {
				await updateTravelPlan.mutateAsync({
					travelPlanId: plan.travelPlanId,
					profileId,
					geohash,
					startDate: startMs,
					endDate: endMs,
					showOnProfile,
					notes: trimmedNotes,
				});
				toast.success(t("travel_plans.toast_updated"));
			} else {
				await createTravelPlan.mutateAsync({
					profileId,
					geohash,
					startDate: startMs,
					endDate: endMs,
					showOnProfile,
					notes: trimmedNotes,
				});
				toast.success(t("travel_plans.toast_created"));
			}
			handleClose();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("travel_plans.error_save_failed"));
		}
	};

	const handleDelete = async () => {
		if (!plan) return;
		try {
			await deleteTravelPlan.mutateAsync({ travelPlanId: plan.travelPlanId, profileId });
			toast.success(t("travel_plans.toast_deleted"));
			handleClose();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("travel_plans.error_delete_failed"));
		} finally {
			setShowDeleteConfirm(false);
		}
	};

	const fieldClass =
		"w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]";

	return (
		<>
			<BottomSheet
				onClose={onClose}
				closeRef={closeRef}
				expandable
				isDesktop={isDesktop}
				isProcessing={isSaving || isDeleting}
				bg={NATIVE_SHEET_BG}
				panelClassName={isDesktop ? "max-h-[88dvh] px-4" : "px-4"}
			>
				<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
					<h3 className="text-sm font-semibold text-[var(--text)]">
						{isEditing ? t("travel_plans.edit_title") : t("travel_plans.add_title")}
					</h3>
					<SheetCloseButton />
				</div>

				<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4" data-lenis-prevent>
					<div className="space-y-5 pb-2">
						<SheetSection title={t("travel_plans.destination")}>
							<button
								type="button"
								onClick={() => setIsDestinationSheetOpen(true)}
								className="flex w-full items-center gap-3 rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-left transition hover:ink-tint-8 active:scale-[0.99]"
							>
								<span
									className={cn(
										"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
										selectedLocation ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "ink-tint-10 text-[var(--text-muted)]",
									)}
								>
									<MapPin className="h-4 w-4" />
								</span>
								<span
									className={cn(
										"min-w-0 flex-1 truncate text-sm",
										selectedLocation ? "font-medium text-[var(--text)]" : "text-[var(--text-muted)]",
									)}
								>
									{selectedLocation?.label ?? t("travel_plans.choose_destination", { defaultValue: "Choose destination" })}
								</span>
								<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
							</button>
						</SheetSection>

						<SheetSection title={t("travel_plans.dates")}>
							<div className="grid grid-cols-2 gap-2">
								<input
									type="date"
									value={startDate}
									onChange={(e) => setStartDate(e.target.value)}
									className={cn(fieldClass, "h-11 px-3")}
								/>
								<input
									type="date"
									value={endDate}
									onChange={(e) => setEndDate(e.target.value)}
									className={cn(fieldClass, "h-11 px-3")}
								/>
							</div>
						</SheetSection>

						<SheetSection title={t("travel_plans.notes")}>
							<textarea
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								placeholder={t("travel_plans.notes_placeholder")}
								rows={3}
								className={cn(fieldClass, "resize-none px-4 py-3")}
							/>
						</SheetSection>

						<SheetToggleList
							items={[
								{
									key: "show-on-profile",
									checked: showOnProfile,
									onChange: setShowOnProfile,
									label: t("travel_plans.show_on_profile"),
									description: t("travel_plans.show_on_profile_desc"),
								},
							]}
						/>
					</div>
				</div>

				<div className={SHEET_FOOTER_CLASS}>
					{isEditing && (
						<button
							type="button"
							onClick={() => setShowDeleteConfirm(true)}
							disabled={isDeleting}
							aria-label={t("travel_plans.delete")}
							className={cn(SHEET_FOOTER_ICON_BUTTON_CLASS, "bg-red-500/12 text-red-500 hover:bg-red-500/20 hover:text-red-500")}
						>
							{isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
						</button>
					)}
					<button
						type="button"
						onClick={() => void handleSave()}
						disabled={isSaving}
						className={sheetButtonClass()}
					>
						{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("travel_plans.save")}
					</button>
				</div>
			</BottomSheet>

			{isDestinationSheetOpen && (
				<TravelDestinationSheet
					initialLocation={selectedLocation}
					onConfirm={({ lat, lon }) => handleMapPick(lat, lon)}
					onClose={() => setIsDestinationSheetOpen(false)}
					isDesktop={isDesktop}
				/>
			)}

			<ConfirmDialog
				isOpen={showDeleteConfirm}
				title={t("travel_plans.delete_confirm_title")}
				message={t("travel_plans.delete_confirm_message")}
				confirmLabel={t("travel_plans.delete")}
				cancelLabel={t("common.cancel")}
				confirmTone="danger"
				isProcessing={isDeleting}
				onConfirm={() => void handleDelete()}
				onCancel={() => setShowDeleteConfirm(false)}
			/>
		</>
	);
}
