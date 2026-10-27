import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useApiFunctions } from "../hooks/useApiFunctions";
import {
	buildProfileReport,
	REPORT_LOCATIONS,
	REPORT_REASONS,
	type ReportLocation,
	type ReportReason,
} from "../types/reports";
import { useDesktopBreakpoint } from "../hooks/useDesktopBreakpoint";
import { cn } from "../utils/cn";
import { NATIVE_SHEET_BG } from "./ui/action-sheet";
import { SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "./ui/bottom-sheet";
import { ControlledBottomSheet } from "./ui/controlled-sheet";
import { SHEET_FIELD_CLASS, SheetChip, SheetSection } from "./ui/sheet-section";

type ReportProfileDialogProps = {
	isOpen: boolean;
	profileId: string;
	onClose: () => void;
	/** Offered after a successful report; omitted hides the "Block" button. */
	onBlock?: () => void;
};

export function ReportProfileDialog({ isOpen, profileId, onClose, onBlock }: ReportProfileDialogProps) {
	const { t } = useTranslation();
	const apiFunctions = useApiFunctions();
	const isDesktop = useDesktopBreakpoint();
	const [reason, setReason] = useState<ReportReason | null>(null);
	const [locations, setLocations] = useState<ReportLocation[]>([]);
	const [comment, setComment] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isSubmitted, setIsSubmitted] = useState(false);

	useEffect(() => {
		if (!isOpen) return;
		setReason(null);
		setLocations([]);
		setComment("");
		setIsSubmitted(false);
	}, [isOpen]);

	const showDetails = reason !== null && reason !== "SPAM";

	const toggleLocation = (location: ReportLocation) => {
		setLocations((current) =>
			current.includes(location) ? current.filter((l) => l !== location) : [...current, location],
		);
	};

	const handleSubmit = async () => {
		if (reason === null || isSubmitting) return;
		setIsSubmitting(true);
		try {
			await apiFunctions.reportProfile(profileId, buildProfileReport(reason, comment, locations));
			setIsSubmitted(true);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("profile_details.report.failed"));
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<ControlledBottomSheet
			isOpen={isOpen}
			onDismiss={onClose}
			expandable={!isSubmitted}
			isDesktop={isDesktop}
			isProcessing={isSubmitting}
			bg={NATIVE_SHEET_BG}
			panelClassName={isDesktop ? "max-h-[82dvh] px-4" : "px-4"}
		>
			{isSubmitted ? (
				<>
					<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
						<div className="flex flex-col items-center px-2 pt-2 text-center">
							<span className="flex h-14 w-14 items-center justify-center rounded-full accent-tint-15 text-[var(--accent)]">
								<Check className="h-7 w-7" strokeWidth={2.5} />
							</span>
							<h3 className="mt-4 text-base font-semibold text-[var(--text)]">{t("profile_details.report.submitted_title")}</h3>
							<p className="mt-2 text-sm leading-relaxed text-[var(--text)]">{t("profile_details.report.submitted_message")}</p>
							{onBlock && (
								<p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">{t("profile_details.report.block_hint")}</p>
							)}
						</div>
					</div>
					<div className={SHEET_FOOTER_CLASS}>
						{onBlock && (
							<SheetClose onClick={onBlock} className={sheetButtonClass("destructive")}>
								{t("profile_details.block")}
							</SheetClose>
						)}
						<SheetClose className={sheetButtonClass()}>
							{t("profile_details.report.done")}
						</SheetClose>
					</div>
				</>
			) : (
				<>
					<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
						<h3 className="text-sm font-semibold text-[var(--text)]">{t("profile_details.report.title")}</h3>
						<SheetCloseButton disabled={isSubmitting} />
					</div>
					<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
						<p className="mb-4 px-1 text-sm leading-relaxed text-[var(--text-muted)]">{t("profile_details.report.message")}</p>
						<div className="space-y-5">
							<SheetSection title={t("profile_details.report.reason_label")}>
								<div className="flex flex-wrap gap-2">
									{REPORT_REASONS.map((value) => (
										<SheetChip
											key={value}
											active={reason === value}
											onClick={() => !isSubmitting && setReason(reason === value ? null : value)}
										>
											{t(`profile_details.report.reasons.${value}`)}
										</SheetChip>
									))}
								</div>
							</SheetSection>

							{showDetails && (
								<>
									<SheetSection title={t("profile_details.report.location_label")}>
										<div className="flex flex-wrap gap-2">
											{REPORT_LOCATIONS.map((value) => (
												<SheetChip
													key={value}
													active={locations.includes(value)}
													onClick={() => !isSubmitting && toggleLocation(value)}
												>
													{t(`profile_details.report.locations.${value}`)}
												</SheetChip>
											))}
										</div>
									</SheetSection>
									<textarea
										value={comment}
										onChange={(event) => setComment(event.target.value)}
										placeholder={t("profile_details.report.details_placeholder")}
										disabled={isSubmitting}
										rows={3}
										className={cn(SHEET_FIELD_CLASS, "resize-none px-4 py-3 disabled:opacity-60")}
									/>
								</>
							)}
						</div>
					</div>
					<div className={SHEET_FOOTER_CLASS}>
						<SheetClose disabled={isSubmitting} className={sheetButtonClass("secondary")}>
							{t("chat.actions.cancel")}
						</SheetClose>
						<button
							type="button"
							onClick={() => void handleSubmit()}
							disabled={isSubmitting || reason === null}
							className={sheetButtonClass()}
						>
							{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
							<span className="truncate">{t("profile_details.report.submit")}</span>
						</button>
					</div>
				</>
			)}
		</ControlledBottomSheet>
	);
}
