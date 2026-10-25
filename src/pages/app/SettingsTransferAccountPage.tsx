import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Copy, DatabaseBackup, EyeOff, QrCode } from "lucide-react";
import { ShieldAlertFilled, SmartphoneFilled } from "../../components/icons/FilledIcons";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { useApi } from "../../hooks/useApi";
import { appLog } from "../../utils/logger";

// The code stays valid for 10 minutes (TRANSFER_CODE_TTL_SECS in auth.rs), but
// is only on screen for 2, so it doesn't sit there for anyone walking by.
const DISPLAY_SECONDS = 120;

type ShownCode = {
	code: string;
	qrSvg: string;
	/** Unix milliseconds the code goes off screen. */
	hideAt: number;
};

function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Shows a sign-in code for the active account as a QR code, for another
 * device to scan (or paste, on desktop) on its sign-in page — see
 * create_transfer_code / sign_in_with_transfer_code in api/auth.rs.
 */
export function SettingsTransferAccountPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { callMethod, asAppError } = useApi();
	const [shown, setShown] = useState<ShownCode | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!shown) return;
		const timer = window.setInterval(() => {
			const current = Date.now();
			setNow(current);
			if (current >= shown.hideAt) setShown(null);
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

	return (
		<section className="app-screen">
			<PageHeader
				backTo="/settings"
				title={t("account_transfer.title", { defaultValue: "Sign in on another device" })}
				subtitle={t("account_transfer.subtitle", {
					defaultValue: "Sign this account in on another device without typing your password.",
				})}
			/>

			<div className="grid gap-6">
				<div className="native-card flex items-start gap-3 p-4">
					<div className="shrink-0 rounded-2xl bg-amber-500/15 p-2.5 text-amber-400">
						<ShieldAlertFilled className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold leading-snug">
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

				{shown ? (
					<div className="native-card flex flex-col items-center gap-4 p-5 animate-fade-in">
						{/* Always dark on white, whatever the theme: scanners expect it. */}
						<img
							src={`data:image/svg+xml;utf8,${encodeURIComponent(shown.qrSvg)}`}
							alt={t("account_transfer.qr_alt", { defaultValue: "Sign-in QR code" })}
							className="aspect-square w-full max-w-[280px] rounded-2xl bg-white p-2"
						/>
						<p className="text-xs tabular-nums text-[var(--text-muted)]">
							{t("account_transfer.hides_in", {
								defaultValue: "Hides in {{time}}",
								time: formatCountdown(shown.hideAt - now),
							})}
						</p>
						<div className="grid w-full grid-cols-2 gap-2">
							<Button type="button" onClick={() => void copyCode()} leftIcon={<Copy className="h-4 w-4" />}>
								{t("account_transfer.copy", { defaultValue: "Copy code" })}
							</Button>
							<Button type="button" onClick={() => setShown(null)} leftIcon={<EyeOff className="h-4 w-4" />}>
								{t("account_transfer.hide", { defaultValue: "Hide" })}
							</Button>
						</div>
					</div>
				) : (
					<Button
						type="button"
						variant="primary"
						loading={isCreating}
						onClick={() => void showCode()}
						leftIcon={<QrCode className="h-4 w-4" />}
						className="w-full"
					>
						{t("account_transfer.show", { defaultValue: "Show sign-in code" })}
					</Button>
				)}

				<div className="native-card flex items-start gap-3 p-4">
					<div className="shrink-0 rounded-2xl bg-[var(--surface-2)] p-2.5 text-[var(--text-muted)]">
						<SmartphoneFilled className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold leading-snug">
							{t("account_transfer.howto_title", { defaultValue: "On the other device" })}
						</p>
						<p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
							{t("account_transfer.howto_desc", {
								defaultValue:
									"On the Free Grind sign-in screen, tap \"Use a QR code\" and scan this code. On a computer, copy the code instead and paste it there. Both devices stay signed in.",
							})}
						</p>
					</div>
				</div>

				{/* Chats, albums and settings live in this device's local db, not on
				    Grindr's servers, so the code alone doesn't bring them along. */}
				<button
					type="button"
					onClick={() => navigate("/settings/data#data-export")}
					className="native-card flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"
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
					<ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-50" />
				</button>
			</div>
		</section>
	);
}
