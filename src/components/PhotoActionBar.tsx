import { useEffect, useRef, useState } from "react";
import { Flame, Loader2 } from "lucide-react";
import { SendHorizontalFilled } from "./icons/FilledIcons";
import { useTranslation } from "react-i18next";
import { TapFlyBurst, TAP_FLY_BURST_MS, createTapFlyBurst, type TapFlyBurstState } from "./TapFlyBurst";
import { haptic } from "../utils/haptics";

type PhotoActionBarProps = {
	onSendText: (text: string) => void | Promise<void>;
	/** Omit to hide the reaction button entirely (e.g. profile photo replies, which have no reaction). */
	onReact?: () => void | Promise<void>;
	placeholder?: string;
};

/**
 * Bottom bar for replying to (or 🔥-reacting to) a specific photo shown in
 * PhotoViewer — mirrors the floating "quick message + tap" footer in
 * ProfileDetailsModal, but scoped to a single reaction (no emoji picker,
 * since album-photo reactions only ever imply 🔥). Built like the chat
 * composer: a floating pill with the send button inside, the reaction beside it.
 */
export function PhotoActionBar({ onSendText, onReact, placeholder }: PhotoActionBarProps) {
	const { t } = useTranslation();
	const [text, setText] = useState("");
	const [isSending, setIsSending] = useState(false);
	const [isReacting, setIsReacting] = useState(false);
	const [burst, setBurst] = useState<TapFlyBurstState | null>(null);
	const reactButtonRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (!burst) return;
		const timer = setTimeout(() => setBurst(null), TAP_FLY_BURST_MS);
		return () => clearTimeout(timer);
	}, [burst]);

	const handleSend = async () => {
		const trimmed = text.trim();
		if (!trimmed || isSending) return;
		setIsSending(true);
		try {
			await onSendText(trimmed);
			setText("");
		} finally {
			setIsSending(false);
		}
	};

	const handleReact = async () => {
		if (!onReact || isReacting) return;
		// Same send effect as a profile tap: the flame flies up and bursts.
		haptic(30, [15, 10, 25]);
		setBurst(createTapFlyBurst(1, reactButtonRef.current));
		setIsReacting(true);
		try {
			await onReact();
		} finally {
			setIsReacting(false);
		}
	};

	const hasText = text.trim().length > 0;

	return (
		<div
			className="px-3"
			style={{
				paddingTop: "3.5rem",
				paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 1rem)",
				background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)",
			}}
		>
			<div
				className="mx-auto flex w-full max-w-lg items-center gap-1"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Like the chat composer: the field floats as a frosted pill with
				    the send button inside it; the tap/reaction sits next to it. */}
				<div className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] py-1 pl-1 pr-1 shadow-[0_2px_6px_rgba(0,0,0,0.18),0_8px_28px_rgba(0,0,0,0.32)] ring-1 ring-[var(--border)]/50 backdrop-blur-xl focus-within:ring-2 focus-within:ring-[var(--accent)]">
					<input
						type="text"
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								void handleSend();
							}
						}}
						// readOnly, not disabled: disabling would blur it and drop the keyboard.
						readOnly={isSending}
						enterKeyHint="send"
						placeholder={placeholder ?? t("photo_viewer.reply_placeholder", { defaultValue: "Reply…" })}
						className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[15px] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none read-only:opacity-50"
					/>
					<button
						type="button"
						onClick={() => void handleSend()}
						// Keeps the input focused, so the keyboard stays up after sending.
						onMouseDown={(e) => e.preventDefault()}
						disabled={isSending || !hasText}
						aria-label={t("photo_viewer.send", { defaultValue: "Send" })}
						// Same round accent button as the chat composer's send.
						className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] transition active:scale-90 disabled:opacity-30"
					>
						{isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontalFilled className="h-5 w-5" />}
					</button>
				</div>
				{onReact && (
					<button
						ref={reactButtonRef}
						type="button"
						onClick={() => void handleReact()}
						disabled={isReacting}
						aria-label={t("photo_viewer.react", { defaultValue: "React" })}
						// bar-icon-btn: the same desktop hover circle as the profile footer's tap button.
						className="bar-icon-btn inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:text-white active:scale-90 disabled:opacity-50"
					>
						{isReacting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Flame className="h-5 w-5" strokeWidth={1.8} />}
					</button>
				)}
			</div>
			{burst && <TapFlyBurst burst={burst} />}
		</div>
	);
}
