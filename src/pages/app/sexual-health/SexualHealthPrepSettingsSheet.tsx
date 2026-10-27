import { CalendarClock, Check, Info, Repeat } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { BottomSheet, SheetCloseButton } from "../../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";
import { SheetCard, SheetSection } from "../../../components/ui/sheet-section";
import { cn } from "../../../utils/cn";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import type { PrepScheme } from "../../../services/prepTracking";

const SCHEME_OPTIONS: {
	value: PrepScheme;
	icon: typeof Repeat;
	labelKey: string;
	labelDefault: string;
	descKey: string;
	descDefault: string;
}[] = [
	{
		value: "daily",
		icon: Repeat,
		labelKey: "sexualHealth.info.scheme_daily_label",
		labelDefault: "Daily",
		descKey: "sexualHealth.info.daily_desc",
		descDefault:
			"One pill every day at roughly the same time. Protection builds up over your first doses and is maintained by staying consistent.",
	},
	{
		value: "on_demand",
		icon: CalendarClock,
		labelKey: "sexualHealth.info.scheme_on_demand_label",
		labelDefault: "On-demand (2-1-1)",
		descKey: "sexualHealth.info.on_demand_desc",
		descDefault:
			"2 pills 2-24h before sex, then 1 pill 24h after the first dose, then 1 pill 48h after the first dose. Log each step as you take it and the PrEP tab will track your coverage.",
	},
];

// Portalled to document.body — see EncounterLogSheet.tsx for why (avoids
// the FeedScrollContainer mask-image containing-block issue).
export function SexualHealthPrepSettingsSheet({
	scheme,
	onSchemeChange,
	onClose,
}: {
	scheme: PrepScheme;
	onSchemeChange: (scheme: PrepScheme) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();

	return createPortal(
		<BottomSheet
			onClose={onClose}
			isDesktop={isDesktop}
			bg={NATIVE_SHEET_BG}
			panelClassName="max-h-[92dvh] px-4"
		>
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold text-[var(--text)]">
					{t("sexualHealth.info.sheet_title", { defaultValue: "PrEP settings" })}
				</h3>
				<SheetCloseButton />
			</div>

			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<div className="space-y-5">
					<SheetSection title={t("sexualHealth.info.scheme_section", { defaultValue: "Dosing scheme" })}>
						{/* Native-style single choice: one card, a radio per row. */}
						<SheetCard className="divide-y divide-[var(--border)] overflow-hidden px-0 py-0">
							{SCHEME_OPTIONS.map((option) => {
								const isSelected = scheme === option.value;
								const Icon = option.icon;
								return (
									<button
										key={option.value}
										type="button"
										role="radio"
										aria-checked={isSelected}
										onClick={() => onSchemeChange(option.value)}
										className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:ink-tint-6 active:ink-tint-10"
									>
										<span
											className={cn(
												"flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
												isSelected
													? "bg-[var(--accent)] text-[var(--accent-contrast)]"
													: "ink-tint-10 text-[var(--text-muted)]",
											)}
										>
											<Icon className="h-4 w-4" />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-semibold text-[var(--text)]">
												{t(option.labelKey, { defaultValue: option.labelDefault })}
											</span>
											<span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-muted)]">
												{t(option.descKey, { defaultValue: option.descDefault })}
											</span>
										</span>
										<span
											className={cn(
												"mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
												isSelected
													? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
													: "border-[color-mix(in_srgb,var(--text)_25%,transparent)] text-transparent",
											)}
										>
											<Check className="h-3 w-3" strokeWidth={3} />
										</span>
									</button>
								);
							})}
						</SheetCard>
					</SheetSection>

					<div className="flex gap-2.5 px-1">
						<Info className="mt-px h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-60" />
						<p className="text-xs leading-relaxed text-[var(--text-muted)] opacity-80">
							{t("sexualHealth.info.footer", {
								defaultValue:
									"This is a personal tracking tool. It doesn't replace medical advice — talk to a healthcare provider about what's right for you.",
							})}
						</p>
					</div>
				</div>
			</div>
		</BottomSheet>,
		document.body,
	);
}
