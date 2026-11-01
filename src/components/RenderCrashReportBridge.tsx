/**
 * RenderCrashReportBridge — after the Android WebView's renderer died (e.g.
 * out of memory, which takes the app down), shows what the native side
 * recorded (RenderProcessGuard.kt) once on the next start, laid out like
 * AccountStatusPrompt, with the raw report behind Copy for bug reports. Also
 * keeps the JS heap size in the crash context.
 *
 * Outside the Android WebView the bridge is missing and this does nothing.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Cpu, MapPin, MemoryStick, Smartphone, TriangleAlert, type LucideIcon } from "lucide-react";
import toast from "react-hot-toast";
import { FullscreenPortal, FullscreenPrompt, fullscreenCardClass, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { setCrashContext, takeRenderCrashReport } from "../utils/crashContext";
import { appLog } from "../utils/logger";

const HEAP_SAMPLE_MS = 15_000;

type ChromeMemory = { usedJSHeapSize: number; jsHeapSizeLimit: number };

/** What RenderProcessGuard.kt writes; every field may be missing in older reports. */
type RenderCrashReport = {
	didCrash?: boolean;
	route?: string;
	memory?: { availMb?: number; totalMb?: number; lowMemory?: boolean };
	lastTrim?: { level?: string; secondsAgo?: number };
	device?: { manufacturer?: string; model?: string; sdk?: number; webView?: string };
};

function parseReport(raw: string): RenderCrashReport {
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as RenderCrashReport) : {};
	} catch {
		return {};
	}
}

function formatRaw(raw: string): string {
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

const META_ROW_CLASS = "flex items-start gap-2 text-xs leading-relaxed text-[var(--text-muted)]";
const META_ICON_CLASS = "mt-px h-4 w-4 shrink-0 text-[var(--accent)]";

function RenderCrashPrompt({ raw, onClose }: { raw: string; onClose: () => void }) {
	const { t } = useTranslation();
	const report = parseReport(raw);
	// didCrash false means Android killed the renderer to get memory back.
	const outOfMemory = report.didCrash === false;

	const rows: { icon: LucideIcon; text: string }[] = [];
	if (report.route) {
		rows.push({ icon: MapPin, text: t("render_crash.row_route", { route: report.route, defaultValue: "Screen: {{route}}" }) });
	}
	if (report.memory?.availMb != null && report.memory.totalMb != null) {
		rows.push({
			icon: MemoryStick,
			text: t("render_crash.row_memory", {
				free: report.memory.availMb,
				total: report.memory.totalMb,
				defaultValue: "Free memory: {{free}} of {{total}} MB",
			}),
		});
	}
	if (report.device?.model) {
		rows.push({
			icon: Smartphone,
			text: [report.device.manufacturer, report.device.model, report.device.sdk != null ? `Android API ${report.device.sdk}` : null]
				.filter(Boolean)
				.join(" · "),
		});
	}
	if (report.device?.webView) {
		rows.push({ icon: Cpu, text: `WebView ${report.device.webView}` });
	}

	const copyDetails = () => {
		navigator.clipboard
			.writeText(formatRaw(raw))
			.then(() => toast.success(t("render_crash.copy_success", { defaultValue: "Details copied to clipboard" })))
			.catch(() => {});
	};

	return (
		<FullscreenPortal className="z-[110]">
			<FullscreenPrompt
				icon={TriangleAlert}
				title={t("render_crash.title", { defaultValue: "App Closed Unexpectedly" })}
				description={t("render_crash.description", {
					defaultValue: "Last time, the app's web view stopped and the app had to close. Copy the details and add them to your bug report.",
				})}
				footer={
					<>
						<button type="button" onClick={copyDetails} className={fullscreenPrimaryButtonClass}>
							<Copy className="h-4 w-4" />
							{t("render_crash.copy_details", { defaultValue: "Copy Details" })}
						</button>
						<button type="button" onClick={onClose} className={fullscreenSecondaryButtonClass}>
							{t("render_crash.continue", { defaultValue: "Continue" })}
						</button>
					</>
				}
			>
				<section className={`${fullscreenCardClass} px-4 py-4 text-left`}>
					<p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
						{t("render_crash.what_happened", { defaultValue: "What happened" })}
					</p>
					<h2 className="mt-1.5 text-base font-semibold leading-snug text-[var(--text)]">
						{outOfMemory
							? t("render_crash.oom_title", { defaultValue: "Out of memory" })
							: t("render_crash.crash_title", { defaultValue: "Web view crashed" })}
					</h2>
					<p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
						{outOfMemory
							? t("render_crash.oom_text", {
									defaultValue: "Android stopped the web view to free up memory for other apps or the system.",
								})
							: t("render_crash.crash_text", { defaultValue: "The web view ran into an internal error and stopped." })}
					</p>
					{rows.length > 0 ? (
						<div className="mt-3 flex flex-col gap-1.5">
							{rows.map(({ icon: Icon, text }) => (
								<p key={text} className={`${META_ROW_CLASS} break-all`}>
									<Icon className={META_ICON_CLASS} />
									{text}
								</p>
							))}
						</div>
					) : null}
				</section>
			</FullscreenPrompt>
		</FullscreenPortal>
	);
}

export function RenderCrashReportBridge() {
	// Taken (and cleared natively) once per start.
	const [report, setReport] = useState<string | null>(() => takeRenderCrashReport());

	useEffect(() => {
		if (report) appLog.error("[RenderCrashReportBridge] renderer died last session", report);
		// Only the report found at start is logged.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		const memory = (performance as unknown as { memory?: ChromeMemory }).memory;
		if (!memory) return;
		const sample = () => {
			const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
			setCrashContext("jsHeapMb", `${mb(memory.usedJSHeapSize)}/${mb(memory.jsHeapSizeLimit)}`);
		};
		sample();
		const timer = window.setInterval(sample, HEAP_SAMPLE_MS);
		return () => window.clearInterval(timer);
	}, []);

	return report ? <RenderCrashPrompt raw={report} onClose={() => setReport(null)} /> : null;
}
