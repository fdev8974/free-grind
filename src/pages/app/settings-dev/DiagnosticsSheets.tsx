import { AlertCircle, CheckCircle2, Loader2, Radar, RefreshCcw } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { BottomSheet } from "../../../components/ui/bottom-sheet";
import { SHEET_CARD_FILL_CLASS, SHEET_GROUP_CLASS, SheetSection } from "../../../components/ui/sheet-section";
import type { useFingerprintCheck } from "../../../components/FingerprintCheckButton";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { cn } from "../../../utils/cn";
import { DRAWER_PRIMARY_BUTTON_CLASS, DrawerFooter, DrawerHeader } from "../chat/drawerUi";
import { NATIVE_SHEET_BG } from "../../../components/ui/action-sheet";

type DiagnosticTone = "ok" | "warn" | "error" | "idle";

const TONE_HERO: Record<DiagnosticTone, string> = {
	ok: "bg-emerald-500/15 text-emerald-400",
	warn: "bg-amber-500/15 text-amber-400",
	error: "bg-red-500/15 text-red-400",
	idle: "bg-[var(--surface-2)] text-[var(--text-muted)]",
};

/** Big status block at the top of a diagnostics sheet. */
function StatusHero({ tone, icon, title, description }: { tone: DiagnosticTone; icon: ReactNode; title: string; description: string }) {
	return (
		<div className={cn("mb-5 flex items-center gap-3 rounded-2xl p-3", SHEET_CARD_FILL_CLASS)}>
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
	return <div className={SHEET_GROUP_CLASS}>{children}</div>;
}

function sheetPanelClass(isDesktop: boolean) {
	return isDesktop ? "max-h-[82dvh] px-4" : "px-4";
}

function fingerprintTone(check: ReturnType<typeof useFingerprintCheck>): DiagnosticTone {
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

	// Run a fresh check every time the sheet opens. The ref keeps StrictMode's
	// double effect run (and a check already in flight) from starting a second one.
	const startedRef = useRef(false);
	const checkFingerprint = check.checkFingerprint;
	useEffect(() => {
		if (startedRef.current || loading) return;
		startedRef.current = true;
		void checkFingerprint();
	}, [checkFingerprint, loading]);

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

