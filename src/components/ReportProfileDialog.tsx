import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Chip } from "./ui/chip";
import { sheetButtonClass } from "./ui/bottom-sheet";

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
	const dialogRef = useRef<HTMLDialogElement | null>(null);
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

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (isOpen) {
			if (!dialog.open) {
				try {
					dialog.showModal();
				} catch {
					dialog.show();
				}
			}
		} else if (dialog.open) {
			dialog.close();
		}
	}, [isOpen]);

	useEffect(() => {
		return () => {
			const dialog = dialogRef.current;
			if (dialog?.open) dialog.close();
		};
	}, []);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		const handleCancel = (event: Event) => {
			event.preventDefault();
			if (!isSubmitting) onClose();
		};
		dialog.addEventListener("cancel", handleCancel);
		return () => dialog.removeEventListener("cancel", handleCancel);
	}, [isSubmitting, onClose]);

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
		<dialog
			ref={dialogRef}
			className="fixed inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)] p-0 text-[var(--text)] shadow-2xl backdrop:bg-black/45"
			onClick={(event) => {
				if (event.target === dialogRef.current && !isSubmitting) onClose();
			}}
		>
			<div className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col p-4">
				<p className="text-sm font-semibold text-[var(--text)]">
					{isSubmitted ? t("profile_details.report.submitted_title") : t("profile_details.report.title")}
				</p>

				{isSubmitted ? (
					<>
						<p className="mt-2 text-sm leading-relaxed text-[var(--text)]">{t("profile_details.report.submitted_message")}</p>
						{onBlock && (
							<p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">{t("profile_details.report.block_hint")}</p>
						)}
						<div className="mt-6 flex gap-2">
							{onBlock && (
								<button
									type="button"
									onClick={() => {
										onClose();
										onBlock();
									}}
									className={sheetButtonClass("destructive")}
								>
									{t("profile_details.block")}
								</button>
							)}
							<button
								type="button"
								onClick={onClose}
								className={sheetButtonClass()}
							>
								{t("profile_details.report.done")}
							</button>
						</div>
					</>
				) : (
					<>
						<p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{t("profile_details.report.message")}</p>

						<div className="mt-4 min-h-0 flex-1 overflow-y-auto" data-lenis-prevent>
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
								{t("profile_details.report.reason_label")}
							</p>
							<div className="flex flex-wrap gap-2">
								{REPORT_REASONS.map((value) => (
									<Chip
										key={value}
										selected={reason === value}
										disabled={isSubmitting}
										onClick={() => setReason(reason === value ? null : value)}
									>
										{t(`profile_details.report.reasons.${value}`)}
									</Chip>
								))}
							</div>

							{showDetails && (
								<>
									<p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
										{t("profile_details.report.location_label")}
									</p>
									<div className="flex flex-wrap gap-2">
										{REPORT_LOCATIONS.map((value) => (
											<Chip
												key={value}
												selected={locations.includes(value)}
												disabled={isSubmitting}
												onClick={() => toggleLocation(value)}
											>
												{t(`profile_details.report.locations.${value}`)}
											</Chip>
										))}
									</div>
									<textarea
										value={comment}
										onChange={(event) => setComment(event.target.value)}
										placeholder={t("profile_details.report.details_placeholder")}
										disabled={isSubmitting}
										rows={3}
										className="mt-4 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)] disabled:opacity-60"
									/>
								</>
							)}
						</div>

						<div className="mt-6 flex gap-2">
							<button
								type="button"
								onClick={onClose}
								disabled={isSubmitting}
								className={sheetButtonClass("secondary")}
							>
								{t("chat.actions.cancel")}
							</button>
							<button
								type="button"
								onClick={() => void handleSubmit()}
								disabled={isSubmitting || reason === null}
								className={sheetButtonClass()}
							>
								{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
								<span>{t("profile_details.report.submit")}</span>
							</button>
						</div>
					</>
				)}
			</div>
		</dialog>
	);
}
