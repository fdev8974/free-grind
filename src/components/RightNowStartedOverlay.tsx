import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { haptic } from "../utils/haptics";
import { RightNowIcon } from "./icons/RightNowIcon";

// Short celebration after starting a Right Now session — same build as
// SinModeUnlockOverlay (rays, halo, popping icon), in Right Now purple.
const AUTO_DISMISS_MS = 2800;
const CLOSE_ANIMATION_MS = 280;

type Listener = () => void;
const listeners = new Set<Listener>();

/** Shows the full-screen "session started" overlay (mounted once in App). */
export function triggerRightNowStarted(): void {
	for (const listener of listeners) {
		listener();
	}
}

export function RightNowStartedOverlay() {
	const { t } = useTranslation();
	const [visible, setVisible] = useState(false);
	const [closing, setClosing] = useState(false);

	useEffect(() => {
		const listener = () => {
			setClosing(false);
			setVisible(true);
			haptic(30);
		};
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}, []);

	useEffect(() => {
		if (!visible || closing) return;
		const timer = setTimeout(() => setClosing(true), AUTO_DISMISS_MS);
		return () => clearTimeout(timer);
	}, [visible, closing]);

	useEffect(() => {
		if (!closing) return;
		const timer = setTimeout(() => setVisible(false), CLOSE_ANIMATION_MS);
		return () => clearTimeout(timer);
	}, [closing]);

	if (!visible) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
			style={{ animation: closing ? "backdrop-out 0.28s ease-in forwards" : "backdrop-in 0.3s ease-out forwards" }}
			onClick={() => setClosing(true)}
			role="dialog"
			aria-label={t("right_now.started_overlay_subtitle", { defaultValue: "Session started" })}
		>
			<div className="right-now-started-backdrop absolute inset-0" />
			<div className="right-now-started-rays absolute h-[220vmax] w-[220vmax] animate-sin-mode-rays motion-reduce:animate-none" />

			<div
				className="relative flex flex-col items-center gap-4 px-8 text-center"
				style={{ animation: closing ? "modal-out 0.22s ease-in forwards" : undefined }}
			>
				<div className="relative flex h-36 w-36 items-center justify-center">
					<div className="right-now-started-halo absolute inset-0 rounded-full animate-sin-mode-shimmer motion-reduce:animate-none" />
					<span className="relative flex h-24 w-24 animate-sin-mode-in items-center justify-center rounded-full bg-[var(--right-now)] text-white shadow-[0_0_40px_var(--right-now)]">
						<RightNowIcon className="h-12 w-12" />
					</span>
				</div>

				<h1 className="right-now-started-title animate-sin-mode-title-in text-4xl font-black uppercase tracking-widest text-[color-mix(in_srgb,var(--right-now)_55%,white)] sm:text-5xl">
					{t("right_now.title")}
				</h1>
				<p className="animate-sin-mode-title-in text-sm font-semibold uppercase tracking-[0.3em] text-white/80">
					{t("right_now.started_overlay_subtitle", { defaultValue: "Session started" })}
				</p>
				<p className="animate-sin-mode-title-in mt-2 max-w-xs text-sm text-white/60">
					{t("right_now.started_overlay_tagline", { defaultValue: "You're out there now. Ready, willing and close by." })}
				</p>
			</div>
		</div>,
		document.body,
	);
}
