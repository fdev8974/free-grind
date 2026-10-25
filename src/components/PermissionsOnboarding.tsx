import { AlertTriangle, Bell, Camera, Check, ChevronRight, Loader2, MapPin, Mic, Monitor, Moon, RefreshCcw, Sun, X } from "lucide-react";
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
import { isHotswapAvailable, setHotswapAutoUpdateEnabled } from "../services/hotswap";
import { usePreferences, ACCENT_PRESETS } from "../contexts/PreferencesContext";
import type { ColorScheme } from "../contexts/PreferencesContext";
import { LoadingScreen } from "./LoadingScreen";
import logo from "../images/freegrind-logo.webp";
import { fullscreenIconTileClass, fullscreenPrimaryButtonClass, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";

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

	const [notificationStatus, setNotificationStatus] = useState<PermissionStatus>("idle");
	const [locationStatus, setLocationStatus] = useState<PermissionStatus>("idle");
	const [microphoneStatus, setMicrophoneStatus] = useState<PermissionStatus>("idle");
	const [microphoneDetail, setMicrophoneDetail] = useState<string | null>(null);
	const [cameraStatus, setCameraStatus] = useState<PermissionStatus>("idle");
	const [cameraDetail, setCameraDetail] = useState<string | null>(null);

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

	const advance = () => {
		const idx = STEP_ORDER.indexOf(step);
		if (idx !== -1 && idx < STEP_ORDER.length - 1) {
			setStep(STEP_ORDER[idx + 1]);
		}
	};

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
				navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
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
				navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {});
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
				<div className="fs-card-inner fs-card-lg flex flex-col">
					<div
						className="flex flex-1 flex-col items-center justify-center px-8 text-center"
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
		const options: { key: string; value: ColorScheme; amoled: boolean; label: string; sub: string; icon: typeof Sun; previewBg: string; previewFg: string }[] = [
			{ key: "system", value: "system", amoled: false, label: "System", sub: "Follows your device", icon: Monitor, previewBg: "linear-gradient(135deg, #eceff4 50%, #1f2835 50%)", previewFg: "#96a2b6" },
			{ key: "light",  value: "light",  amoled: false, label: "Light",  sub: "Always light",        icon: Sun,     previewBg: "#eceff4",  previewFg: "#6d28d9" },
			{ key: "dark",   value: "dark",   amoled: false, label: "Dark",   sub: "Always dark",         icon: Moon,    previewBg: "#1f2835",  previewFg: "#96a2b6" },
			{ key: "amoled", value: "dark",   amoled: true,  label: "AMOLED", sub: "Pure black for OLED screens", icon: Moon, previewBg: "#000000", previewFg: "#96a2b6" },
		];
		return (
			<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
				<div className="fs-card-inner fs-card-lg flex flex-col">
					<TopDots current="theme" />

					<div className="flex flex-1 flex-col justify-center px-6">
						<div className="mb-7 text-center">
							<h2 className="text-xl font-bold text-[var(--text)]">Choose Your Theme</h2>
							<p className="mt-1 text-sm text-[var(--text-muted)]">You can change this anytime in Settings.</p>
						</div>

						<div className="flex flex-col gap-2.5">
							{options.map(({ key, value, amoled, label, sub, icon: Icon, previewBg, previewFg }) => {
								const active = colorScheme === value && (value !== "dark" || amoledMode === amoled);
								return (
									<button
										key={key}
										type="button"
										onClick={() => setPreferences({ colorScheme: value, amoledMode: amoled })}
										className={`flex items-center gap-4 rounded-2xl p-4 text-left transition-[transform,background-color] duration-150 active:scale-[0.99] ${active ? "accent-tint-18" : "ink-tint-12 hover:ink-tint-16"}`}
									>
										<div
											className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
											// Inset hairline so the black AMOLED swatch doesn't vanish on a black page.
											style={{ background: previewBg, boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--text) 14%, transparent)" }}
										>
											<Icon className="h-5 w-5" style={{ color: previewFg }} />
										</div>

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
				<div className="fs-card-inner fs-card-lg flex flex-col">
					<TopDots current="accent" />

					<div className="flex flex-1 flex-col justify-center px-6">
						<div className="mb-7 text-center">
							<h2 className="text-xl font-bold text-[var(--text)]">Pick Your Color</h2>
							<p className="mt-1 text-sm text-[var(--text-muted)]">You can change this anytime in Settings.</p>
						</div>

						{/* Same height as the theme step's four option rows, so the
						    title doesn't jump between the two steps. */}
						<div className="mx-auto grid h-[358px] grid-cols-4 content-start gap-4 pt-16">
							{ACCENT_PRESETS.map((preset) => {
								const active = accentColor === preset.color;
								return (
									<button
										key={preset.color}
										type="button"
										onClick={() => setPreferences({ accentColor: preset.color, accentContrast: preset.contrast })}
										title={preset.name}
										aria-label={preset.name}
										className="flex h-14 w-14 items-center justify-center rounded-full transition-transform active:scale-95"
										style={{
											background: preset.color,
											outline: active ? `2.5px solid ${preset.color}` : "none",
											outlineOffset: "3px",
										}}
									>
										{active && <Check className="h-5 w-5" style={{ color: preset.contrast }} />}
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
			advance();
		};
		return (
			<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
				<div className="fs-card-inner fs-card-lg flex flex-col">
					<TopDots current="updates" />

					<div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
						<div className={`mb-6 ${fullscreenIconTileClass}`}>
							<RefreshCcw className="h-9 w-9" />
						</div>
						<h2 className="text-xl font-bold text-[var(--text)]">Automatic Updates</h2>
						<div className="flex h-24 flex-col items-center overflow-hidden">
							<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
								Automatically downloads the newest app interface from GitHub Actions and reloads as soon as it's available. When off, you'll be asked before each update.
							</p>
						</div>
					</div>

					<div
						className="flex h-44 shrink-0 flex-col justify-end gap-2 px-6"
						style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
					>
						<button
							type="button"
							onClick={() => choose(true)}
							className={fullscreenPrimaryButtonClass}
						>
							Turn On
							<ChevronRight className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => choose(false)}
							className={fullscreenSecondaryButtonClass}
						>
							Ask me each time
						</button>
					</div>
				</div>
			</div>
		);
	}

	// ── Scam Warning ──────────────────────────────────────────────────────────
	if (step === "scam") {
		return (
			<div className="fs-card-outer fs-card-overlay z-[300] no-touch-callout">
				<div className="fs-card-inner fs-card-lg flex flex-col">
					<TopDots current="scam" />

					<div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
						<div className="mb-6 flex h-20 w-20 shrink-0 items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-xl shadow-amber-500/25">
							<AlertTriangle className="h-9 w-9" />
						</div>
						<h2 className="text-xl font-bold text-[var(--text)]">Caution</h2>
						<div className="flex h-24 flex-col items-center overflow-hidden">
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
			<div className="fs-card-inner fs-card-lg flex flex-col">
				<TopDots current={step} />

				<div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
					<div className="relative mb-6">
						<div className={fullscreenIconTileClass}>
							<Icon className="h-9 w-9" />
						</div>
						<div className="absolute -right-2 -top-2">
							<StatusBadge status={status} isRequesting={isRequesting} />
						</div>
					</div>

					<h2 className="text-xl font-bold text-[var(--text)]">{cfg.title}</h2>
					<div className="flex h-24 flex-col items-center overflow-hidden">
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
