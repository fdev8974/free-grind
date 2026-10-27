import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Copy, DatabaseBackup, Loader2, QrCode } from "lucide-react";
import { ShieldAlertFilled } from "../../components/icons/FilledIcons";
import { PageHeader } from "../../components/PageHeader";
import {
	BottomSheet,
	SheetClose,
	SheetCloseButton,
	SHEET_FOOTER_CLASS,
	sheetButtonClass,
} from "../../components/ui/bottom-sheet";
import { useApi } from "../../hooks/useApi";
import { useDesktopBreakpoint } from "../../hooks/useDesktopBreakpoint";
import { appLog } from "../../utils/logger";

// The code stays valid for 10 minutes (TRANSFER_CODE_TTL_SECS in auth.rs), but
// is only on screen for 2, so it doesn't sit there for anyone walking by.
const DISPLAY_SECONDS = 120;

type ShownCode = {
	code: string;
	qrSvg: string;
	/** Unix milliseconds the code went on screen, for the countdown bar. */
	shownAt: number;
	/** Unix milliseconds the code goes off screen. */
	hideAt: number;
};

function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "This code is your login" note, on the page and again next to the code. */
function TransferWarning() {
	const { t } = useTranslation();
	return (
		<div className="flex items-start gap-3 rounded-2xl bg-amber-500/12 px-4 py-3.5 text-left">
			<ShieldAlertFilled className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold leading-snug text-amber-500">
					{t("account_transfer.warning_title", { defaultValue: "This code is your login" })}
				</p>
				<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
					{t("account_transfer.warning_desc", {
						defaultValue:
							"Anyone who scans or copies it can sign in to your account for the next 10 minutes. Only show it to a device you own, and never send it to anyone.",
					})}
				</p>
			</div>
		</div>
	);
}

/**
 * Shows a sign-in code for the active account as a QR code, for another
 * device to scan (or paste, on desktop) on its sign-in page — see
 * create_transfer_code / sign_in_with_transfer_code in api/auth.rs.
 */
export function SettingsTransferAccountPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const isDesktop = useDesktopBreakpoint();
	const { callMethod, asAppError } = useApi();
	const [shown, setShown] = useState<ShownCode | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	// Slides the sheet out when the code's time is up, instead of unmounting it.
	const closeSheetRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		if (!shown) return;
		const timer = window.setInterval(() => {
			const current = Date.now();
			setNow(current);
			if (current >= shown.hideAt) closeSheetRef.current?.();
		}, 1000);
		return () => window.clearInterval(timer);
	}, [shown]);

	const showCode = async () => {
		setIsCreating(true);
		try {
			const result = await callMethod("create_transfer_code");
			const current = Date.now();
			setNow(current);
			setShown({
				code: result.code,
				qrSvg: result.qrSvg,
				shownAt: current,
				hideAt: Math.min(current + DISPLAY_SECONDS * 1000, result.expiresAt * 1000),
			});
		} catch (error) {
			const appError = asAppError(error);
			appLog.error("[Transfer] create_transfer_code failed", { kind: appError?.kind });
			toast.error(
				appError?.kind === "Auth" && appError.message === "transfer-unsupported"
					? t("account_transfer.unsupported", {
							defaultValue: "This sign-in can't be moved to another device. Sign in with email and password or Google instead.",
						})
					: appError?.prettyMessage || t("account_transfer.create_failed", { defaultValue: "Couldn't create a sign-in code." }),
			);
		} finally {
			setIsCreating(false);
		}
	};

	const copyCode = async () => {
		if (!shown) return;
		try {
			await navigator.clipboard.writeText(shown.code);
			toast.success(t("account_transfer.copied", { defaultValue: "Code copied" }));
		} catch {
			toast.error(t("account_transfer.copy_failed", { defaultValue: "Couldn't copy the code." }));
		}
	};

	const remainingMs = shown ? Math.max(0, shown.hideAt - now) : 0;
	const remainingFraction = shown ? remainingMs / Math.max(1, shown.hideAt - shown.shownAt) : 0;

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("account_transfer.title", { defaultValue: "Sign in on another device" })}
				subtitle={t("account_transfer.subtitle", {
					defaultValue: "Sign this account in on another device without typing your password.",
				})}
			/>

			<div className="grid gap-4">
				<div className="native-card flex flex-col items-center px-5 pb-5 pt-6 text-center">
					<div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_70%,black)] text-[var(--accent-contrast)] shadow-lg shadow-[var(--accent)]/25">
						<QrCode className="h-8 w-8" />
					</div>
					<p className="text-base font-semibold">
						{t("account_transfer.howto_title", { defaultValue: "On the other device" })}
					</p>
					<p className="mt-1 max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
						{t("account_transfer.howto_desc", {
							defaultValue:
								"On the Free Grind sign-in screen, tap \"Use a QR code\" and scan this code. On a computer, copy the code instead and paste it there. Both devices stay signed in.",
						})}
					</p>
					<button
						type="button"
						onClick={() => void showCode()}
						disabled={isCreating}
						className={`${sheetButtonClass()} mt-5 w-full flex-none`}
					>
						{isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
						{t("account_transfer.show", { defaultValue: "Show sign-in code" })}
					</button>
				</div>

				<TransferWarning />

				{/* Chats, albums and settings live in this device's local db, not on
				    Grindr's servers, so the code alone doesn't bring them along. */}
				<button
					type="button"
					onClick={() => navigate("/settings/data#data-export")}
					className="native-card flex w-full items-center gap-3 p-4 text-left transition active:scale-[0.99]"
				>
					<div className="shrink-0 rounded-2xl bg-teal-500/15 p-2.5 text-teal-400">
						<DatabaseBackup className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold leading-snug">
							{t("account_transfer.backup_title", { defaultValue: "Bring your data along" })}
						</p>
						<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
							{t("account_transfer.backup_desc", {
								defaultValue:
									"Chat history, albums, saved phrases, saved locations and settings are stored on this device only. Export them under Backup & Restore and import the file on the new device to have everything there too.",
							})}
						</p>
					</div>
					<ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
				</button>
			</div>

			{shown ? (
				<BottomSheet
					onClose={() => setShown(null)}
					isDesktop={isDesktop}
					closeRef={closeSheetRef}
					panelClassName="max-h-[92dvh] px-4"
				>
					<div className="mb-3 flex items-center justify-between gap-3">
						<p className="text-sm font-semibold text-[var(--text)]">
							{t("account_transfer.qr_alt", { defaultValue: "Sign-in QR code" })}
						</p>
						<SheetCloseButton />
					</div>
					<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
						<div className="flex flex-col items-center gap-4">
							{/* Always dark on white, whatever the theme: scanners expect it. */}
							<img
								src={`data:image/svg+xml;utf8,${encodeURIComponent(shown.qrSvg)}`}
								alt={t("account_transfer.qr_alt", { defaultValue: "Sign-in QR code" })}
								className="aspect-square w-full max-w-[300px] rounded-3xl bg-white p-3"
							/>
							<div className="flex w-full max-w-[300px] flex-col items-center gap-2">
								<div className="h-1.5 w-full overflow-hidden rounded-full ink-tint-10">
									<div
										className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-1000 ease-linear"
										style={{ width: `${remainingFraction * 100}%` }}
									/>
								</div>
								<p className="text-xs tabular-nums text-[var(--text-muted)]">
									{t("account_transfer.hides_in", {
										defaultValue: "Hides in {{time}}",
										time: formatCountdown(remainingMs),
									})}
								</p>
							</div>
							<TransferWarning />
						</div>
					</div>
					<div className={SHEET_FOOTER_CLASS}>
						<button type="button" onClick={() => void copyCode()} className={sheetButtonClass("secondary")}>
							<Copy className="h-4 w-4" />
							{t("account_transfer.copy", { defaultValue: "Copy code" })}
						</button>
						<SheetClose className={sheetButtonClass()}>
							{t("account_transfer.hide", { defaultValue: "Hide" })}
						</SheetClose>
					</div>
				</BottomSheet>
			) : null}
		</section>
	);
}
