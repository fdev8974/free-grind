import { AlertTriangle, Bell, Camera, Check, ChevronRight, ExternalLink, Loader2, MapPin, Mic, RefreshCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";
import {
	checkPermissions as checkGeoPermissions,
	requestPermissions as requestGeoPermissions,
} from "@tauri-apps/plugin-geolocation";
import { platform } from "@tauri-apps/plugin-os";
import { isTauriRuntime } from "../services/tauriWebSocket";
import { getCurrentLocation } from "../services/currentLocation";
import { appLog } from "../utils/logger";
import { markOnboardingComplete } from "../utils/onboardingStorage";
import { useHorizontalSwipe } from "../hooks/useHorizontalSwipe";
import { GITHUB_OTA_SIGNING_URL, openExternalUrl } from "../utils/githubIssues";
import { isHotswapAvailable, setHotswapAutoUpdateEnabled } from "../services/hotswap";
import { usePreferences, ACCENT_PRESETS } from "../contexts/PreferencesContext";
import type { ColorScheme } from "../contexts/PreferencesContext";
import { LoadingScreen } from "./LoadingScreen";
import logo from "../images/freegrind-logo.webp";
import { fullscreenIconTileClass, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { SchemePreview } from "./SchemePreview";

type PermissionStatus = "idle" | "granted" | "denied" | "unavailable";

const MIN_LOADING_MS = 1100;
const PERMISSION_TIMEOUT_MS = 8_000;
const BRIDGE_POLL_INTERVAL_MS = 600;
const BRIDGE_POLL_TIMEOUT_MS = 90_000;

type AndroidBridge = {
	checkMicrophonePermission?: () => boolean;
	checkCameraPermission?: () => boolean;
	checkNotificationPermission?: () => boolean;
	checkLocationPermission?: () => boolean;
};

function getAndroidBridge(): AndroidBridge | undefined {
	return (window as unknown as Record<string, unknown>).FreeGrindBridge as AndroidBridge | undefined;
}

function pollBridgePermission(checkFn: () => boolean): Promise<boolean> {
	return new Promise((resolve) => {
		if (checkFn()) { resolve(true); return; }
		const deadline = Date.now() + BRIDGE_POLL_TIMEOUT_MS;
		const tick = () => {
			if (checkFn()) { resolve(true); return; }
			if (Date.now() >= deadline) { resolve(false); return; }
			setTimeout(tick, BRIDGE_POLL_INTERVAL_MS);
		};
		setTimeout(tick, BRIDGE_POLL_INTERVAL_MS);
	});
}

function withTimeout<T>(promise: Promise<T>, ms = PERMISSION_TIMEOUT_MS): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("Permission request timed out")), ms),
		),
	]);
}

function classifyMediaError(
	error: unknown,
	kind: "microphone" | "camera",
): { status: PermissionStatus; detail: string } {
	const name = error instanceof DOMException ? error.name : null;
	const message = error instanceof Error ? error.message : String(error);
	const lowerMessage = message.toLowerCase();

	if (
		name === "NotFoundError" ||
		name === "OverconstrainedError" ||
		name === "ConstraintNotSatisfiedError" ||
		lowerMessage.includes("constraint") ||
		lowerMessage.includes("no device")
	) {
		return { status: "unavailable", detail: `No ${kind} found on this device.` };
	}
	if (name === "NotReadableError") {
		return { status: "unavailable", detail: `${kind === "microphone" ? "Microphone" : "Camera"} is in use by another app.` };
	}
	if (name === "NotAllowedError" || name === "SecurityError") {
		return { status: "denied", detail: "Access was denied." };
	}
	return { status: "denied", detail: message || `Couldn't access the ${kind}.` };
}

const PERM_STEPS = ["notifications", "location", "microphone", "camera"] as const;
type PermStep = typeof PERM_STEPS[number];
type Step = "loading" | "welcome" | "theme" | "accent" | PermStep | "updates" | "scam";

// OTA updates only exist in the native app, so the web build skips that step.
const DOT_STEPS: Step[] = [
	"theme", "accent", "notifications", "location", "microphone", "camera",
	...(isHotswapAvailable() ? (["updates"] as const) : []),
	"scam",
];

const STEP_ORDER: Step[] = ["welcome", ...DOT_STEPS];

function StepDots({ current }: { current: Step }) {
	const currentIdx = DOT_STEPS.indexOf(current);
	if (currentIdx === -1) return null;
	return (
		<div className="flex items-center justify-center gap-2">
			{DOT_STEPS.map((_, i) => (
				<div
					key={i}
					className="h-1.5 rounded-full transition-all duration-300"
					style={{
						width: i === currentIdx ? "24px" : "6px",
						background: i <= currentIdx ? "var(--accent)" : "color-mix(in srgb, var(--text) 15%, transparent)",
					}}
				/>
			))}
		</div>
	);
}

function TopDots({ current }: { current: Step }) {
	return (
		<div
			className="top-dots-wrap flex justify-center pb-3 pt-5"
			style={{ paddingTop: "max(36px, env(safe-area-inset-top))" }}
		>
			<StepDots current={current} />
		</div>
	);
}

function StatusBadge({ status, isRequesting }: { status: PermissionStatus; isRequesting?: boolean }) {
	if (isRequesting) {
		return (
			<div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-2)] shadow-md">
				<Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
			</div>
		);
	}
	if (status === "granted") {
		return (
			<div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500 shadow-md">
				<Check className="h-3.5 w-3.5 text-white" />
			</div>
		);
	}
	if (status === "denied" || status === "unavailable") {
		return (
			<div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-2)] shadow-md">
				<X className="h-3.5 w-3.5 text-[var(--text-muted)]" />
			</div>
		);
	}
	return null;
}

export function PermissionsOnboarding({ onComplete }: { onComplete: () => void }) {
	const { colorScheme, amoledMode, accentColor, setPreferences } = usePreferences();
	const [step, setStep] = useState<Step>("loading");
	// Which side the current step slides in from: 1 = forward, -1 = back.
	const [direction, setDirection] = useState<1 | -1>(1);

	const [notificationStatus, setNotificationStatus] = useState<PermissionStatus>("idle");
	const [locationStatus, setLocationStatus] = useState<PermissionStatus>("idle");
	const [microphoneStatus, setMicrophoneStatus] = useState<PermissionStatus>("idle");
	const [microphoneDetail, setMicrophoneDetail] = useState<string | null>(null);
	const [cameraStatus, setCameraStatus] = useState<PermissionStatus>("idle");
	const [cameraDetail, setCameraDetail] = useState<string | null>(null);
	// Not a permission, but shown the same way: granted = auto-update on.
	const [updatesStatus, setUpdatesStatus] = useState<PermissionStatus>("idle");

	const [isRequesting, setIsRequesting] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => setStep("welcome"), MIN_LOADING_MS);
		return () => clearTimeout(timer);
	}, []);

	// Pre-check existing permissions when we reach the permissions phase
	useEffect(() => {
		if (step !== "notifications" || !isTauriRuntime()) return;

		(async () => {
			try {
				const granted = await isPermissionGranted();
				if (granted) setNotificationStatus("granted");
			} catch (error) {
				appLog.warn("[Onboarding] Failed to read notification permission", error);
			}

			try {
				const p = platform();
				if (p === "android" || p === "ios") {
					const perms = await checkGeoPermissions();
					if (perms.location === "granted") setLocationStatus("granted");
				} else {
					const status = await navigator.permissions?.query({ name: "geolocation" });
					if (status?.state === "granted") setLocationStatus("granted");
				}
			} catch (error) {
				appLog.warn("[Onboarding] Failed to read location permission", error);
			}

			try {
				const p = platform();
				if (p === "android") {
					const bridge = getAndroidBridge();
					if (bridge?.checkMicrophonePermission?.()) setMicrophoneStatus("granted");
				} else {
					const status = await navigator.permissions?.query({ name: "microphone" });
					if (status?.state === "granted") setMicrophoneStatus("granted");
				}
			} catch (error) {
				appLog.warn("[Onboarding] Failed to read microphone permission", error);
			}

			try {
				const p = platform();
				if (p === "android") {
					const bridge = getAndroidBridge();
					if (bridge?.checkCameraPermission?.()) setCameraStatus("granted");
				} else {
					const status = await navigator.permissions?.query({ name: "camera" });
					if (status?.state === "granted") setCameraStatus("granted");
				}
			} catch (error) {
				appLog.warn("[Onboarding] Failed to read camera permission", error);
			}
		})();
	}, [step]);

	const stepIdx = STEP_ORDER.indexOf(step);

	const advance = () => {
		if (stepIdx !== -1 && stepIdx < STEP_ORDER.length - 1) {
			setDirection(1);
			setStep(STEP_ORDER[stepIdx + 1]);
		}
	};

	const back = () => {
		if (stepIdx > 0) {
			setDirection(-1);
			setStep(STEP_ORDER[stepIdx - 1]);
		}
	};

	// Swiping forward is the same as the step's Continue/Skip, so it's left out
	// where the step still needs an explicit choice (updates) or finishes (scam).
	const canSwipeNext = !isRequesting
		&& (step === "welcome" || step === "theme" || step === "accent" || (PERM_STEPS as readonly Step[]).includes(step)
			|| (step === "updates" && updatesStatus !== "idle"));
	const swipe = useHorizontalSwipe({
		onNext: canSwipeNext ? advance : undefined,
		onPrev: !isRequesting && stepIdx > 0 ? back : undefined,
	});
	const pageClass = direction > 0 ? "animate-step-in-next" : "animate-step-in-prev";

	const requestNotifications = async () => {
		if (!isTauriRuntime()) { setNotificationStatus("granted"); return; }
		setIsRequesting(true);
		try {
			const bridge = getAndroidBridge();
			if (bridge?.checkNotificationPermission) {
				// Trigger the dialog, then poll the bridge for the real result
				requestPermission().catch(() => {});
				const granted = await pollBridgePermission(() => bridge.checkNotificationPermission!());
				setNotificationStatus(granted ? "granted" : "denied");
			} else {
				const result = await withTimeout(requestPermission());
				setNotificationStatus(result === "granted" ? "granted" : "denied");
			}
		} catch (error) {
			appLog.warn("[Onboarding] Failed to request notification permission", error);
			const granted = await isPermissionGranted().catch(() => false);
			setNotificationStatus(granted ? "granted" : "denied");
		} finally {
			setIsRequesting(false);
		}
	};

	const requestLocation = async () => {
		setIsRequesting(true);
		try {
			const p = platform();
			const bridge = getAndroidBridge();
			if (p === "android" && bridge?.checkLocationPermission) {
				requestGeoPermissions(["location"]).catch(() => {});
				const granted = await pollBridgePermission(() => bridge.checkLocationPermission!());
				setLocationStatus(granted ? "granted" : "denied");
			} else if (p === "android" || p === "ios") {
				const perms = await withTimeout(requestGeoPermissions(["location"]));
				setLocationStatus(perms.location === "granted" ? "granted" : "denied");
			} else {
				await withTimeout(getCurrentLocation());
				setLocationStatus("granted");
			}
		} catch (error) {
			appLog.warn("[Onboarding] Failed to request location permission", error);
			try {
				const p = platform();
				if (p === "android" || p === "ios") {
					const perms = await checkGeoPermissions();
					setLocationStatus(perms.location === "granted" ? "granted" : "denied");
				} else {
					const status = await navigator.permissions?.query({ name: "geolocation" });
					setLocationStatus(status?.state === "granted" ? "granted" : "denied");
				}
			} catch {
				setLocationStatus("denied");
			}
		} finally {
			setIsRequesting(false);
		}
	};

	const requestMicrophone = async () => {
		setIsRequesting(true);
		try {
			const bridge = getAndroidBridge();
			if (bridge?.checkMicrophonePermission) {
				// Only here to trigger the WebView's permission prompt — stop the
				// stream right away, otherwise it keeps the mic open for the rest
				// of the session.
				navigator.mediaDevices
					.getUserMedia({ audio: true })
					.then((stream) => stream.getTracks().forEach((t) => t.stop()))
					.catch(() => {});
				const granted = await pollBridgePermission(() => bridge.checkMicrophonePermission!());
				setMicrophoneStatus(granted ? "granted" : "denied");
				setMicrophoneDetail(null);
			} else {
				const stream = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true }));
				stream.getTracks().forEach((t) => t.stop());
				setMicrophoneStatus("granted");
				setMicrophoneDetail(null);
			}
		} catch (error) {
			appLog.warn("[Onboarding] Failed to request microphone permission", error);
			const { status, detail } = classifyMediaError(error, "microphone");
			setMicrophoneStatus(status);
			setMicrophoneDetail(detail);
		} finally {
			setIsRequesting(false);
		}
	};

	const requestCamera = async () => {
		setIsRequesting(true);
		try {
			const bridge = getAndroidBridge();
			if (bridge?.checkCameraPermission) {
				// Same as the mic above: a leftover stream would keep the camera
				// busy, and Android then fails the video call's own capture.
				navigator.mediaDevices
					.getUserMedia({ video: true })
					.then((stream) => stream.getTracks().forEach((t) => t.stop()))
					.catch(() => {});
				const granted = await pollBridgePermission(() => bridge.checkCameraPermission!());
				setCameraStatus(granted ? "granted" : "denied");
				setCameraDetail(null);
			} else {
				const stream = await withTimeout(navigator.mediaDevices.getUserMedia({ video: true }));
				stream.getTracks().forEach((t) => t.stop());
				setCameraStatus("granted");
				setCameraDetail(null);
			}
		} catch (error) {
			appLog.warn("[Onboarding] Failed to request camera permission", error);
			const { status, detail } = classifyMediaError(error, "camera");
			setCameraStatus(status);
			setCameraDetail(detail);
		} finally {
			setIsRequesting(false);
		}
	};

	const handleDone = () => {
		markOnboardingComplete();
		onComplete();
	};

	// ── Loading ──────────────────────────────────────────────────────────────
	if (step === "loading") return <LoadingScreen />;

	// ── Welcome ──────────────────────────────────────────────────────────────
	if (step === "welcome") {
		return (
			<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
				<div className="fs-card-inner fs-card-lg flex flex-col" {...swipe}>
					<div
						key={step} className={`flex flex-1 flex-col items-center justify-center px-8 text-center ${pageClass}`}
						style={{
							paddingTop: "max(48px, env(safe-area-inset-top))",
							paddingBottom: "max(48px, calc(env(safe-area-inset-bottom) + 80px))",
						}}
					>
						<img src={logo} alt="" className="mb-6 h-16 w-16 rounded-2xl object-cover" />
						<h1 className="text-2xl font-bold text-[var(--text)]">Let's get you set up</h1>
						<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
							Just a few quick steps to get the most out of Free Grind.
						</p>
					</div>

					<div
						className="flex h-28 shrink-0 flex-col justify-end gap-2 px-6"
						style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
					>
						<button
							type="button"
							onClick={advance}
							className={fullscreenPrimaryButtonClass}
						>
							Get Started
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		);
	}

	// ── Theme ────────────────────────────────────────────────────────────────
	if (step === "theme") {
		// AMOLED isn't a color scheme of its own: it's dark plus the pure-black flag.
		const options: { key: string; value: ColorScheme; amoled: boolean; label: string; sub: string }[] = [
			{ key: "system", value: "system", amoled: false, label: "System", sub: "Follows your device" },
			{ key: "light",  value: "light",  amoled: false, label: "Light",  sub: "Always light" },
			{ key: "dark",   value: "dark",   amoled: false, label: "Dark",   sub: "Always dark" },
			{ key: "amoled", value: "dark",   amoled: true,  label: "AMOLED", sub: "Pure black for OLED screens" },
		];
		return (
			<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
				<div className="fs-card-inner fs-card-lg flex flex-col" {...swipe}>
					<TopDots current="theme" />

					<div key={step} className={`flex flex-1 flex-col justify-center px-6 ${pageClass}`}>
						<div className="mb-7 text-center">
							<h2 className="text-xl font-bold text-[var(--text)]">Choose Your Theme</h2>
							<p className="mt-1 text-sm text-[var(--text-muted)]">You can change this anytime in Settings.</p>
						</div>

						{/* One group of tiles, like the settings lists; each option shows the
						    same mini app preview as the color scheme picker in Settings. */}
						<div className="native-group">
							{options.map(({ key, value, amoled, label, sub }) => {
								const active = colorScheme === value && (value !== "dark" || amoledMode === amoled);
								return (
									<button
										key={key}
										type="button"
										onClick={() => setPreferences({ colorScheme: value, amoledMode: amoled })}
										aria-pressed={active}
										className={`flex items-center gap-4 px-4 py-3.5 text-left transition-[transform,background-color] duration-150 active:scale-[0.99] ${active ? "accent-tint-14" : "hover-fill"}`}
									>
										<SchemePreview scheme={value} amoled={amoled} className="w-16 shrink-0 rounded-lg" />

										<div className="flex-1">
											<p className="text-sm font-semibold text-[var(--text)]">{label}</p>
											<p className="text-xs text-[var(--text-muted)]">{sub}</p>
										</div>

										<div
											className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all"
											style={{
												borderColor: active ? "var(--accent)" : "color-mix(in srgb, var(--text) 25%, transparent)",
												background: active ? "var(--accent)" : "transparent",
											}}
										>
											{active && <Check className="h-3 w-3 text-[var(--accent-contrast)]" />}
										</div>
									</button>
								);
							})}
						</div>
					</div>

					<div
						className="flex h-28 shrink-0 flex-col justify-end gap-2 px-6"
						style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
					>
						<button
							type="button"
							onClick={advance}
							className={fullscreenPrimaryButtonClass}
						>
							Continue
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		);
	}

	// ── Accent Color ─────────────────────────────────────────────────────────
	if (step === "accent") {
		return (
			<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
				<div className="fs-card-inner fs-card-lg flex flex-col" {...swipe}>
					<TopDots current="accent" />

					<div key={step} className={`flex flex-1 flex-col justify-center px-6 ${pageClass}`}>
						<div className="mb-7 text-center">
							<h2 className="text-xl font-bold text-[var(--text)]">Pick Your Color</h2>
							<p className="mt-1 text-sm text-[var(--text-muted)]">You can change this anytime in Settings.</p>
						</div>

						{/* Same tiles as the accent picker in Settings: a color block with its
						    name, the active one ringed in the accent. Same height as the theme
						    step's option rows, so the title doesn't jump between the steps.
						    A native-group laid out as a grid: its tiles get the same fill as
						    the theme step's, raised on the desktop card too; rounded-2xl
						    overrides the group's stacked-list corners. */}
						<div className="native-group grid h-[358px] w-full grid-cols-4 content-center gap-2">
							{ACCENT_PRESETS.map((preset) => {
								const active = accentColor === preset.color;
								return (
									<button
										key={preset.color}
										type="button"
										onClick={() => setPreferences({ accentColor: preset.color, accentContrast: preset.contrast })}
										aria-pressed={active}
										className={`flex flex-col gap-1.5 !rounded-2xl p-1.5 pb-2 transition-[transform,background-color] duration-150 active:scale-[0.98] ${active ? "accent-tint-15 ring-2 ring-inset ring-[var(--accent)]" : "hover:accent-tint-10"}`}
									>
										<span className="aspect-[4/3] w-full rounded-xl" style={{ background: preset.color }} />
										<span className={`truncate text-center text-xs font-medium ${active ? "text-[var(--accent-readable)]" : "text-[var(--text)]"}`}>{preset.name}</span>
									</button>
								);
							})}
						</div>
					</div>

					<div
						className="flex h-28 shrink-0 flex-col justify-end gap-2 px-6"
						style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
					>
						<button
							type="button"
							onClick={advance}
							className={fullscreenPrimaryButtonClass}
						>
							Continue
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		);
	}

	// ── Automatic Updates ────────────────────────────────────────────────────
	if (step === "updates") {
		const choose = (enabled: boolean) => {
			setHotswapAutoUpdateEnabled(enabled);
			setUpdatesStatus(enabled ? "granted" : "denied");
		};
		const settled = updatesStatus !== "idle";
		return (
			<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
				<div className="fs-card-inner fs-card-lg flex flex-col" {...swipe}>
					<TopDots current="updates" />

					<div key={step} className={`flex flex-1 flex-col items-center justify-center px-8 text-center ${pageClass}`}>
						<div className="relative mb-6">
							<div className={fullscreenIconTileClass}>
								<RefreshCcw className="h-9 w-9" />
							</div>
							<div className="absolute -right-2 -top-2">
								<StatusBadge status={updatesStatus} />
							</div>
						</div>
						<h2 className="text-xl font-bold text-[var(--text)]">Automatic Updates</h2>
						<div className="flex min-h-24 flex-col items-center">
							<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
								Automatically downloads the newest app interface built by GitHub Actions and reloads as soon as it's available. Only updates signed with our key are installed. When off, you'll be asked before each update.
							</p>
							<button
								type="button"
								onClick={() => void openExternalUrl(GITHUB_OTA_SIGNING_URL)}
								className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
							>
								More about that
								<ExternalLink className="h-3 w-3" />
							</button>
							{updatesStatus === "denied" && (
								<p className="mt-2 text-xs text-[var(--text-muted)]">
									You can turn this on in Settings later.
								</p>
							)}
						</div>
					</div>

					<div
						className="flex h-44 shrink-0 flex-col justify-end gap-2 px-6"
						style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
					>
						{settled ? (
							<button
								type="button"
								onClick={advance}
								className={fullscreenPrimaryButtonClass}
							>
								Continue
								<ChevronRight className="h-4 w-4" />
							</button>
						) : (
							<>
								<button
									type="button"
									onClick={() => choose(true)}
									className={fullscreenPrimaryButtonClass}
								>
									Turn On
								</button>
								<button
									type="button"
									onClick={() => choose(false)}
									className={fullscreenSecondaryButtonClass}
								>
									Ask me each time
								</button>
							</>
						)}
					</div>
				</div>
			</div>
		);
	}

	// ── Scam Warning ──────────────────────────────────────────────────────────
	if (step === "scam") {
		return (
			<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
				<div className="fs-card-inner fs-card-lg flex flex-col" {...swipe}>
					<TopDots current="scam" />

					<div key={step} className={`flex flex-1 flex-col items-center justify-center px-8 text-center ${pageClass}`}>
						<div className="mb-6 flex h-20 w-20 shrink-0 items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-xl shadow-amber-500/25">
							<AlertTriangle className="h-9 w-9" />
						</div>
						<h2 className="text-xl font-bold text-[var(--text)]">Caution</h2>
						<div className="flex min-h-24 flex-col items-center">
							<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
								Free Grind is free — and always will be. If someone sold you access or is asking you to pay, it's a scam. Don't pay, and report it.
							</p>
						</div>
					</div>

					<div
						className="flex h-44 shrink-0 flex-col justify-end gap-2 px-6"
						style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
					>
						<button
							type="button"
							onClick={handleDone}
							className={fullscreenPrimaryButtonClass}
						>
							Got it
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		);
	}

	// ── Permission steps ───────────────────────────────────────────────────────
	const permConfig = {
		notifications: {
			icon: Bell,
			title: "Notifications",
			description: "Stay up to date with new messages, taps, and activity from people nearby.",
			status: notificationStatus,
			onRequest: requestNotifications,
		},
		location: {
			icon: MapPin,
			title: "Location",
			description: "Discover people near you and appear on the map for others to find you.",
			status: locationStatus,
			onRequest: requestLocation,
		},
		microphone: {
			icon: Mic,
			title: "Microphone",
			description: "Record and send voice messages in conversations.",
			status: microphoneStatus,
			detail: microphoneDetail,
			onRequest: requestMicrophone,
		},
		camera: {
			icon: Camera,
			title: "Camera",
			description: "Take photos and videos to share, and use video calls.",
			status: cameraStatus,
			detail: cameraDetail,
			onRequest: requestCamera,
		},
	} as const;

	const cfg = permConfig[step as PermStep];
	const Icon = cfg.icon;
	const status = cfg.status;
	const settled = status !== "idle";
	const detail = "detail" in cfg ? cfg.detail : null;

	return (
		<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
			<div className="fs-card-inner fs-card-lg flex flex-col" {...swipe}>
				<TopDots current={step} />

				<div key={step} className={`flex flex-1 flex-col items-center justify-center px-8 text-center ${pageClass}`}>
					<div className="relative mb-6">
						<div className={fullscreenIconTileClass}>
							<Icon className="h-9 w-9" />
						</div>
						<div className="absolute -right-2 -top-2">
							<StatusBadge status={status} isRequesting={isRequesting} />
						</div>
					</div>

					<h2 className="text-xl font-bold text-[var(--text)]">{cfg.title}</h2>
					<div className="flex min-h-24 flex-col items-center">
						<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
							{cfg.description}
						</p>

						{(status === "denied" || status === "unavailable") && detail && (
							<p className="mt-3 text-xs text-[var(--text-muted)]">{detail}</p>
						)}

						{(status === "denied" || status === "unavailable") && (
							<p className="mt-2 text-xs text-[var(--text-muted)]">
								You can enable this in Settings later.
							</p>
						)}
					</div>
				</div>

				<div
					className="flex h-44 shrink-0 flex-col justify-end gap-2 px-6"
					style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
				>
					<button
						type="button"
						onClick={settled ? advance : cfg.onRequest}
						disabled={isRequesting}
						className={fullscreenPrimaryButtonClass}
					>
						{settled ? (
							<>Continue <ChevronRight className="h-4 w-4" /></>
						) : isRequesting ? (
							<><Loader2 className="h-4 w-4 animate-spin" /> Requesting…</>
						) : (
							<>Allow {cfg.title}</>
						)}
					</button>
					{!settled && (
						<button
							type="button"
							onClick={advance}
							className={fullscreenSecondaryButtonClass}
						>
							Skip for now
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
