import { Loader2, Lock, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RightNowIcon } from "../../../components/icons/RightNowIcon";
import { ActionPill } from "../../../components/ui/action-pill";
import type { RightNowFABPhase } from "./RightNowPostFAB";
import { getRightNowSessionDuration } from "./rightnow-constants";

interface RightNowPostPillProps {
	onClick: () => void;
	phase: RightNowFABPhase;
	onPhaseChange: (phase: RightNowFABPhase) => void;
	isEditMode: boolean;
	expiresAt: number | null;
	rightNowRemaining: number;
	isTestMode: boolean;
}

/** Same duration as RightNowPostFAB's ring fill after posting. */
const LOADING_MS = 2500;

function formatRemaining(ms: number): string {
	const totalSec = Math.ceil(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	const pad = (n: number) => n.toString().padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Desktop variant of RightNowPostFAB: a labelled pill whose fill drains as the
 * session runs out. Drives the same phase changes the FAB's animation loop does
 * (loading → countdown after posting, countdown → idle once expired). */
export function RightNowPostPill({
	onClick,
	phase,
	onPhaseChange,
	isEditMode,
	expiresAt,
	rightNowRemaining,
	isTestMode,
}: RightNowPostPillProps) {
	const { t } = useTranslation();
	const [now, setNow] = useState(() => Date.now());
	const countdownStartRef = useRef<number | null>(null);
	const duration = getRightNowSessionDuration(isTestMode);

	useEffect(() => {
		if (phase === "loading") {
			const timer = setTimeout(() => onPhaseChange("countdown"), LOADING_MS);
			return () => clearTimeout(timer);
		}
		if (phase === "countdown") {
			countdownStartRef.current = Date.now();
			setNow(Date.now());
			const interval = setInterval(() => setNow(Date.now()), 1000);
			return () => clearInterval(interval);
		}
		countdownStartRef.current = null;
	}, [phase, onPhaseChange]);

	const remainingMs =
		phase !== "countdown"
			? 0
			: expiresAt
				? Math.max(0, expiresAt - now)
				: Math.max(0, duration - (now - (countdownStartRef.current ?? now)));

	useEffect(() => {
		if (phase === "countdown" && remainingMs <= 0) onPhaseChange("idle");
	}, [phase, remainingMs, onPhaseChange]);

	if (phase === "loading") {
		return (
			<ActionPill
				icon={<Loader2 className="animate-spin" />}
				label={t("right_now.starting_session")}
				onClick={onClick}
				disabled
				color="var(--right-now)"
				textColor="white"
			/>
		);
	}
	if (isEditMode || phase === "countdown") {
		return (
			<ActionPill
				icon={<Pencil />}
				label={t("right_now.edit_session_title")}
				trailing={phase === "countdown" ? formatRemaining(remainingMs) : undefined}
				progress={phase === "countdown" ? Math.min(1, remainingMs / duration) : undefined}
				onClick={onClick}
				color="var(--right-now)"
				textColor="white"
			/>
		);
	}
	return (
		<ActionPill
			// Same icon and label as the post sheet's start button.
			icon={rightNowRemaining === 0 ? <Lock /> : <RightNowIcon />}
			label={rightNowRemaining === 0 ? t("right_now.limit_reached_title") : t("right_now.start_now")}
			onClick={onClick}
			color="var(--right-now)"
			textColor="white"
		/>
	);
}
