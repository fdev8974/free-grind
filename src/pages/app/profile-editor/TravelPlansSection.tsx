import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Loader2, Plane, Plus } from "lucide-react";
import { FieldSection, FieldSectionAction } from "./ProfileFieldRows";
import { TravelPlanEditorSheet } from "./TravelPlanEditorSheet";
import { useTravelPlans } from "../../../hooks/queries/useProfileQueries";
import { reverseGeocodeCityDistrictForGeohash } from "../gridpage/geocoding";
import { formatTravelDateRange } from "../gridpage/utils";
import { MAX_TRAVEL_PLANS } from "./profileEditorUtils";
import type { TravelPlan } from "../../../types/travel";

function TravelPlanSummary({ plan }: { plan: TravelPlan }) {
	const { t } = useTranslation();
	const [location, setLocation] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void reverseGeocodeCityDistrictForGeohash(plan.geohash).then((label) => {
			if (!cancelled) {
				setLocation(label);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [plan.geohash]);

	return (
		<div className="min-w-0 flex-1">
			<div className="flex items-center gap-2">
				<p className="truncate text-sm font-semibold text-[var(--text)]">
					{location ?? t("travel_plans.resolving_location")}
				</p>
				{!plan.showOnProfile && (
					<span className="shrink-0 rounded-full ink-tint-10 px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
						{t("travel_plans.hidden_badge")}
					</span>
				)}
			</div>
			<p className="mt-0.5 text-xs text-[var(--text-muted)]">
				{formatTravelDateRange(plan.startDate, plan.endDate)}
			</p>
		</div>
	);
}

type TravelPlansSectionProps = {
	profileId?: string | number | null;
};

export function TravelPlansSection({ profileId }: TravelPlansSectionProps) {
	const { t } = useTranslation();
	const numericProfileId = profileId != null ? Number(profileId) : null;
	const { data: travelPlans, isLoading } = useTravelPlans(numericProfileId);
	// undefined = sheet closed; null = creating a new plan; TravelPlan = editing that plan
	const [editingPlan, setEditingPlan] = useState<TravelPlan | null | undefined>(undefined);
	const hasReachedMax = (travelPlans?.length ?? 0) >= MAX_TRAVEL_PLANS;

	const planCount = travelPlans?.length ?? 0;

	return (
		<FieldSection
			title={t("travel_plans.section_title")}
			action={planCount > 0 ? (
				<FieldSectionAction
					onClick={() => setEditingPlan(null)}
					disabled={numericProfileId == null || hasReachedMax}
					title={hasReachedMax ? t("travel_plans.max_reached", { max: MAX_TRAVEL_PLANS }) : undefined}
				>
					<Plus className="h-3.5 w-3.5" />
					{t("travel_plans.add")}
					<span className="tabular-nums text-[var(--text-muted)]">
						{planCount}/{MAX_TRAVEL_PLANS}
					</span>
				</FieldSectionAction>
			) : undefined}
		>
			{isLoading ? (
				<div className="flex min-h-14 items-center justify-center text-[var(--text-muted)]">
					<Loader2 className="h-5 w-5 animate-spin" />
				</div>
			) : planCount === 0 ? (
				<button
					type="button"
					onClick={() => setEditingPlan(null)}
					disabled={numericProfileId == null}
					className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ink-tint-8 text-[var(--text-muted)]">
						<Plus className="h-4 w-4" />
					</span>
					<span className="text-sm text-[var(--text-muted)]">{t("travel_plans.empty", { max: MAX_TRAVEL_PLANS })}</span>
				</button>
			) : (
				travelPlans!.map((plan) => (
					<button
						key={plan.travelPlanId}
						type="button"
						onClick={() => setEditingPlan(plan)}
						className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-2)]"
					>
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ink-tint-8 text-[var(--accent)]">
							<Plane className="h-4 w-4" />
						</div>
						<TravelPlanSummary plan={plan} />
						<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
					</button>
				))
			)}

			{/* Portaled out of the divided card, like the other row pickers. */}
			{editingPlan !== undefined && numericProfileId != null && createPortal(
				<TravelPlanEditorSheet
					profileId={numericProfileId}
					plan={editingPlan}
					onClose={() => setEditingPlan(undefined)}
				/>,
				document.body,
			)}
		</FieldSection>
	);
}
