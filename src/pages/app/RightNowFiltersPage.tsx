import { Star } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RangeSlider } from "../../components/ui/range-slider";
import { BottomSheet, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../components/ui/bottom-sheet";
import { SheetChip, SheetSection } from "../../components/ui/sheet-section";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { HomeFilled } from "../../components/icons/FilledIcons";
import type { RightNowFiltersDraft } from "./rightnow/rightnow-filters-storage";
import { getSexualPositionFilterOptions, SEXUAL_POSITION_ICONS } from "./profile-option-builders";

interface RightNowFiltersPageProps {
	onClose: () => void;
	onApply: (draft: RightNowFiltersDraft) => void;
	initialDraft: RightNowFiltersDraft;
}

/** Right Now feed filters — same bottom sheet layout as the grid/inbox filters, in Right Now purple. */
export function RightNowFiltersPage({ onClose, onApply, initialDraft }: RightNowFiltersPageProps) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();

	const [ageMin, setAgeMin] = useState(initialDraft.ageMin);
	const [ageMax, setAgeMax] = useState(initialDraft.ageMax);
	const [positionFilter, setPositionFilter] = useState(initialDraft.positionFilter);
	const [hostingOnly, setHostingOnly] = useState(initialDraft.hostingOnly);
	const [favoritesOnly, setFavoritesOnly] = useState(initialDraft.favoritesOnly);

	const positionFilterOptions = useMemo(
		() => getSexualPositionFilterOptions(t, t("right_now.any_position")),
		[t],
	);

	return (
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			panelClassName="max-h-[92dvh] px-4"
		>
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">{t("right_now.filters")}</h3>
				<SheetCloseButton />
			</div>

			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4" data-lenis-prevent>
				<div className="space-y-5 pb-2">
					<SheetSection title={t("browse_filters.quick_filters")}>
						<div className="flex flex-wrap gap-2">
							<SheetChip active={hostingOnly} onClick={() => setHostingOnly((v) => !v)} accentColor="var(--right-now)">
								<span className="inline-flex items-center gap-1.5">
									<HomeFilled className="h-3.5 w-3.5" />
									{t("right_now.hosting")}
								</span>
							</SheetChip>
							<SheetChip active={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)} accentColor="var(--right-now)">
								<span className="inline-flex items-center gap-1.5">
									<Star className="h-3.5 w-3.5 fill-current" />
									{t("browse_filters.options.favorites")}
								</span>
							</SheetChip>
						</div>
					</SheetSection>

					<SheetSection title={t("right_now_filters.position")}>
						<div className="flex flex-wrap gap-2">
							{positionFilterOptions.map((option) => {
								const Icon = option.value ? SEXUAL_POSITION_ICONS[Number(option.value)] : undefined;
								return (
									<SheetChip
										key={option.value || "any"}
										active={option.value === positionFilter}
										onClick={() => setPositionFilter(option.value)}
										accentColor="var(--right-now)"
									>
										{Icon ? (
											<span className="inline-flex items-center gap-1.5">
												<Icon className="h-3.5 w-3.5 shrink-0" />
												{option.label}
											</span>
										) : option.label}
									</SheetChip>
								);
							})}
						</div>
					</SheetSection>

					<SheetSection
						title={t("right_now_filters.age_range")}
						value={`${ageMin}-${ageMax}${ageMax >= 99 ? "+" : ""}`}
					>
						<div className="px-1">
							<RangeSlider
								label={t("right_now_filters.age_range")}
								min={18}
								max={99}
								step={1}
								minDefault={ageMin}
								maxDefault={ageMax}
								activeColor="var(--right-now)"
								hideHeader
								onChange={(min, max) => {
									setAgeMin(min);
									setAgeMax(max);
								}}
							/>
						</div>
					</SheetSection>
				</div>
			</div>

			{/* SheetClose closes animated and pops the sheet's history entry. */}
			<div className={SHEET_FOOTER_CLASS}>
				<SheetClose
					onClick={() => onApply({ ageMin: 18, ageMax: 99, positionFilter: "", hostingOnly: false, favoritesOnly: false })}
					className={sheetButtonClass("secondary")}
				>
					{t("browse_filters.clear_all")}
				</SheetClose>
				<SheetClose
					onClick={() => onApply({ ageMin, ageMax, positionFilter, hostingOnly, favoritesOnly })}
					style={{ backgroundColor: "var(--right-now)", color: "white" }}
					className={sheetButtonClass()}
				>
					{t("right_now_filters.apply")}
				</SheetClose>
			</div>
		</BottomSheet>
	);
}
