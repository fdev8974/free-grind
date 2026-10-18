import { AlertCircle, Bell, CheckCircle2, Copy, Loader2, Radar, RefreshCcw } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import toast from "react-hot-toast";
import { BottomSheet, SHEET_ICON_BUTTON_CLASS } from "../../../components/ui/bottom-sheet";
import { RowActionPill } from "../../../components/ui/row-action-pill";
import { SheetSection } from "../../../components/ui/sheet-section";
import type { useFingerprintCheck } from "../../../components/FingerprintCheckButton";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { cn } from "../../../utils/cn";
import { DRAWER_PRIMARY_BUTTON_CLASS, DrawerFooter, DrawerHeader } from "../chat/drawerUi";
import { NATIVE_SHEET_BG } from "../settings-albums/SheetActionList";

export type DiagnosticTone = "ok" | "warn" | "error" | "idle";

const TONE_BADGE: Record<Exclude<DiagnosticTone, "idle">, string> = {
	ok: "bg-emerald-500",
	warn: "bg-amber-500",
	error: "bg-red-500",
};

/** Status dot on a settings row's icon tile (green / amber / red). */
export function DiagnosticBadge({ tone, loading }: { tone: DiagnosticTone; loading?: boolean }) {
	if (loading) {
		return (
			<div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] ring-2 ring-[var(--surface)]">
				<Loader2 className="h-3 w-3 animate-spin" />
			</div>
		);
	}
	if (tone === "idle") return null;
	return (
		<div className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-white ring-2 ring-[var(--surface)] ${TONE_BADGE[tone]}`}>
			{tone === "ok" ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
		</div>
	);
}

const TONE_HERO: Record<DiagnosticTone, string> = {
	ok: "bg-emerald-500/15 text-emerald-400",
	warn: "bg-amber-500/15 text-amber-400",
	error: "bg-red-500/15 text-red-400",
	idle: "bg-[var(--surface-2)] text-[var(--text-muted)]",
};

/** Big status block at the top of a diagnostics sheet. */
function StatusHero({ tone, icon, title, description }: { tone: DiagnosticTone; icon: ReactNode; title: string; description: string }) {
	return (
		<div className="mb-5 flex items-center gap-3 rounded-2xl bg-[var(--surface-2)] p-3">
			<div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", TONE_HERO[tone])}>{icon}</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold leading-snug">{title}</p>
				<p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">{description}</p>
			</div>
		</div>
	);
}

function MatchBadge({ match }: { match: boolean }) {
	return (
		<span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${match ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
			{match ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
			{match ? "Match" : "Mismatch"}
		</span>
	);
}

/** A grouped list card inside a sheet section. */
function SheetListCard({ children }: { children: ReactNode }) {
	return <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl bg-[var(--surface-2)]">{children}</div>;
}

function sheetPanelClass(isDesktop: boolean) {
	return isDesktop ? "max-h-[82dvh] px-4" : "px-4";
}

export function fingerprintTone(check: ReturnType<typeof useFingerprintCheck>): DiagnosticTone {
	if (check.ok) return "ok";
	if (check.result || check.error) return "error";
	return "idle";
}

export function FingerprintCheckSheet({
	check,
	onClose,
}: {
	check: ReturnType<typeof useFingerprintCheck>;
	onClose: () => void;
}) {
	const isDesktop = useDesktopBreakpoint();
	const tone = fingerprintTone(check);
	const { result, error, loading } = check;

	return (
		<BottomSheet onClose={onClose} expandable isDesktop={isDesktop} bg={NATIVE_SHEET_BG} panelClassName={sheetPanelClass(isDesktop)}>
			<DrawerHeader title="Fingerprint Check" />
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<StatusHero
					tone={loading ? "idle" : tone}
					icon={loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radar className="h-5 w-5" />}
					title={
						loading ? "Checking…"
							: tone === "ok" ? "Matches OkHttp"
							: result ? "Fingerprint mismatch"
							: error ? "Check failed"
							: "Not checked yet"
					}
					description="Compares this app's HTTP/TLS fingerprint with the OkHttp configuration."
				/>

				{result && !loading && (
					<SheetSection title="Results">
						<SheetListCard>
							<div className="px-3.5 py-3">
								<div className="flex items-center justify-between gap-2">
									<p className="text-sm font-semibold">JA3 Hash</p>
									<MatchBadge match={result.ja3_match} />
								</div>
								<p className="mt-1 break-all font-mono text-xs text-[var(--text-muted)] select-all">{result.ja3_hash}</p>
							</div>
							<div className="px-3.5 py-3">
								<div className="flex items-center justify-between gap-2">
									<p className="text-sm font-semibold">Akamai Fingerprint</p>
									<MatchBadge match={result.akamai_match} />
								</div>
								<p className="mt-1 break-all font-mono text-xs text-[var(--text-muted)] select-all">{result.akamai_fingerprint}</p>
							</div>
							<div className="flex items-center justify-between gap-2 px-3.5 py-3">
								<p className="text-sm font-semibold">HTTP Version</p>
								<span className="rounded-lg bg-[var(--surface)] px-2.5 py-1 font-mono text-xs font-semibold">{result.http_version}</span>
							</div>
						</SheetListCard>
					</SheetSection>
				)}

				{error && !loading && (
					<div className="rounded-2xl bg-red-500/10 px-3.5 py-3 text-red-400">
						<p className="text-sm font-semibold">Fingerprint check failed</p>
						<p className="mt-0.5 break-words text-xs opacity-80">{error}</p>
					</div>
				)}
			</div>
			<DrawerFooter>
				<button type="button" onClick={() => void check.checkFingerprint()} disabled={loading} className={DRAWER_PRIMARY_BUTTON_CLASS}>
					{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
					<span>{result || error ? "Check again" : "Run check"}</span>
				</button>
			</DrawerFooter>
		</BottomSheet>
	);
}

export function PushTokenSheet({
	token,
	isSynced,
	isSyncing,
	eventLog,
	logRef,
	manualToken,
	onManualTokenChange,
	onSync,
	onClose,
}: {
	token: string | null;
	isSynced: boolean;
	isSyncing: boolean;
	eventLog: { time: string; token: string }[];
	logRef: RefObject<HTMLDivElement | null>;
	manualToken: string;
	onManualTokenChange: (value: string) => void;
	/** Syncs `override` when given, else the current token. */
	onSync: (override?: string) => void;
	onClose: () => void;
}) {
	const isDesktop = useDesktopBreakpoint();
	const tone: DiagnosticTone = !token ? "warn" : isSynced ? "ok" : "warn";

	const copyToken = () => {
		if (!token) return;
		navigator.clipboard
			.writeText(token)
			.then(() => toast.success("Token copied"))
			.catch(() => toast.error("Couldn't copy the token"));
	};

	return (
		<BottomSheet onClose={onClose} expandable isDesktop={isDesktop} bg={NATIVE_SHEET_BG} panelClassName={sheetPanelClass(isDesktop)}>
			<DrawerHeader title="Push Token (FCM)" />
			<div className="-mx-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				<StatusHero
					tone={tone}
					icon={<Bell className="h-5 w-5 fill-current" />}
					title={!token ? "No token received yet" : isSynced ? "Synced to Grindr" : "Not synced to Grindr"}
					description={
						token
							? "The device token push notifications are delivered to, for this account."
							: "Android delivers it via the fg:fcm-token event after Firebase initialises on launch."
					}
				/>

				{token && (
					<SheetSection title="Token">
						<div className="flex items-start gap-2 rounded-2xl bg-[var(--surface-2)] py-2 pl-3.5 pr-2">
							<p className="min-w-0 flex-1 break-all py-1 font-mono text-xs select-all">{token}</p>
							<button type="button" onClick={copyToken} className={SHEET_ICON_BUTTON_CLASS} aria-label="Copy token" title="Copy token">
								<Copy className="h-4 w-4" />
							</button>
						</div>
					</SheetSection>
				)}

				<SheetSection title="Live events" value={eventLog.length > 0 ? String(eventLog.length) : undefined}>
					<div ref={logRef} className="max-h-40 overflow-y-auto rounded-2xl bg-[var(--surface-2)] px-3.5 py-2.5" data-lenis-prevent>
						{eventLog.length === 0 ? (
							<p className="text-xs text-[var(--text-muted)]">No fg:fcm-token events since this page opened. Waiting…</p>
						) : (
							<div className="space-y-1">
								{eventLog.map((entry, i) => (
									<p key={i} className="break-all font-mono text-xs">
										<span className="text-[var(--text-muted)]">{entry.time} </span>
										{entry.token.slice(0, 20)}…{entry.token.slice(-8)}
									</p>
								))}
							</div>
						)}
					</div>
				</SheetSection>

				<SheetSection title="Manual sync">
					<div className="flex items-center gap-2">
						<input
							type="text"
							value={manualToken}
							onChange={(e) => onManualTokenChange(e.target.value)}
							placeholder="Paste an FCM token…"
							className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 font-mono text-xs text-[var(--text)] outline-none transition placeholder:font-sans placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
						/>
						<RowActionPill onClick={() => onSync(manualToken.trim())} disabled={!manualToken.trim()} loading={isSyncing} className="h-11 rounded-xl px-4">
							Sync
						</RowActionPill>
					</div>
				</SheetSection>
			</div>
			<DrawerFooter>
				<button type="button" onClick={() => onSync()} disabled={!token || isSyncing} className={DRAWER_PRIMARY_BUTTON_CLASS}>
					{isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
					<span>{isSyncing ? "Syncing…" : "Re-sync token"}</span>
				</button>
			</DrawerFooter>
		</BottomSheet>
	);
}
