import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ChevronRight, Info, Loader2, ShieldAlert, Smartphone } from "lucide-react";
import toast from "react-hot-toast";
import { FullscreenPrompt, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { OutdatedVersionPromptView, fetchLatestRelease, isOlderVersion, type ReleaseInfo } from "./OutdatedVersionPrompt";
import {
	dismissUnsupportedVersion,
	noticeUnsupportedVersionInError,
	useUnsupportedVersion,
	type UnsupportedVersionError,
} from "../services/unsupportedVersion";
import { getCurrentHotswapChannel } from "../services/hotswap";
import { appLog } from "../utils/logger";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "unknown";

export function UnsupportedVersionPromptView({
	error,
	onDismiss,
}: {
	error: UnsupportedVersionError;
	onDismiss: () => void;
}) {
	const { t } = useTranslation();
	const [checking, setChecking] = useState(false);
	const [release, setRelease] = useState<ReleaseInfo | null>(null);

	if (release) {
		return (
			<OutdatedVersionPromptView appVersion={APP_VERSION} releaseInfo={release} onDismiss={() => setRelease(null)} manual />
		);
	}

	const checkForUpdate = () => {
		setChecking(true);
		const controller = new AbortController();
		fetchLatestRelease(controller.signal, getCurrentHotswapChannel() !== "main")
			.then((latest) => {
				if (isOlderVersion(APP_VERSION, latest.latestVersion)) {
					setRelease(latest);
				} else {
					toast(t("unsupported_version.no_update", { defaultValue: "No newer version is out yet. Check again later." }));
				}
			})
			.catch((reason: unknown) => {
				appLog.warn("[UnsupportedVersion] release lookup failed", reason);
				toast.error(t("unsupported_version.check_failed", { defaultValue: "Couldn't check for updates" }));
			})
			.finally(() => setChecking(false));
	};

	const details = [
		{ icon: Smartphone, label: t("unsupported_version.app_version", { defaultValue: "App version" }), value: APP_VERSION },
		...(error.message
			? [{ icon: Info, label: t("unsupported_version.grindr_says", { defaultValue: "Grindr says" }), value: `${error.message} (${error.code})` }]
			: []),
	];

	return (
		<FullscreenPrompt
			icon={ShieldAlert}
			title={t("unsupported_version.title", { defaultValue: "Update Required" })}
			description={t("unsupported_version.description", {
				defaultValue:
					"Grindr no longer accepts the app version Free Grind identifies as. Update Free Grind to keep using it — until then, sign-in and most features won't work.",
			})}
			footer={
				<>
					<button type="button" onClick={checkForUpdate} disabled={checking} className={fullscreenPrimaryButtonClass}>
						{checking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
						{t("unsupported_version.check", { defaultValue: "Check for Update" })}
						{checking ? null : <ChevronRight className="h-4 w-4" />}
					</button>
					<button type="button" onClick={onDismiss} disabled={checking} className={fullscreenSecondaryButtonClass}>
						{t("unsupported_version.dismiss", { defaultValue: "Not Now" })}
					</button>
				</>
			}
		>
			<dl className={"native-group text-left"}>
				{details.map(({ icon: Icon, label, value }) => (
					<div key={label} className="flex items-center gap-3 px-4 py-3.5">
						<div className="shrink-0 rounded-2xl ink-tint-8 p-2.5 text-[var(--accent)]">
							<Icon className="h-5 w-5" />
						</div>
						<div className="min-w-0 flex-1">
							<dt className="text-xs text-[var(--text-muted)]">{label}</dt>
							<dd className="mt-0.5 break-words text-sm font-semibold leading-snug text-[var(--text)]">{value}</dd>
						</div>
					</div>
				))}
			</dl>
		</FullscreenPrompt>
	);
}

/**
 * Gates the whole app (signed in or not) once Grindr refuses the emulated app
 * version (code 8). Fed by every invoke/REST call through useApi and by the
 * Rust side's auth:unsupported-version, which a background token refresh
 * raises (see api/session_recovery.rs). Asked once per run; "Not now" lets
 * the user keep looking at cached data.
 */
export function UnsupportedVersionGate({ children }: { children: ReactNode }) {
	const error = useUnsupportedVersion();

	useEffect(() => {
		const unlisten = listen<unknown>("auth:unsupported-version", (event) => {
			noticeUnsupportedVersionInError({ kind: "Api", message: event.payload });
		});
		return () => {
			void unlisten.then((fn) => fn());
		};
	}, []);

	if (!error) {
		return <>{children}</>;
	}

	return (
		<div className="app-shell">
			<UnsupportedVersionPromptView error={error} onDismiss={dismissUnsupportedVersion} />
		</div>
	);
}
