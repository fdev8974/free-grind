import { MapPinFilled } from "../../../components/icons/FilledIcons";
import { Album, Ban, Copy, Download, Eye, History, Hourglass, ImagePlay, Images, Languages, Loader2, Lock, MessageCircleQuestion, MessageSquarePlus, Mic, MoreVertical, PhoneOff, Play, Repeat2, Reply, ShieldCheck, Trash2, Undo2, Video, VideoOff, ImageOff } from "lucide-react";
import { TakenOnGrindrBadge } from "./TakenOnGrindrBadge";
import { createPortal } from "react-dom";
import { MapLocationPreview } from "../gridpage/components/MapLocationPreview";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { PromptDialog } from "../../../components/ui/prompt-dialog";
import { AudioMessagePlayer } from "./AudioMessagePlayer";
import { openUrl } from "@tauri-apps/plugin-opener";
import React, { Fragment, useEffect, useState, useMemo, useCallback, useRef, useLayoutEffect } from "react";

import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { appLog } from "../../../utils/logger";
import { isIos, saveMediaToDevice } from "../../../services/saveMedia";
import { loadSavedPhrases, saveSavedPhrases } from "../../../services/savedPhrases";
import type { ConversationEntry, Message } from "../../../types/messages";
import type { AlbumMediaCount, UiMessage } from "../../../types/chat-page";
import { useLocalMediaCache } from "../../../hooks/useLocalMediaCache";
import { getCachedMediaUri, getMessageFallbackMediaKey } from "../../../services/mediaStore";
import { useAlbumCache } from "../../../hooks/useAlbumCache";
import {
    ensureAlbumCacheChecked,
    getCachedAlbumCoverUri,
    getCachedAlbumMediaCount,
    getCachedAlbumName,
    getCachedAlbumContentThumbUri,
    isAlbumCachedLocally,
    isAlbumKnownRevoked,
} from "../../../services/albumStore";
import { useAvatarCache } from "../../../hooks/useAvatarCache";
import { getProfileImageUrl, getThumbImageUrl } from "../../../utils/media";
import { ProfileImage } from "../../../components/ui/profile-image";
import { PRIVACY_BLUR_TRANSITION_CLASS, useMediaBlur } from "../../../hooks/useProfilePhotoPrivacy";
import { getForbiddenWords, setForbiddenWords } from "../../../utils/autoblock";
import {
	SKIP_LINK_OPEN_CONFIRM_KEY,
	isLinkOpenConfirmSkipped,
} from "../../../utils/blockConfirm";
import { formatRelativeTime } from "../../../utils/relativeTime";
import {
	formatDateHeader,
	formatDateTime24,
	formatFullDateTime,
	formatMessageTime,
	formatTakenOnGrindrTime,
	getMessageAlbumCoverUrl,
	getMessageAlbumId,
	getMessageAudioUrl,
	getMediaCaptureTarget,
	getReplyImageHashTarget,
	getAlbumContentReplyTarget,
	getMessageImageCreatedAt,
	getGaymojiUrl,
	getMessageImageUrl,
	getMessageLocation,
	getMessageTakenOnGrindr,
	getMessageText,
	getMessageVideoUrl,
	getVideoCallStatusLabel,
	isLocalClientMessageId,
	MAX_VIDEO_VIEWS,
	stripReplyQuotePrefix,
} from "./chatUtils";
import type { MessageTranslations } from "../../../hooks/useMessageTranslations";
import { haptic } from "../../../utils/haptics";
import { menuTransitionStyle, usePresence } from "../../../hooks/usePresence";
import { proxyMediaUrl } from "../../../utils/mediaProxy";
import { getHeroRectFromElement, type HeroRect } from "../../../components/PhotoViewer";

type ChatThreadMessagesProps = {
	isDesktop: boolean;
	/** Space covered by a floating composer at the bottom (mobile). */
	bottomInset?: number;
	/** Space covered by a floating header at the top (mobile). */
	topInset?: number;
	selectedConversation: ConversationEntry;
	userId: number | null;
	nowTimestamp: number;
	messagePageKey: string | null;
	isLoadingOlderMessages: boolean;
	loadThread: (args: { conversationId: string; older: boolean }) => void | Promise<void>;
	threadScrollContainerRef: { current: HTMLDivElement | null };
	handleThreadScroll: (event: React.UIEvent<HTMLDivElement>) => void;
	threadMessages: UiMessage[];
	threadLastReadTimestamp: number | null;
	messageElementRefs: { current: Map<string, HTMLDivElement> };
	handleMessageTap: (message: Message) => void | Promise<void>;
	startMessageLongPress: (messageId: string) => void;
	endMessageLongPress: () => void;
	messageLongPressTriggeredRef: { current: boolean };
	openFullScreenImage: (imageUrl: string, meta?: { takenOnGrindr: boolean; createdAt: number | null; createdAtLabel: string | null; timestamp: number }, mediaType?: "image" | "video", messageId?: string, senderId?: number, heroRect?: HeroRect | null) => void;
	openAlbumViewerById: (albumId: number, isOwnAlbum?: boolean, targetContentId?: number) => void | Promise<void>;
	openProfilePhotos: (mediaHash: string, isPartnerProfile: boolean, heroRect?: HeroRect | null) => void;
	onJumpToMessage: (messageId: string) => void;
	highlightedMessageId: string | null;
	selectedThreadMessageMatches: Array<{ messageId: string }>;
	activeThreadSearchIndex: number;
	openMessageActionId: string | null;
	setOpenMessageActionId: (value: ((current: string | null) => string | null) | string | null) => void;
	isMutatingMessageId: string | null;
	reactionBurstMessageId: string | null;
	handleReact: (message: Message) => void | Promise<void>;
	handleUnsend: (message: Message) => void | Promise<void>;
	handleDelete: (message: Message) => void | Promise<void>;
	handleRetry: (message: Message) => void;
	handleReply: (message: Message) => void | Promise<void>;
	canReply: boolean;
	handleStopAlbumShare: (albumId: number) => void | Promise<void>;
	handleRemoveLocalAlbum: (albumId: number) => void | Promise<void>;
	/** Image/video counts of the user's own albums (received ones come from albumStore). */
	ownAlbumMediaCountMap?: Map<number, AlbumMediaCount>;
	ownAlbumNameMap?: Map<number, string>;
	threadBottomRef: { current: HTMLDivElement | null };
	isPartnerTyping?: boolean;
	isArchived?: boolean;
	localNickname?: string | null;
	messageTranslations: MessageTranslations;
};

const KNOWN_REPLY_TYPES = new Set([
    "Image", "ExpiringImage", "Giphy", "Video", "PrivateVideo", "NonExpiringVideo",
    "Audio", "Location", "AlbumContentReply", "AlbumContentReaction",
    "Album", "ExpiringAlbum", "ExpiringAlbumV2", "ProfilePhotoReply", "Text", "Gaymoji",
]);

// Same flags that drive the "from local history" badge — a message that
// only exists locally (never confirmed on the server, or confirmed-gone) has
// nothing server-side for a reply to actually reference, so replying to it
// isn't offered.
const isLocalHistoryMessage = (message: UiMessage): boolean =>
    message._localOnly === true || message.localHistory === true;

const getReactionEmoji = (type: number): string => {
    switch (type) {
        case 0: return "👋";
        case 1: return "🔥";
        case 2: return "😈";
        default: return "🔥";
    }
};

// "Read 5 minutes ago" under the last own message; re-renders periodically so the relative time stays fresh.
function ReadStatusRelativeTime({ readAt, t }: { readAt: number; t: any }) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(timer);
	}, []);

	return <>{t("chat.read_relative", { time: formatRelativeTime(readAt, now), defaultValue: "Read {{time}}" })}</>;
}

/** Glass pill in a media bubble's top-left corner (Album, View once, Replay, GIF). */
// Media tile tap fallback (see mediaTapProps): what still counts as a tap,
// and how long to wait for the browser's own click before standing in for it.
const MEDIA_TAP_MAX_MS = 500;
const MEDIA_TAP_SLOP_PX = 10;
const MISSING_CLICK_WAIT_MS = 120;

function MediaBadge({ icon, label }: { icon: React.ReactNode; label: React.ReactNode }) {
	return (
		<div className="pointer-events-none absolute left-2 top-2 z-20 inline-flex items-center gap-1.5 rounded-full bg-black/50 py-1 pl-1.5 pr-2.5 text-[11px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur-md">
			{icon}
			{label}
		</div>
	);
}

function AlbumExpirationCountdown({ expiresAt, isOnce, t, className = "mt-1" }: { expiresAt: number; isOnce?: boolean; t: any; className?: string }) {
	const [timeLeft, setTimeLeft] = useState<number>(expiresAt - Date.now());

	useEffect(() => {
		if (isOnce) return;
		const timer = setInterval(() => {
			const next = expiresAt - Date.now();
			setTimeLeft(next);
			if (next <= 0) clearInterval(timer);
		}, 1000);
		return () => clearInterval(timer);
	}, [expiresAt, isOnce]);

	if (!isOnce && timeLeft <= 0) return null;

	const seconds = Math.floor((timeLeft / 1000) % 60);
	const minutes = Math.floor((timeLeft / (1000 * 60)) % 60);
	const hours = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
	const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));

	const parts = [];
	if (days > 0) parts.push(t("right_now.days_short", { count: days }));
	if (hours > 0 || days > 0) parts.push(t("right_now.hours_short", { count: hours }));
	if (minutes > 0 || hours > 0 || days > 0) parts.push(t("right_now.minutes_short", { count: minutes }));
	if (days === 0 && hours === 0) parts.push(t("right_now.seconds_short", { count: seconds }));

	return (
		<>
			<style>
				{`
					@keyframes hourglass-rotate {
						0% { transform: rotate(0deg); }
						40% { transform: rotate(180deg); }
						60% { transform: rotate(180deg); }
						100% { transform: rotate(360deg); }
					}
					.animate-hourglass-rotate {
						animation: hourglass-rotate 2.5s infinite ease-in-out;
					}
				`}
			</style>
			<div className={`flex items-center ${className}`}>
				<span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 py-1 pl-1.5 pr-2.5 text-[11px] font-semibold tracking-wide text-[var(--accent)] shadow-[0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur-md uppercase">
					<Hourglass className="h-3 w-3 animate-hourglass-rotate" />
					<span>
						{isOnce ? t("chat.expiration.once") : `${parts.join(" ")} ${t("chat.expiration.remaining")}`}
					</span>
				</span>
			</div>
		</>
	);
}

function renderTextWithLinks(
    text: string,
    mine: boolean,
    onLinkClick: (url: string) => void,
) {
    return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
            <a
                key={i}
                href="#"
                onClick={(e) => {
                    e.stopPropagation();
                    onLinkClick(part);
                }}
                className={`underline underline-offset-2 ${mine ? "text-[var(--accent-contrast)]/80 hover:text-[var(--accent-contrast)]" : "text-[var(--accent)] hover:opacity-80"}`}
            >
                {part}
            </a>
        ) : (
            <Fragment key={i}>{part}</Fragment>
        )
    );
}

type MessageContextMenuAction = {
	key: string;
	label: string;
	icon: React.ReactNode;
	onClick: () => void;
	danger?: boolean;
	disabled?: boolean;
	separatorBefore?: boolean;
};

// Same fixed+portal+viewport-clamp+outside-click pattern as
// ConversationContextMenu in ChatInboxPanel.tsx — portaled to <body> because
// the thread scroll container sits inside layout that can end up with a
// transformed ancestor, which would otherwise hijack `position: fixed`.
function MessageContextMenu({
	visible = true,
	x,
	y,
	actions,
	onClose,
}: {
	visible?: boolean;
	x: number;
	y: number;
	actions: MessageContextMenuAction[];
	onClose: () => void;
}) {
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState({ top: y, left: x });

	useLayoutEffect(() => {
		const menu = menuRef.current;
		if (!menu) return;
		const rect = menu.getBoundingClientRect();
		const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
		const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
		setPosition({ left: Math.min(x, maxLeft), top: Math.min(y, maxTop) });
	}, [x, y]);

	useEffect(() => {
		const handlePointerDown = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				onClose();
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("mousedown", handlePointerDown, true);
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("scroll", onClose, true);
		window.addEventListener("resize", onClose);
		return () => {
			window.removeEventListener("mousedown", handlePointerDown, true);
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("scroll", onClose, true);
			window.removeEventListener("resize", onClose);
		};
	}, [onClose]);

	return createPortal(
		<div
			ref={menuRef}
			style={{ top: position.top, left: position.left, ...menuTransitionStyle(visible, "top left") }}
			className="fixed z-[70] flex min-w-[200px] flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl"
		>
			{actions.map((action) => (
				<Fragment key={action.key}>
					{action.separatorBefore && <div className="-mx-2 mt-1 border-t border-[var(--border)] pt-1" />}
					<button
						type="button"
						disabled={action.disabled}
						onClick={() => {
							onClose();
							action.onClick();
						}}
						className={`flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition disabled:cursor-default disabled:opacity-50 ${
							action.danger
								? "text-red-500 hover:bg-red-500/10"
								: "text-[var(--text)] hover-fill"
						}`}
					>
						{action.icon}
						{action.label}
					</button>
				</Fragment>
			))}
		</div>,
		document.body,
	);
}

export function ChatThreadMessages({
	isDesktop,
	bottomInset = 0,
	topInset = 0,
	selectedConversation,
	userId,
	nowTimestamp,
	messagePageKey,
	isLoadingOlderMessages,
	loadThread,
	threadScrollContainerRef,
	handleThreadScroll,
	threadMessages,
	threadLastReadTimestamp,
	messageElementRefs,
	handleMessageTap,
	startMessageLongPress,
	endMessageLongPress,
	messageLongPressTriggeredRef,
	openFullScreenImage,
	openAlbumViewerById,
	openProfilePhotos,
	onJumpToMessage,
	highlightedMessageId,
	selectedThreadMessageMatches,
	activeThreadSearchIndex,
	isMutatingMessageId,
	reactionBurstMessageId,
	handleReact,
	handleUnsend,
	handleDelete,
	handleRetry,
	handleReply,
	canReply,
	handleStopAlbumShare,
	handleRemoveLocalAlbum,
	ownAlbumMediaCountMap,
	ownAlbumNameMap,
	threadBottomRef,
	isPartnerTyping = false,
	isArchived = false,
	localNickname = null,
	messageTranslations,
}: ChatThreadMessagesProps) {
	const { t } = useTranslation();
	useLocalMediaCache();
	useAlbumCache();
	useAvatarCache();
	const { chat: blurIncomingMedia } = useMediaBlur();
	const [revealedMediaMessageIds, setRevealedMediaMessageIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [hoveredMediaMessageId, setHoveredMediaMessageId] = useState<string | null>(null);
	const [contextMenuState, setContextMenuState] = useState<{ messageId: string; x: number; y: number } | null>(null);
	const [banWordPrompt, setBanWordPrompt] = useState<{ text: string } | null>(null);
	const [pendingLinkUrl, setPendingLinkUrl] = useState<string | null>(null);
	const [dontAskLinkOpenAgain, setDontAskLinkOpenAgain] = useState(false);

	const openLink = useCallback((url: string) => {
		openUrl(url).catch(() => window.open(url, "_blank"));
	}, []);

	const requestOpenLink = useCallback(
		(url: string) => {
			if (isLinkOpenConfirmSkipped()) {
				openLink(url);
				return;
			}
			setDontAskLinkOpenAgain(false);
			setPendingLinkUrl(url);
		},
		[openLink],
	);

	const confirmOpenLink = useCallback(() => {
		if (!pendingLinkUrl) return;
		if (dontAskLinkOpenAgain && typeof window !== "undefined") {
			localStorage.setItem(SKIP_LINK_OPEN_CONFIRM_KEY, "true");
		}
		openLink(pendingLinkUrl);
		setPendingLinkUrl(null);
	}, [pendingLinkUrl, dontAskLinkOpenAgain, openLink]);

	const reactionButtonRefs = useRef<Map<string, HTMLElement>>(new Map());
	const prevReactionCountsRef = useRef<Map<string, number>>(new Map());
	const particleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [reactionParticles, setReactionParticles] = useState<{
		key: number; x: number; y: number;
		items: Array<{emoji?: string; dx: number; dy: number; size: number; dur: number; delay: number}>;
	} | null>(null);

	const triggerReactionParticles = useCallback((x: number, y: number) => {
		if (particleTimeoutRef.current) clearTimeout(particleTimeoutRef.current);
		const flames = Array.from({length: 5}, () => {
			const angle = Math.random() * Math.PI * 2;
			const dist = Math.random() * 40 + 20;
			return { emoji: "🔥", dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, size: Math.random() * 7 + 10, dur: Math.random() * 0.25 + 0.45, delay: Math.random() * 0.1 };
		});
		const dots = Array.from({length: 10}, (_, i) => {
			const angle = (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
			const dist = Math.random() * 50 + 15;
			return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, size: Math.random() * 4 + 2, dur: Math.random() * 0.2 + 0.3, delay: Math.random() * 0.06 };
		});
		setReactionParticles({key: Date.now(), x, y, items: [...flames, ...dots]});
		particleTimeoutRef.current = setTimeout(() => setReactionParticles(null), 1200);
	}, []);

	useEffect(() => {
		if (!reactionBurstMessageId) return;
		const el = reactionButtonRefs.current.get(reactionBurstMessageId);
		if (!el) return;
		const rect = el.getBoundingClientRect();
		triggerReactionParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
	}, [reactionBurstMessageId, triggerReactionParticles]);

	useEffect(() => {
		for (const msg of threadMessages) {
			const prev = prevReactionCountsRef.current.get(msg.messageId) ?? -1;
			const curr = msg.reactions.length;
			if (prev >= 0 && curr > prev) {
				const el = reactionButtonRefs.current.get(msg.messageId);
				if (el) {
					const rect = el.getBoundingClientRect();
					triggerReactionParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
				}
			}
			prevReactionCountsRef.current.set(msg.messageId, curr);
		}
	}, [threadMessages, triggerReactionParticles]);

	useEffect(() => {
		prevReactionCountsRef.current.clear();
		reactionButtonRefs.current.clear();
	}, [selectedConversation.data.conversationId]);

	const handleCopy = useCallback(async (message: UiMessage) => {
		const location = getMessageLocation(message);
		const body = message.body as any;
		const hasRealText = body && typeof body.text === "string" && body.text.trim().length > 0;

		let content = "";
		if (location) {
			content = `${location.lat}, ${location.lon}`;
		} else if (hasRealText) {
			content = body.text;
		}

		if (!content) {
			return;
		}

		try {
			await navigator.clipboard.writeText(content);
			toast.success(t("chat.toasts.copied", { defaultValue: "Copied to clipboard" }));
		} catch (error) {
			appLog.error("Copy failed", error);
		}
	}, [t]);

	const handleAddToSavedPhrases = useCallback(async (text: string) => {
		const trimmed = text.trim();
		if (!trimmed) return;
		try {
			const current = await loadSavedPhrases();
			await saveSavedPhrases([...current, trimmed]);
			toast.success(
				t("chat.actions.added_to_saved_phrases", { defaultValue: "Added to saved phrases" }),
			);
		} catch (error) {
			appLog.error("Failed to add saved phrase", error);
		}
	}, [t]);

	useEffect(() => {
		setRevealedMediaMessageIds(new Set());
		setHoveredMediaMessageId(null);
	}, [selectedConversation.data.conversationId]);

	const revealMediaMessage = useCallback((messageId: string) => {
		setRevealedMediaMessageIds((previous) => {
			if (previous.has(messageId)) {
				return previous;
			}
			const next = new Set(previous);
			next.add(messageId);
			return next;
		});
	}, []);

	const handleMediaMouseEnter = useCallback(
		(messageId: string) => {
			if (!isDesktop) {
				return;
			}
			setHoveredMediaMessageId(messageId);
		},
		[isDesktop],
	);

	const handleMediaMouseLeave = useCallback(
		(messageId: string) => {
			if (!isDesktop) {
				return;
			}
			setHoveredMediaMessageId((current) => (current === messageId ? null : current));
		},
		[isDesktop],
	);

	const lastMyMessageId = [...threadMessages]
		.reverse()
		.find((m) => userId != null && Number(m.senderId) === Number(userId))?.messageId;

	const lastMessageId = threadMessages[threadMessages.length - 1]?.messageId;

	const latestMessageIdByAlbum = useMemo(() => {
		const map = new Map<number, string>();
		for (const m of threadMessages) {
			if (m.type !== "Album" && m.type !== "ExpiringAlbum" && m.type !== "ExpiringAlbumV2") continue;
			const aid = getMessageAlbumId(m);
			if (aid) map.set(aid, m.messageId);
		}
		return map;
	}, [threadMessages]);

	// Whether the most recent share of each album is currently viewable —
	// once an album is shared again, older messages for the same album
	// shouldn't keep showing a "cached, no longer shared" badge.
	const albumActivelyShared = useMemo(() => {
		const map = new Map<number, boolean>();
		for (const m of threadMessages) {
			if (m.type !== "Album" && m.type !== "ExpiringAlbum" && m.type !== "ExpiringAlbumV2") continue;
			const aid = getMessageAlbumId(m);
			if (!aid) continue;
			const body = m.body as Record<string, unknown> | null | undefined;
			map.set(aid, body?.isViewable === true);
		}
		return map;
	}, [threadMessages]);

	const swipeStateRef = useRef<{
		messageId: string;
		message: UiMessage;
		startX: number;
		startY: number;
		armed: boolean;
	} | null>(null);
	const SWIPE_REPLY_THRESHOLD = 55;
	const SWIPE_REPLY_MAX_DRAG = 80;
	// iOS's back gesture starts at the screen's left edge and drags right —
	// the same direction as swipe-to-reply. Leave that strip to the system.
	const IOS_BACK_EDGE_WIDTH = 30;
	const onIos = useMemo(() => isIos(), []);
	const swipeElRef = useRef(new Map<string, HTMLDivElement>());
	const swipeIconRef = useRef(new Map<string, HTMLDivElement>());

	const resetSwipeVisual = useCallback((messageId: string) => {
		const el = swipeElRef.current.get(messageId);
		const icon = swipeIconRef.current.get(messageId);
		if (el) {
			el.style.transition = "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)";
			el.style.transform = "translateX(0px)";
		}
		if (icon) {
			icon.style.transition = "opacity 0.2s, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)";
			icon.style.opacity = "0";
			icon.style.transform = "translateY(-50%) scale(0.5)";
		}
	}, []);

	const lastTapRef = useRef<{ messageId: string; time: number } | null>(null);
	const pendingTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingTapActionRef = useRef<(() => void) | null>(null);

	const handleMobileTouchStart = useCallback(
		(event: React.TouchEvent<HTMLDivElement>, message: UiMessage) => {
			startMessageLongPress(message.messageId);
			if (
				isDesktop ||
				isArchived ||
				event.touches.length !== 1 ||
				(onIos && event.touches[0].clientX < IOS_BACK_EDGE_WIDTH) ||
				isLocalClientMessageId(message.messageId) ||
				isLocalHistoryMessage(message)
			) {
				swipeStateRef.current = null;
				return;
			}
			const touch = event.touches[0];
			swipeStateRef.current = {
				messageId: message.messageId,
				message,
				startX: touch.clientX,
				startY: touch.clientY,
				armed: false,
			};
		},
		[isArchived, isDesktop, onIos, startMessageLongPress],
	);

	const handleMobileTouchMove = useCallback(
		(event: React.TouchEvent<HTMLDivElement>, message: UiMessage) => {
			endMessageLongPress();
			if (isDesktop || event.touches.length !== 1) {
				return;
			}
			const state = swipeStateRef.current;
			if (!state || state.messageId !== message.messageId) {
				return;
			}
			const touch = event.touches[0];
			const dx = Math.min(touch.clientX - state.startX, SWIPE_REPLY_MAX_DRAG);
			const dy = Math.abs(touch.clientY - state.startY);
			if (dy >= 40 && !state.armed) return;
			const el = swipeElRef.current.get(state.messageId);
			const icon = swipeIconRef.current.get(state.messageId);
			if (el) {
				el.style.transition = "none";
				el.style.transform = `translateX(${Math.max(dx, 0)}px)`;
			}
			const isArmed = dx > SWIPE_REPLY_THRESHOLD;
			if (icon) {
				const progress = Math.min(Math.max(dx, 0) / 40, 1);
				icon.style.transition = isArmed !== state.armed ? "transform 0.12s ease-out" : "none";
				icon.style.opacity = String(progress);
				icon.style.transform = `translateY(-50%) scale(${isArmed ? 1.3 : 0.5 + progress * 0.5})`;
			}
			// Reply only fires on release (handleMobileTouchEnd) — crossing the
			// threshold just arms it, and dragging back disarms it again.
			if (isArmed !== state.armed) {
				state.armed = isArmed;
				if (isArmed) {
					haptic(40);
				}
			}
		},
		[endMessageLongPress, isDesktop],
	);

	const handleMobileTouchEnd = useCallback(() => {
		const state = swipeStateRef.current;
		swipeStateRef.current = null;
		endMessageLongPress();
		if (!state) return;
		resetSwipeVisual(state.messageId);
		if (state.armed) {
			void handleReply(state.message);
		}
	}, [endMessageLongPress, handleReply, resetSwipeVisual]);

	const handleMobileTouchCancel = useCallback(() => {
		const state = swipeStateRef.current;
		swipeStateRef.current = null;
		endMessageLongPress();
		if (state) resetSwipeVisual(state.messageId);
	}, [endMessageLongPress, resetSwipeVisual]);

	// Android's WebView sometimes delivers a clean tap on a media tile
	// (touchstart/touchend, no movement, nothing prevented) without the click
	// that should follow: reliably on the tile last opened, right after the
	// full-screen viewer was swiped away. Media tiles therefore also detect the
	// tap themselves: if no click arrives shortly after a clean touchend, the
	// tap handler runs anyway, and a click that does arrive later is dropped.
	// Each touch counts exactly once, so double-tap to react keeps working.
	// The touch on a media tile; a clean tap still waiting for its click
	// carries `fire`, which stands in for that click.
	type MediaTouch = { x: number; y: number; time: number; handled: boolean; fire?: () => void };
	const mediaTouchRef = useRef<MediaTouch | null>(null);
	const mediaTapProps = useCallback(
		(onTap: (tile: HTMLElement) => void) => ({
			onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
				// A new touch while the previous tap still waits for its click:
				// that tap happened, run it now instead of dropping it. Otherwise
				// the first tap of a double-tap got lost and the second one opened
				// the viewer instead of reacting.
				mediaTouchRef.current?.fire?.();
				const touch = event.touches[0];
				mediaTouchRef.current =
					event.touches.length === 1 && touch
						? { x: touch.clientX, y: touch.clientY, time: performance.now(), handled: false }
						: null;
			},
			onTouchEnd: (event: React.TouchEvent<HTMLElement>) => {
				const start = mediaTouchRef.current;
				const touch = event.changedTouches[0];
				if (!start || !touch) return;
				const isCleanTap =
					performance.now() - start.time < MEDIA_TAP_MAX_MS &&
					Math.hypot(touch.clientX - start.x, touch.clientY - start.y) < MEDIA_TAP_SLOP_PX;
				if (!isCleanTap) return;
				const tile = event.currentTarget;
				const fire = () => {
					window.clearTimeout(timer);
					start.fire = undefined;
					if (start.handled) return;
					start.handled = true;
					onTap(tile);
				};
				const timer = window.setTimeout(fire, MISSING_CLICK_WAIT_MS);
				start.fire = fire;
			},
			onClick: (event: React.MouseEvent<HTMLElement>) => {
				event.stopPropagation();
				const start = mediaTouchRef.current;
				// The browser's own click for this touch, unless the fallback
				// already stood in for it.
				if (start && performance.now() - start.time < 1000) {
					start.fire = undefined;
					if (start.handled) return;
					start.handled = true;
				}
				onTap(event.currentTarget);
			},
		}),
		[],
	);

	const scheduleMobileTap = useCallback(
		(message: UiMessage, action: (() => void) | null) => {
			if (messageLongPressTriggeredRef.current) {
				messageLongPressTriggeredRef.current = false;
				return;
			}

			if (pendingTapTimerRef.current !== null) {
				clearTimeout(pendingTapTimerRef.current);
				pendingTapTimerRef.current = null;
				pendingTapActionRef.current = null;
			}

			const now = Date.now();
			const last = lastTapRef.current;

			if (last && last.messageId === message.messageId && now - last.time < 300) {
				lastTapRef.current = null;
				void handleReact(message);
				return;
			}

			lastTapRef.current = { messageId: message.messageId, time: now };

			if (action) {
				pendingTapActionRef.current = action;
				pendingTapTimerRef.current = setTimeout(() => {
					const act = pendingTapActionRef.current;
					pendingTapTimerRef.current = null;
					pendingTapActionRef.current = null;
					act?.();
				}, 280);
			}
		},
		[handleReact, messageLongPressTriggeredRef],
	);

	useEffect(() => {
		return () => {
			if (pendingTapTimerRef.current !== null) {
				clearTimeout(pendingTapTimerRef.current);
			}
		};
	}, []);

	// Rendered (not live) state, so the menu keeps its content while animating out.
	const contextMenuPresence = usePresence(contextMenuState);
	const contextMenuTarget = useMemo(() => {
		const menu = contextMenuPresence.rendered;
		if (!menu) return null;
		return threadMessages.find((m) => m.messageId === menu.messageId) ?? null;
	}, [contextMenuPresence.rendered, threadMessages]);

	const contextMenuActions = useMemo<MessageContextMenuAction[]>(() => {
		if (!contextMenuTarget) return [];
		const message = contextMenuTarget;
		const mine = userId != null && Number(message.senderId) === Number(userId);
		const body = message.body as any;
		const hasText = body && typeof body.text === "string" && body.text.trim().length > 0;
		const location = getMessageLocation(message);
		const imageUrl = getMessageImageUrl(message);
		const videoUrl = getMessageVideoUrl(message);
		const audioUrl = getMessageAudioUrl(message);
		const isAlbumMessage =
			message.type === "Album" || message.type === "ExpiringAlbum" || message.type === "ExpiringAlbumV2";
		const albumId = getMessageAlbumId(message);
		const isMutating = isMutatingMessageId === message.messageId;

		const actions: MessageContextMenuAction[] = [];

		if (!isArchived && !isLocalHistoryMessage(message)) {
			actions.push({
				key: "reply",
				label: t("chat.actions.reply"),
				icon: <Reply className="h-4 w-4" />,
				onClick: () => void handleReply(message),
				disabled: !canReply,
			});
		}

		if (hasText || location) {
			actions.push({
				key: "copy",
				label: t("chat.actions.copy", { defaultValue: "Copy" }),
				icon: <Copy className="h-4 w-4" />,
				onClick: () => void handleCopy(message),
			});
		}

		if (hasText) {
			actions.push({
				key: "saved-phrase",
				label: t("chat.actions.add_to_saved_phrases", { defaultValue: "Add to saved phrases" }),
				icon: <MessageSquarePlus className="h-4 w-4" />,
				onClick: () => void handleAddToSavedPhrases(body.text),
			});
		}

		if (
			messageTranslations.canTranslate(message.messageId) &&
			!messageTranslations.translations.has(message.messageId)
		) {
			actions.push({
				key: "translate",
				label: t("auto_translate.translate_message", { defaultValue: "Translate" }),
				icon: <Languages className="h-4 w-4" />,
				onClick: () => messageTranslations.translateMessage(message.messageId),
			});
		}

		if (imageUrl || videoUrl || audioUrl) {
			actions.push({
				key: "download",
				label: t("chat.actions.download", { defaultValue: "Download" }),
				icon: <Download className="h-4 w-4" />,
				onClick: () => {
					const mediaUrl = imageUrl || videoUrl;
					if (mediaUrl) {
						void (async () => {
							try {
								const saved = await saveMediaToDevice(
									mediaUrl,
									videoUrl ? "video" : "image",
									selectedConversation.data.conversationId,
								);
								if (saved) {
									toast.success(
										t(isIos() ? "profile_details.save_to_gallery_success" : "profile_details.save_to_downloads_success"),
									);
								} else {
									toast.error(t("profile_details.save_to_gallery_unsupported"));
								}
							} catch (e) {
								appLog.error("Failed to save media to gallery", e);
								toast.error(
									t(isIos() ? "profile_details.save_to_gallery_error" : "profile_details.save_to_downloads_error"),
								);
							}
						})();
						return;
					}
					if (audioUrl) {
						const a = document.createElement("a");
						a.href = audioUrl;
						a.download = `media-${Date.now()}`;
						a.target = "_blank";
						document.body.appendChild(a);
						a.click();
						document.body.removeChild(a);
					}
				},
			});
		}

		if (!mine && hasText) {
			actions.push({
				key: "ban-word",
				label: t("chat.actions.ban_word", { defaultValue: "Add forbidden keyword" }),
				icon: <Ban className="h-4 w-4" />,
				onClick: () => {
					setBanWordPrompt({ text: hasText ? body.text : "" });
				},
			});
		}

		if (!isArchived && mine && !message.unsent) {
			actions.push({
				key: "unsend",
				label: t("chat.actions.unsend"),
				icon: <Undo2 className="h-4 w-4" />,
				onClick: () => void handleUnsend(message),
				disabled: isMutating,
			});
		}

		if (mine && isAlbumMessage && albumId && body?.isViewable) {
			actions.push({
				key: "stop-sharing",
				label: t("chat.actions.stop_sharing", { defaultValue: "Stop Sharing" }),
				icon: <Album className="h-4 w-4" />,
				onClick: () => void handleStopAlbumShare(albumId),
				disabled: isMutating,
			});
		}

		if (!mine && isAlbumMessage && albumId && isAlbumCachedLocally(albumId)) {
			actions.push({
				key: "remove-share",
				label: t("chat.actions.remove_share", { defaultValue: "Remove Share" }),
				icon: <Album className="h-4 w-4" />,
				onClick: () => void handleRemoveLocalAlbum(albumId),
				disabled: isMutating,
			});
		}

		actions.push({
			key: "delete",
			label: t("chat.actions.delete"),
			icon: <Trash2 className="h-4 w-4" />,
			onClick: () => void handleDelete(message),
			disabled: isMutating,
			danger: true,
			separatorBefore: true,
		});

		return actions;
	}, [
		contextMenuTarget,
		userId,
		messageTranslations,
		isMutatingMessageId,
		isArchived,
		t,
		handleReply,
		canReply,
		handleCopy,
		handleAddToSavedPhrases,
		handleUnsend,
		handleStopAlbumShare,
		handleRemoveLocalAlbum,
		handleDelete,
	]);

	// Grouped by day so each day's sticky date pill is bounded to its own
	// group container and gets pushed off by the next group instead of
	// staying stuck forever alongside every other day's pill.
	const dayGroups = useMemo(() => {
		const groups: { header: string; messages: UiMessage[] }[] = [];
		for (const message of threadMessages) {
			const header = formatDateHeader(message.timestamp, nowTimestamp, t);
			const lastGroup = groups[groups.length - 1];
			if (lastGroup && lastGroup.header === header) {
				lastGroup.messages.push(message);
			} else {
				groups.push({ header, messages: [message] });
			}
		}
		return groups;
	}, [threadMessages, nowTimestamp, t]);

	// Keep the newest message in view when the floating composer grows (reply
	// preview, multi-line draft, phrase pills) — but only if already at the end.
	const prevBottomInsetRef = useRef(bottomInset);
	useLayoutEffect(() => {
		const previous = prevBottomInsetRef.current;
		prevBottomInsetRef.current = bottomInset;
		const container = threadScrollContainerRef.current;
		if (!container || previous === bottomInset) return;
		const distanceFromEnd = container.scrollHeight - container.scrollTop - container.clientHeight;
		if (distanceFromEnd - Math.max(0, bottomInset - previous) < 80) {
			container.scrollTop = container.scrollHeight;
		}
	}, [bottomInset, threadScrollContainerRef]);

	// When the thread viewport itself shrinks or grows (mobile keyboard opening
	// or closing), keep the distance to the end constant so the visible messages
	// slide with the composer instead of disappearing behind it. The distance is
	// tracked from scroll events rather than derived at resize time, because on
	// grow the browser may already have clamped scrollTop. Content that lands
	// without a scroll (incoming message while reading history, media finishing
	// loading) also refreshes it, otherwise the next keyboard toggle would jump.
	useEffect(() => {
		const container = threadScrollContainerRef.current;
		if (!container || typeof ResizeObserver === "undefined") return;
		const readDistance = () => Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
		let distanceFromEnd = readDistance();
		let previousHeight = container.clientHeight;
		const onScroll = () => {
			distanceFromEnd = readDistance();
		};
		const contentObserver = new MutationObserver(onScroll);
		contentObserver.observe(container, { childList: true, subtree: true, characterData: true });
		container.addEventListener("load", onScroll, true);
		container.addEventListener("loadedmetadata", onScroll, true);
		const observer = new ResizeObserver(() => {
			const height = container.clientHeight;
			if (height === previousHeight) return;
			previousHeight = height;
			container.scrollTop = container.scrollHeight - height - distanceFromEnd;
			distanceFromEnd = readDistance();
		});
		container.addEventListener("scroll", onScroll, { passive: true });
		observer.observe(container);
		return () => {
			container.removeEventListener("scroll", onScroll);
			container.removeEventListener("load", onScroll, true);
			container.removeEventListener("loadedmetadata", onScroll, true);
			contentObserver.disconnect();
			observer.disconnect();
		};
	}, [threadScrollContainerRef]);

	return (
		<div
			ref={threadScrollContainerRef}
			onScroll={handleThreadScroll}
			data-lenis-prevent
			className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto"
			style={bottomInset > 0 || topInset > 0 ? { paddingBottom: bottomInset, paddingTop: topInset } : undefined}
		>
            {messagePageKey ? (
                <button
                    type="button"
                    onClick={() =>
                        void loadThread({
                            conversationId: selectedConversation.data.conversationId,
                            older: true,
                        })
                    }
                    disabled={isLoadingOlderMessages}
                    className="mx-auto mb-3 rounded-xl border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-muted)] transition hover:border-[var(--accent)] disabled:opacity-60"
                >
                    {isLoadingOlderMessages ? t("chat.loading") : t("chat.load_older_messages")}
                </button>
            ) : null}

            <div className={`flex flex-col gap-2 ${!isDesktop ? "px-[var(--app-px)] pt-4" : ""}`}>
            {(() => {
                const renderDateSeparator = (label: string) => (
                    <div className="sticky top-2 z-30 my-3 flex justify-center">
                        <span className="rounded-full bg-[color-mix(in_srgb,var(--surface-2)_88%,transparent)] px-3 py-1 text-[11px] font-semibold text-[var(--text-muted)] shadow-sm backdrop-blur-sm">
                            {label}
                        </span>
                    </div>
                );
                const renderEventPill = (icon: React.ReactNode, label: string, timestamp: number) => (
                    <div className="my-1.5 flex justify-center">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] shadow-sm">
                            {icon}
                            <span>{label}</span>
                            <span className="text-[var(--text-muted)]/70">{formatDateTime24(timestamp)}</span>
                        </div>
                    </div>
                );
                return dayGroups.map((group, groupIndex) => (
                    <div key={`${group.header}-${groupIndex}`} className="relative">
                        {renderDateSeparator(group.header)}
                        <div className="flex flex-col gap-2">
                        {group.messages.map((message) => {

                    if (
                        message.type === "SystemBlocked" ||
                        message.type === "SystemUnblocked" ||
                        message.type === "SystemBlockedBySelf" ||
                        message.type === "SystemUnblockedBySelf"
                    ) {
                        const isBlocked =
                            message.type === "SystemBlocked" || message.type === "SystemBlockedBySelf";
                        const isSelf =
                            message.type === "SystemBlockedBySelf" || message.type === "SystemUnblockedBySelf";
                        let label: string;
                        if (isBlocked && isSelf) {
                            label = t("chat.system.blocked_by_self", { defaultValue: "You blocked this person" });
                        } else if (isBlocked) {
                            label = t("chat.system.blocked", { defaultValue: "You were blocked" });
                        } else if (isSelf) {
                            label = t("chat.system.unblocked_by_self", { defaultValue: "You unblocked this person" });
                        } else {
                            label = t("chat.system.unblocked", { defaultValue: "You were unblocked" });
                        }
                        return (
                            <Fragment key={message.messageId}>
                                {renderEventPill(
                                    isBlocked ? (
                                        <Ban className="h-3.5 w-3.5 shrink-0" />
                                    ) : (
                                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                                    ),
                                    label,
                                    message.timestamp,
                                )}
                            </Fragment>
                        );
                    }

                    if (message.type === "VideoCall") {
                        const body = message.body as Record<string, unknown> | null;
                        const isSuccessful =
                            typeof body?.result === "string" && body.result.toUpperCase() === "SUCCESSFUL";
                        const label = getVideoCallStatusLabel(message, t);
                        return (
                            <Fragment key={message.messageId}>
                                {renderEventPill(
                                    isSuccessful ? (
                                        <Video className="h-3.5 w-3.5 shrink-0" />
                                    ) : (
                                        <PhoneOff className="h-3.5 w-3.5 shrink-0" />
                                    ),
                                    label,
                                    message.timestamp,
                                )}
                            </Fragment>
                        );
                    }

                    const mine =
                        userId != null && Number(message.senderId) === Number(userId);
                    const failed = message.clientState === "failed";
                    const pending = message.clientState === "pending";
                    // Every message in an archived conversation is local-only by
                    // definition (the whole thread is gone from the API) — singling
                    // out individual messages with the badge/dimming is redundant
                    // and inconsistent. Show them all normally; the per-message
                    // local-history treatment is reserved for active conversations
                    // where one specific message was preserved through an unsend.
                    const localOnly =
                        !isArchived &&
                        (message._localOnly === true || message.localHistory === true);
                    let imageUrl = getMessageImageUrl(message);
                    const gaymojiUrl = getGaymojiUrl(message);
                    const messageTakenOnGrindr = getMessageTakenOnGrindr(message);
                    const imageCreatedAt = getMessageImageCreatedAt(message);
                    const imageCreatedAtLabel =
                        imageCreatedAt != null
                            ? formatDateTime24(imageCreatedAt)
                            : null;
                    let videoUrl = getMessageVideoUrl(message);
                    let audioUrl = getMessageAudioUrl(message);
                    // Prefer the locally-cached copy (survives signed-URL expiry /
                    // view-once limits) over the remote URL once it's available.
                    if (imageUrl || videoUrl || audioUrl) {
                        const captureTarget = getMediaCaptureTarget(message);
                        // The primary key can miss even though the bytes are stored —
                        // e.g. a re-issued URL resolving to a different media key —
                        // so also try the message-id copy before the remote URL,
                        // which may already be expired.
                        const cachedUri =
                            (captureTarget ? getCachedMediaUri(captureTarget.mediaKey) : null) ??
                            getCachedMediaUri(getMessageFallbackMediaKey(message.messageId));
                        if (cachedUri) {
                            if (imageUrl) imageUrl = cachedUri;
                            else if (videoUrl) videoUrl = cachedUri;
                            else if (audioUrl) audioUrl = cachedUri;
                        }
                    } else {
                        // The live message no longer carries a URL at all (expired
                        // and never refreshed, conversation archived, etc.) — fall
                        // back to whatever's cached for it by message id, so media
                        // we already downloaded keeps showing instead of going blank.
                        const fallbackUri = getCachedMediaUri(
                            getMessageFallbackMediaKey(message.messageId),
                        );
                        if (fallbackUri) {
                            if (fallbackUri.startsWith("data:video/")) videoUrl = fallbackUri;
                            else if (fallbackUri.startsWith("data:audio/")) audioUrl = fallbackUri;
                            else imageUrl = fallbackUri;
                        }
                    }
                    const location = getMessageLocation(message);
                    const albumId = getMessageAlbumId(message);
                    if (albumId != null) {
                        // Lazily checks chatDb the first time this album is
                        // rendered in this session (e.g. right after an app
                        // restart, before any capture pass has re-run) so a
                        // previously-captured album shows as open-able
                        // immediately instead of only after its next refresh.
                        ensureAlbumCacheChecked(albumId);
                    }
                    const isAlbumCachedForMessage = albumId != null && isAlbumCachedLocally(albumId);
                    // Prefer the cached cover over the live body's
                    // coverUrl/previewUrl, not just as a fallback for when it's
                    // missing — that field can be a stale signed URL that's
                    // non-null but already broken, which a null-coalescing
                    // fallback would never catch. Keying the cache by album id
                    // (not message id) also means that once a newer share
                    // refreshes the cover, every older message referencing the
                    // same album immediately shows that same, freshest cover —
                    // not just the message that triggered the refresh.
                    const albumCover =
                        (albumId != null ? getCachedAlbumCoverUri(albumId) : null) ??
                        getMessageAlbumCoverUrl(message);
                    const albumMediaCount =
                        albumId != null
                            ? (ownAlbumMediaCountMap?.get(albumId) ?? getCachedAlbumMediaCount(albumId))
                            : null;
                    const albumName =
                        albumId != null
                            ? (ownAlbumNameMap?.get(albumId) ?? getCachedAlbumName(albumId))
                            : null;
                    const messageText = getMessageText(message, t);
                    const replyPreviewRaw = message.replyPreview as {
                        text?: string; type?: string; chat1Type?: string;
                        url?: string | null; imageHash?: string | null;
                        previewMessageId?: string; senderId?: number; duration?: number;
                    } | null | undefined;
                    const replyText = typeof replyPreviewRaw?.text === "string" && replyPreviewRaw.text.trim().length > 0
                        ? replyPreviewRaw.text.trim()
                        : null;
                    const replyToMsgRef = message.replyToMessage as { messageId?: string; senderId?: number; type?: string } | null | undefined;
                    const hasReply = !!(replyToMsgRef?.messageId);
                    const replyToMsgId = replyPreviewRaw?.previewMessageId ?? replyToMsgRef?.messageId;
                    const replyToMsg = replyToMsgId
                        ? threadMessages.find(m => m.messageId === replyToMsgId) ?? null
                        : null;
                    const albumOwnerProfileId = message.type === "AlbumContentReply"
                        ? ((message.body as Record<string, unknown> | null | undefined)?.ownerProfileId as number | null | undefined) ?? null
                        : null;
                    const replySenderId = replyPreviewRaw?.senderId
                        ?? replyToMsgRef?.senderId
                        ?? replyToMsg?.senderId
                        ?? albumOwnerProfileId
                        ?? null;
                    const replyIsImage = replyPreviewRaw?.type === "Image" || replyPreviewRaw?.type === "ExpiringImage"
                        || replyPreviewRaw?.type === "Giphy"
                        || replyPreviewRaw?.chat1Type === "image" || replyPreviewRaw?.chat1Type === "expiring_image"
                        || replyToMsgRef?.type === "Giphy" || replyToMsg?.type === "Giphy";
                    const replyIsAudio = replyPreviewRaw?.type === "Audio" || replyPreviewRaw?.chat1Type === "audio"
                        || replyToMsgRef?.type === "Audio" || replyToMsg?.type === "Audio";
                    const isVideoType = (type: string | undefined) =>
                        type === "Video" || type === "PrivateVideo" || type === "NonExpiringVideo";
                    const replyIsVideo = isVideoType(replyPreviewRaw?.type)
                        || replyPreviewRaw?.chat1Type === "video" || replyPreviewRaw?.chat1Type === "privatevideo" || replyPreviewRaw?.chat1Type === "nonexpiringvideo"
                        || isVideoType(replyToMsgRef?.type) || isVideoType(replyToMsg?.type);
                    // Prefer whatever's already durably cached (survives the referenced
                    // content outliving its signed URL / hash-thumb endpoint / album
                    // share) over resolving straight from live message data — same
                    // rationale as the main image/album handling above.
                    const replyToMsgCaptureTarget = replyToMsg ? getMediaCaptureTarget(replyToMsg) : null;
                    const cachedReplyImageUri = replyToMsgCaptureTarget?.kind === "image"
                        ? getCachedMediaUri(replyToMsgCaptureTarget.mediaKey)
                        : null;
                    const replyImageUrl = cachedReplyImageUri ?? (replyToMsg ? getMessageImageUrl(replyToMsg) : null);
                    const cachedReplyVideoUri = replyToMsgCaptureTarget?.kind === "video"
                        ? getCachedMediaUri(replyToMsgCaptureTarget.mediaKey)
                        : null;
                    const replyVideoUrl = replyIsVideo
                        ? (cachedReplyVideoUri ?? (replyToMsg ? getMessageVideoUrl(replyToMsg) : null))
                        : null;
                    const replyImageHash = typeof replyPreviewRaw?.imageHash === "string" ? replyPreviewRaw.imageHash : null;
                    const replyHashTarget = getReplyImageHashTarget(message);
                    const cachedReplyHashUri = replyHashTarget ? getCachedMediaUri(replyHashTarget.mediaKey) : null;
                    const _replyRawRecord = replyPreviewRaw as Record<string, unknown> | null | undefined;
                    const replyPreviewUrl = replyIsImage && typeof replyPreviewRaw?.url === "string" && replyPreviewRaw.url.startsWith("http") ? replyPreviewRaw.url
                        : replyIsImage && typeof _replyRawRecord?.stillPath === "string" ? String(_replyRawRecord.stillPath)
                        : replyIsImage && typeof _replyRawRecord?.previewPath === "string" ? String(_replyRawRecord.previewPath)
                        : replyIsImage && typeof _replyRawRecord?.urlPath === "string" ? String(_replyRawRecord.urlPath)
                        : null;
                    const replyMsgBody = message.body as Record<string, unknown> | null | undefined;
                    // Scoped to AlbumContentReply only (matching albumContentThumbUrl
                    // below) — AlbumContentReaction has no reply-quote bar at all; its
                    // own thumbnail is resolved separately by the isAlbumReactionBubble
                    // block further down. Without this guard, once a reacted-to item's
                    // thumb gets cached, this block would start truthily contributing
                    // to replyThumbUrl for Reaction messages too, popping a redundant
                    // quote bar in above the dedicated reaction bubble.
                    const ownAlbumContentTarget = message.type === "AlbumContentReply"
                        ? getAlbumContentReplyTarget(message)
                        : null;
                    const cachedAlbumContentThumbUri = ownAlbumContentTarget
                        ? getCachedAlbumContentThumbUri(ownAlbumContentTarget.albumId, ownAlbumContentTarget.contentId)
                        : null;
                    const albumContentThumbUrl = message.type === "AlbumContentReply" && typeof replyMsgBody?.previewUrl === "string"
                        ? replyMsgBody.previewUrl
                        : null;
                    const referencedAlbumContentTarget = replyToMsg
                        ? getAlbumContentReplyTarget(replyToMsg)
                        : (message.replyToMessage ? getAlbumContentReplyTarget(message.replyToMessage as unknown as UiMessage) : null);
                    const cachedReplyToMsgThumbUri = referencedAlbumContentTarget
                        ? getCachedAlbumContentThumbUri(referencedAlbumContentTarget.albumId, referencedAlbumContentTarget.contentId)
                        : null;
                    const replyToMsgThumbUrl = (() => {
                        const embedded = message.replyToMessage as Record<string, unknown> | null | undefined;
                        const src = embedded ?? (replyToMsg as Record<string, unknown> | null | undefined);
                        if (!src) return null;
                        const b = src.body as Record<string, unknown> | null | undefined;
                        const t = src.type as string | undefined;
                        if ((t === "AlbumContentReaction" || t === "AlbumContentReply") && typeof b?.previewUrl === "string") return b.previewUrl;
                        return null;
                    })();
                    const isAlbumType = (type: string | undefined) =>
                        type === "Album" || type === "ExpiringAlbum" || type === "ExpiringAlbumV2";
                    const replyIsAlbum = isAlbumType(replyPreviewRaw?.type)
                        || isAlbumType(replyToMsgRef?.type) || isAlbumType(replyToMsg?.type);
                    // A replied-to album shows its cover, resolved like the album
                    // bubble's own (cached cover first, then the body's cover URL).
                    const replyAlbumCoverUrl = (() => {
                        if (!replyIsAlbum) return null;
                        const src = replyToMsg ?? (message.replyToMessage as unknown as UiMessage | null | undefined);
                        if (!src) return null;
                        const replyAlbumId = getMessageAlbumId(src);
                        return (replyAlbumId != null ? getCachedAlbumCoverUri(replyAlbumId) : null)
                            ?? getMessageAlbumCoverUrl(src);
                    })();
                    const replyThumbUrl = replyAlbumCoverUrl
                        ?? replyImageUrl
                        ?? cachedReplyHashUri
                        ?? (replyImageHash ? getThumbImageUrl(replyImageHash, "320x320") : null)
                        ?? replyPreviewUrl
                        ?? cachedAlbumContentThumbUri
                        ?? albumContentThumbUrl
                        ?? cachedReplyToMsgThumbUri
                        ?? replyToMsgThumbUrl;
                    const replyLocation = replyToMsg
                        ? getMessageLocation(replyToMsg)
                        : message.replyToMessage ? getMessageLocation(message.replyToMessage as unknown as UiMessage) : null;
                    const replyAudioDuration = (() => {
                        if (!replyIsAudio) return null;
                        const embedded = message.replyToMessage as Record<string, unknown> | null | undefined;
                        const src = (replyToMsg?.body ?? embedded?.body) as Record<string, unknown> | null | undefined;
                        const rawMs = typeof replyPreviewRaw?.duration === "number"
                            ? replyPreviewRaw.duration
                            : typeof src?.length === "number" ? src.length : null;
                        if (rawMs === null) return null;
                        const totalSec = Math.floor(rawMs / 1000);
                        const m = Math.floor(totalSec / 60);
                        const s = totalSec % 60;
                        return `${m}:${s.toString().padStart(2, "0")}`;
                    })();
                    // Fallback label for the reply-quote bar when there's no quoted text
                    // (replyText) to show verbatim — describes what kind of message was
                    // replied to. Falls back to "shared_image" only for a genuinely
                    // unrecognized/missing type (legacy previews that never carried a
                    // type at all) — an unrecognized-but-known type string (a message
                    // kind this app version doesn't handle) must say so explicitly
                    // instead of silently lying that it was an image.
                    const replyTargetType = replyToMsg?.type ?? replyToMsgRef?.type;
                    const isReplyTargetUnsupported =
                        replyTargetType != null && !KNOWN_REPLY_TYPES.has(replyTargetType);
                    const replyDescription =
                        message.type === "AlbumContentReply" || replyTargetType === "AlbumContentReply"
                            ? t("chat.thread.album_image")
                            : replyTargetType === "AlbumContentReaction"
                                ? t("chat.thread.reacted_to_image")
                                : replyIsAlbum
                                    ? t("chat.preview.shared_album")
                                : replyIsAudio
                                    ? t("chat.thread.audio_label")
                                    : replyTargetType === "Location"
                                        ? t("chat.preview.sent_location")
                                        : replyIsVideo
                                            ? t("chat.thread.shared_video")
                                            : replyTargetType === "Giphy"
                                                ? t("chat.thread.shared_gif")
                                                : isReplyTargetUnsupported
                                                    ? t("chat.thread.unsupported_message", { defaultValue: "Unsupported message" })
                                                    : t("chat.thread.shared_image");
                    const replyLabel = (replyText || replyThumbUrl || replyVideoUrl || replyIsAudio || hasReply)
                        ? replySenderId === userId
                            ? mine // Prüft, ob die AKTUELL gerenderte Nachricht von uns ist
                                ? t("chat.thread.replied_to_myself")
                                : t("chat.thread.replied_to_you", { defaultValue: "Replied to you" })
                            : replySenderId != null && Number(replySenderId) === Number(message.senderId)
                                ? t("chat.thread.replied_to_myself")
                                : t("chat.thread.replied_to_name", {
                                        name: localNickname || selectedConversation?.data.name || t("common.unknown_display_name"),
                                    })
                        : null;
                    const displayText = stripReplyQuotePrefix(messageText, replyText);
                    const translatedText = mine ? null : messageTranslations.translations.get(message.messageId) ?? null;
                    const isTranslating = !mine && !translatedText && messageTranslations.translatingMessageIds.has(message.messageId);
                    const isExpiringImage = message.type === "ExpiringImage";
                    const isAlbumMessage =
                        message.type === "Album" ||
                        message.type === "ExpiringAlbum" ||
                        message.type === "ExpiringAlbumV2";
                    const isAlbumReactionBubble = message.type === "AlbumContentReaction";
                    const msgBody = message.body as any;
                    const isExpiredVideo = !videoUrl && msgBody?._videoExpired === true;
                    const isExpiredImage = !imageUrl && msgBody?._imageExpired === true;
                    const isUnsupportedMessage =
                        messageText === t("chat.thread.unsupported_placeholder") ||
                        messageText === `[${message.type}]`;
                    // Genuinely gone — unsent server-side and no local copy was
                    // preserved (getMessageText only falls back to the "unsent"
                    // placeholder when body is empty; if a local copy existed,
                    // mergeMessagePreservingUnsendWipe would have restored the
                    // real content and messageText/localHistory would reflect that).
                    const isTrulyUnsentMessage =
                        message.unsent === true && messageText === t("chat.thread.unsent");
                    const isImageOnlyBubble =
                        (Boolean(imageUrl) || isExpiredImage) && (messageText === t("chat.thread.shared_image") || messageText === t("chat.thread.shared_gif"));
                    const isVideoOnlyBubble =
                        (Boolean(videoUrl) || isExpiredVideo) && messageText === t("chat.thread.shared_video");
                    const isAlbumOnlyBubble =
                        isAlbumMessage && messageText === t("chat.preview.shared_album") && !hasReply;
                    const isLocationOnlyBubble =
                        Boolean(location) && messageText === t("chat.preview.sent_location");
                const isAudioOnlyBubble =
                        Boolean(audioUrl) && messageText === t("chat.thread.shared_audio");
                    const isMediaOnlyBubble =
                        isImageOnlyBubble || isVideoOnlyBubble || isAlbumOnlyBubble || isLocationOnlyBubble || isAlbumReactionBubble;
                    const tailCorner = mine ? "rounded-br-[3px]" : "rounded-bl-[3px]";
                    const shouldBlurIncomingMedia =
                        blurIncomingMedia &&
                        message.type !== "Giphy" &&
                        !revealedMediaMessageIds.has(message.messageId) &&
                        (!isDesktop || hoveredMediaMessageId !== message.messageId);
                    const mediaBlurClassName = shouldBlurIncomingMedia
                        ? "blur-md"
                        : "";
                    const isActiveSearchMatch =
                        selectedThreadMessageMatches[activeThreadSearchIndex]
                            ?.messageId === message.messageId;
                    const fireButtonClass = mine
                        ? "absolute -left-2 -top-2"
                        : "absolute -right-2 -top-2";
                    const reactionEmoji = getReactionEmoji(message.reactions[0]?.reactionType ?? 1);
                    const flameOutline = "drop-shadow(1px 0 0 var(--surface)) drop-shadow(-1px 0 0 var(--surface)) drop-shadow(0 1px 0 var(--surface)) drop-shadow(0 -1px 0 var(--surface))";
                    const multiReaction = message.reactions.length >= 2;
                    const hasOtherReaction = !multiReaction && message.reactions.length === 1 && !message.reactions.some(r => r.profileId === userId);
                    const backFlameTransform = mine ? "translate(-0.3em, -0.3em)" : "translate(0.3em, -0.3em)";
                    const reactionContent = multiReaction ? (
                        <>
                            <span style={{position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", transform: backFlameTransform, filter: flameOutline}}>
                                {reactionEmoji}
                            </span>
                            <span style={{position: "relative", zIndex: 1, filter: flameOutline}}>{reactionEmoji}</span>
                        </>
                    ) : <span style={{filter: flameOutline}}>{reactionEmoji}</span>;

                    const expirationType = msgBody?.expirationType;

                    const albumViewableUntil = isAlbumMessage ? msgBody?.viewableUntil : null;
                    const mediaExpiresAt = !isAlbumMessage ? (msgBody?.expiresAt || msgBody?.expiresat) : null;

                    const rawExpiresAt = albumViewableUntil || mediaExpiresAt;
                    let expiresAt = Number(rawExpiresAt || 0);
                    if (expiresAt > 0 && expiresAt < 100_000_000_000) expiresAt *= 1000;
                    const totalLifetimeSec = expiresAt > 0 ? Math.round((expiresAt - message.timestamp) / 1000) : 0;

                    const isIndefinite =
                        expirationType === "INDEFINITE" ||
                        expirationType === 0 ||
                        (typeof expirationType === "string" && expirationType.toUpperCase() === "INDEFINITE");

                    const isLastMessage = message.messageId === lastMessageId;
                    const isLatestShare = albumId ? latestMessageIdByAlbum.get(albumId) === message.messageId : true;

                    const isOnce = !isIndefinite && (
                        expirationType === "ONCE" ||
                        expirationType === 1 ||
                        message.type === "ExpiringAlbumV2" ||
                        (totalLifetimeSec > 1700 && totalLifetimeSec < 1900)
                    );

                    const isExpiringMedia = isAlbumMessage && !isIndefinite && isLatestShare && (expiresAt > 0 || isOnce);

                    // A cached album stays open-able regardless of what the live
                    // message body currently says about viewability/expiry —
                    // that's the whole point of capturing it durably.
                    const isLocked =
                        isAlbumMessage &&
                        !isAlbumCachedForMessage &&
                        (!isLatestShare || !msgBody?.isViewable);
                    // Same expiry signal as isLocked, but for the case where it's
                    // only avoided because we have a durable local copy — flag
                    // that so it's clear the live share is actually gone. Suppressed
                    // once the album has been shared again (its latest share is
                    // viewable), even for older messages referencing the same album.
                    //
                    // isAlbumKnownRevoked is checked first: it comes from a
                    // session-scoped in-memory set populated the moment a 403/404
                    // is returned by the album API, which happens well before the
                    // next thread-messages poll can update isViewable in the
                    // message body. albumActivelyShared is skipped if the revoked
                    // flag is already set, so the badge appears immediately on
                    // revocation rather than only after the next poll.
                    const isAlbumLiveAgain =
                        albumId != null &&
                        !isAlbumKnownRevoked(albumId) &&
                        albumActivelyShared.get(albumId) === true;
                    const isCachedExpiredAlbum =
                        isAlbumMessage &&
                        isAlbumCachedForMessage &&
                        !isArchived &&
                        !isAlbumLiveAgain &&
                        (!isLatestShare || !msgBody?.isViewable);

                    return (
                    <Fragment key={message.messageId}>
                        <div
                            data-message-id={message.messageId}
                            ref={(element) => {
                                if (element) {
                                    messageElementRefs.current.set(
                                        message.messageId,
                                        element,
                                    );
                                } else {
                                    messageElementRefs.current.delete(message.messageId);
                                }
                            }}
                            className={`relative flex w-full ${mine ? "justify-end" : "justify-start"} ${isLastMessage && !mine ? "pb-6" : ""}`}
                        // pan-y would also veto WebKit's horizontal edge-swipe-back on iOS;
                        // the scroller is overflow-x-hidden, so nothing else pans sideways.
                        style={onIos ? undefined : { touchAction: "pan-y" }}
                        onTouchStart={(event) => handleMobileTouchStart(event, message)}
                        onTouchEnd={handleMobileTouchEnd}
                        onTouchCancel={handleMobileTouchCancel}
                        onTouchMove={(event) => handleMobileTouchMove(event, message)}
                        >
                            <div
                                ref={(el) => { if (el) swipeIconRef.current.set(message.messageId, el); else swipeIconRef.current.delete(message.messageId); }}
                                className="pointer-events-none absolute left-2 top-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-3)]"
                                style={{ opacity: 0, transform: "translateY(-50%) scale(0.5)" }}
                            >
                                <Reply className="h-4 w-4 text-[var(--text-muted)]" />
                            </div>
                            <div
                                ref={(el) => { if (el) swipeElRef.current.set(message.messageId, el); else swipeElRef.current.delete(message.messageId); }}
                                className={`flex flex-col ${mine ? "items-end" : "items-start"} ${message.type === "Giphy" ? "max-w-80" : "max-w-[85%]"}`}
                            >
                                <div
                                    onDoubleClick={isDesktop ? () => void handleMessageTap(message) : undefined}
                                    onClick={!isDesktop ? (e) => {
                                        // If the tap originated from a child media button or video element,
                                        // that element already called scheduleMobileTap with its own open
                                        // action — don't overwrite the pending tap with a no-op here.
                                        if ((e.target as HTMLElement).closest("button,video")) return;
                                        scheduleMobileTap(message, null);
                                    } : undefined}
                                    onContextMenu={(event) => {
                                        event.preventDefault();
                                        if (!isDesktop || pending || isLocalClientMessageId(message.messageId)) return;
                                        setContextMenuState({ messageId: message.messageId, x: event.clientX, y: event.clientY });
                                    }}
                                    className={`relative group/bubble w-full rounded-2xl text-base no-touch-callout ${
                                        isMediaOnlyBubble && hasReply
                                            ? `p-0 ${mine ? "rounded-br-[3px]" : "rounded-bl-[3px]"}`
                                            : isMediaOnlyBubble
                                                ? "bg-transparent p-0"
                                                : `px-3 py-2 ${
                                                    mine
                                                        ? "bg-[var(--accent)] text-[var(--accent-contrast)] rounded-br-[3px]"
                                                        : "bg-[var(--surface-2)] text-[var(--text)] rounded-bl-[3px]"
                                                }`
                                    } ${isActiveSearchMatch ? "ring-2 ring-[var(--accent)]" : ""} ${highlightedMessageId === message.messageId ? (mine ? "animate-jump-highlight-mine" : "animate-jump-highlight-other") : ""} ${(localOnly || isCachedExpiredAlbum) ? "opacity-50" : ""}`}
                                >
                                    <div className={isMediaOnlyBubble && hasReply ? `overflow-hidden rounded-2xl ${mine ? "rounded-br-[3px]" : "rounded-bl-[3px]"}` : "contents"}>
                                    {message.type !== "ProfilePhotoReply" && (replyText || replyThumbUrl || replyVideoUrl || replyIsAudio || hasReply) ? (
                                        <div className={isMediaOnlyBubble && hasReply
                                            ? `relative w-full p-3 ${mine ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-[var(--surface-2)] text-[var(--text)]"}`
                                            : "contents"
                                        }>
                                        <div
                                            onClick={(event) => {
                                                // A reply to an album photo quotes that photo, not a chat
                                                // message: open the album at it. The album belongs to the
                                                // side that did not send the reply.
                                                if (ownAlbumContentTarget) {
                                                    event.stopPropagation();
                                                    const target = ownAlbumContentTarget;
                                                    const open = () => void openAlbumViewerById(target.albumId, !mine, target.contentId);
                                                    if (isDesktop) { open(); return; }
                                                    if (messageLongPressTriggeredRef.current) { messageLongPressTriggeredRef.current = false; return; }
                                                    scheduleMobileTap(message, open);
                                                    return;
                                                }
                                                if (!replyToMsgId) return;
                                                event.stopPropagation();
                                                onJumpToMessage(replyToMsgId);
                                            }}
                                            className={`relative flex overflow-hidden text-xs ${replyToMsgId || ownAlbumContentTarget ? "cursor-pointer active:opacity-70" : ""} ${
                                            isMediaOnlyBubble && hasReply
                                                ? `rounded-[6px] ${mine ? "bg-black/20" : "bg-black/[0.08]"}`
                                                : isMediaOnlyBubble
                                                ? `mx-3 mt-3 mb-3 rounded-[6px] ${mine ? "bg-black/20" : "bg-black/[0.08]"}`
                                                : `mt-1 mb-2.5 rounded-[6px] ${mine ? "bg-black/20" : "bg-black/[0.08]"}`
                                        }`}>
                                            <div className={`absolute left-0 top-0 h-full w-[3px] shrink-0 ${
                                                mine ? "bg-white/60" : "bg-[var(--accent)]/50"
                                            }`} />
                                            <div className="min-w-0 flex-1 py-[13px] pl-[13px] pr-2.5">
                                                <p className="mb-0.5 font-semibold opacity-60 truncate">{replyLabel}</p>
                                                <p className="line-clamp-2 break-words opacity-80">{replyText ?? replyDescription}</p>
                                            </div>
                                            {replyThumbUrl ? (
                                                <div className="relative w-14 shrink-0 self-stretch overflow-hidden">
                                                    <img
                                                        src={proxyMediaUrl(replyThumbUrl)}
                                                        alt=""
                                                        className={`absolute inset-0 h-full w-full object-cover [clip-path:inset(0)]${blurIncomingMedia && (replyToMsg?.type ?? replyToMsgRef?.type) !== "Giphy" ? " blur-md transition" : ""}`}
                                                    />
                                                </div>
                                            ) : replyVideoUrl ? (
                                                <div className="relative w-14 shrink-0 self-stretch overflow-hidden bg-black">
                                                    <div className="js-video-spinner pointer-events-none absolute inset-0 flex items-center justify-center">
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white/60" />
                                                    </div>
                                                    <video
                                                        muted
                                                        preload="metadata"
                                                        src={proxyMediaUrl(replyVideoUrl, { as: "video" })}
                                                        onLoadedMetadata={(e) => { (e.currentTarget as HTMLVideoElement).currentTime = 0.001; }}
                                                        onSeeked={(e) => {
                                                            const el = e.currentTarget;
                                                            el.style.opacity = "1";
                                                            const parent = el.parentElement;
                                                            const spinner = parent?.querySelector<HTMLElement>(".js-video-spinner");
                                                            if (spinner) spinner.style.display = "none";
                                                            const badge = parent?.querySelector<HTMLElement>(".js-video-play-badge");
                                                            if (badge) badge.style.opacity = "1";
                                                        }}
                                                        className={`absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-200 [clip-path:inset(0)]${blurIncomingMedia ? " blur-md transition" : ""}`}
                                                    />
                                                    <div className="js-video-play-badge pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200">
                                                        <Play className="h-3.5 w-3.5 fill-white text-white drop-shadow" />
                                                    </div>
                                                </div>
                                            ) : replyIsAudio ? (
                                                <div className={`flex w-14 shrink-0 items-center justify-end py-2.5 pr-3 ${mine ? "opacity-80" : "opacity-60"}`}>
                                                    <div className="flex flex-col items-center gap-1">
                                                        <Mic className="h-4 w-4" />
                                                        <span className="text-[10px] opacity-80">{replyAudioDuration ?? "0:00"}</span>
                                                    </div>
                                                </div>
                                            ) : replyLocation ? (
                                                <div className="relative w-14 shrink-0 self-stretch overflow-hidden bg-[var(--surface-2)]">
                                                    <MapLocationPreview lat={replyLocation.lat} lon={replyLocation.lon} zoom={14} marker={false} className="pointer-events-none absolute inset-0" />
                                                    {/* A small pin with its tip on the centered spot (the map's own is too big here). */}
                                                    <MapPinFilled className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-[85%] text-[var(--accent)] drop-shadow" />
                                                </div>
                                            ) : null}
                                        </div>
                                        {isMediaOnlyBubble && hasReply ? <div className="pointer-events-none absolute inset-x-0 top-full h-6 z-10 bg-gradient-to-b from-black/25 to-transparent" /> : null}
                                        </div>
                                    ) : null}

                                    {imageUrl ? (
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            {...mediaTapProps((tile) => {
                                                // Read when the viewer actually opens (a mobile tap waits for a
                                                // possible double-tap first), so the hero starts where it is then.
                                                const getHeroRect = () => getHeroRectFromElement(tile);
                                                if (isDesktop) {
                                                    openFullScreenImage(imageUrl, {
                                                        takenOnGrindr: messageTakenOnGrindr,
                                                        createdAt: imageCreatedAt,
                                                        createdAtLabel: imageCreatedAtLabel,
                                                        timestamp: message.timestamp,
                                                    }, "image", message.messageId, Number(message.senderId), getHeroRect());
                                                    return;
                                                }
                                                if (messageLongPressTriggeredRef.current) {
                                                    messageLongPressTriggeredRef.current = false;
                                                    return;
                                                }
                                                if (shouldBlurIncomingMedia) {
                                                    revealMediaMessage(message.messageId);
                                                    lastTapRef.current = null;
                                                    return;
                                                }
                                                scheduleMobileTap(message, () => {
                                                    openFullScreenImage(imageUrl, {
                                                        takenOnGrindr: messageTakenOnGrindr,
                                                        createdAt: imageCreatedAt,
                                                        createdAtLabel: imageCreatedAtLabel,
                                                        timestamp: message.timestamp,
                                                    }, "image", message.messageId, Number(message.senderId), getHeroRect());
                                                });
                                            })}
                                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.currentTarget.click(); }}
                                            className={`group/media ${isImageOnlyBubble ? `block w-full overflow-hidden ${hasReply ? "" : `rounded-2xl ${tailCorner}`}` : "mb-2 block overflow-hidden rounded-xl border border-black/10"}`}
                                            onMouseEnter={() => handleMediaMouseEnter(message.messageId)}
                                            onMouseLeave={() => handleMediaMouseLeave(message.messageId)}
                                        >
                                            <div className="relative">
                                            <img
                                                src={proxyMediaUrl(imageUrl)}
                                                alt={t("chat.thread.shared_alt")}
                                                className={`${message.type === "Giphy" && hasReply ? "max-h-96 w-full object-cover" : isImageOnlyBubble ? "max-h-80 w-full object-cover" : "max-h-64 w-full object-cover"} ${PRIVACY_BLUR_TRANSITION_CLASS} ${mediaBlurClassName}`}
                                            />
                                            {isExpiringImage ? (
                                                <MediaBadge icon={<Eye className="h-3.5 w-3.5" />} label={t("chat.attachments.view_once")} />
                                            ) : message.type === "Giphy" ? (
                                                <MediaBadge icon={<ImagePlay className="h-3.5 w-3.5" />} label="GIF" />
                                            ) : null}
                                            {messageTakenOnGrindr ? (
                                                <>
                                                    <style>{`
                                                        @keyframes logo-shine { 0%, 100% { filter: drop-shadow(0 0 2px rgba(255,140,0,0.3)) brightness(1); } 50% { filter: drop-shadow(0 0 7px rgba(255,140,0,0.95)) brightness(1.25); } }
                                                        .logo-shine { animation: logo-shine 2.8s ease-in-out infinite; }
                                                    `}</style>
                                                    {/* Image-only bubbles render it in the footer row, level with the time. */}
                                                    {!isImageOnlyBubble ? (
                                                        <div className="absolute bottom-1.5 left-2.5 z-10">
                                                            <TakenOnGrindrBadge
                                                                label={imageCreatedAt != null ? formatTakenOnGrindrTime(imageCreatedAt, nowTimestamp, t) : null}
                                                            />
                                                        </div>
                                                    ) : null}
                                                </>
                                            ) : null}

                                                {isImageOnlyBubble ? (
                                                    <div className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 py-2 text-white">
                                                        {(expiresAt > Date.now() || isOnce) && isExpiringMedia && (
                                                            <AlbumExpirationCountdown
                                                                expiresAt={expiresAt}
                                                                isOnce={isOnce}
                                                                t={t}
                                                            />
                                                        )}

                                                        <div className="flex items-center justify-between gap-2 text-[10px]">
                                                            <div className="flex items-center gap-2">
                                                                {messageTakenOnGrindr ? (
                                                                    <TakenOnGrindrBadge
                                                                        label={imageCreatedAt != null ? formatTakenOnGrindrTime(imageCreatedAt, nowTimestamp, t) : null}
                                                                    />
                                                                ) : null}
                                                                {pending ? <span>{t("chat.sending")}</span> : null}
                                                                {failed ? <span>{t("chat.thread.failed")}</span> : null}
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {localOnly ? (
                                                                    <span title={t("chat.thread.from_local_history")}><History className="h-3 w-3 opacity-80" /></span>
                                                                ) : null}
                                                                <span>
                                                                    {formatMessageTime(message.timestamp, nowTimestamp, t)}
                                                                </span>
                                                                {isDesktop &&
                                                                !pending &&
                                                                !isLocalClientMessageId(message.messageId) ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            setContextMenuState({ messageId: message.messageId, x: event.clientX, y: event.clientY });
                                                                        }}
                                                                        className="rounded-md p-1 hover:bg-white/10"
                                                                    >
                                                                        <MoreVertical className="h-3.5 w-3.5" />
                                                                    </button>
                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                    ) : null}

                                    {isAlbumOnlyBubble ? (
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                if (isDesktop) {
                                                    if (albumId && !isLocked) void openAlbumViewerById(albumId, mine);
                                                    return;
                                                }
                                                if (messageLongPressTriggeredRef.current) {
                                                    messageLongPressTriggeredRef.current = false;
                                                    return;
                                                }
                                                scheduleMobileTap(message, () => {
                                                    if (albumId && !isLocked) void openAlbumViewerById(albumId, mine);
                                                });
                                            }}
                                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.currentTarget.click(); }}
                                            className={`group/media block w-full overflow-hidden rounded-2xl ${tailCorner}`}
                                            onMouseEnter={() => handleMediaMouseEnter(message.messageId)}
                                            onMouseLeave={() => handleMediaMouseLeave(message.messageId)}
                                        >
                                            <div className={`relative h-56 w-64 max-w-full overflow-hidden rounded-2xl ${tailCorner} bg-[var(--surface-2)] sm:w-72`}>
                                                <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
                                                    <Album className="h-8 w-8 opacity-60" />
                                                </div>
                                                {albumCover ? (
                                                    <img
                                                        key={albumCover}
                                                        src={proxyMediaUrl(albumCover)}
                                                        alt={t("chat.thread.album_cover")}
                                                        className={`absolute inset-0 h-full w-full scale-110 object-cover transition-transform duration-500 ease-out ${isLocked ? "blur-sm opacity-50" : "group-hover/media:scale-[1.16]"}`}
                                                    />
                                                ) : null}

                                                {isLocked && (
                                                    <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl ${tailCorner} bg-black/50 backdrop-blur-[15px]`}>
                                                        <Lock className="h-10 w-10 text-white/90 drop-shadow-lg" />
                                                        <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-white/90 drop-shadow">
                                                            {t("chat.expiration.expired")}
                                                        </span>
                                                    </div>
                                                )}

                                                <MediaBadge icon={<Album className="h-3.5 w-3.5" />} label={t("chat.thread.album_label")} />

                                                {!isLocked && (
                                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-md transition group-hover/media:scale-105 group-hover/media:bg-white/25">
                                                            <Images className="h-5 w-5 drop-shadow" />
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-2 pt-10 text-white">
                                                    {!isLocked && isExpiringMedia && (expiresAt > Date.now() || isOnce) && (
                                                        <AlbumExpirationCountdown
                                                            expiresAt={expiresAt}
                                                            isOnce={isOnce}
                                                            t={t}
                                                            className="mb-0.5"
                                                        />
                                                    )}
                                                    {albumName ? (
                                                        <p className="truncate text-sm font-semibold leading-tight drop-shadow">
                                                            {albumName}
                                                        </p>
                                                    ) : null}
                                                    <div className="flex items-center justify-between gap-2 text-[11px]">
                                                        <div className="flex min-w-0 items-center gap-2.5 font-medium text-white/90">
                                                            {albumMediaCount && (albumMediaCount.images > 0 || albumMediaCount.videos === 0) ? (
                                                                <span className="inline-flex items-center gap-1 tabular-nums" title={t("chat.thread.album_photo_count", { count: albumMediaCount.images })}>
                                                                    <Images className="h-3.5 w-3.5" />
                                                                    {albumMediaCount.images}
                                                                </span>
                                                            ) : null}
                                                            {albumMediaCount && albumMediaCount.videos > 0 ? (
                                                                <span className="inline-flex items-center gap-1 tabular-nums" title={t("chat.thread.album_video_count", { count: albumMediaCount.videos })}>
                                                                    <Video className="h-3.5 w-3.5" />
                                                                    {albumMediaCount.videos}
                                                                </span>
                                                            ) : null}
                                                            {pending ? <span>{t("chat.sending")}</span> : null}
                                                            {failed ? <span>{t("chat.thread.failed")}</span> : null}
                                                        </div>
                                                        <div className="flex shrink-0 items-center gap-2 text-[10px] text-white/80">
                                                            {(localOnly || isCachedExpiredAlbum) ? (
                                                                <span title={t("chat.thread.from_local_history")}><History className="h-3 w-3 opacity-80" /></span>
                                                            ) : null}
                                                            <span>
                                                                {formatMessageTime(message.timestamp, nowTimestamp, t)}
                                                            </span>
                                                            {isDesktop && !pending && !isLocalClientMessageId(message.messageId) ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        setContextMenuState({ messageId: message.messageId, x: event.clientX, y: event.clientY });
                                                                    }}
                                                                    className="rounded-md p-1 hover:bg-white/10"
                                                                >
                                                                    <MoreVertical className="h-3.5 w-3.5" />
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

                                        {gaymojiUrl ? (
                                            <img
                                                src={proxyMediaUrl(gaymojiUrl)}
                                                alt="Gaymoji"
                                                className="h-20 w-20 object-contain"
                                            />
                                        ) : null}

                                        {isExpiredImage ? (
                                            <div className={`relative flex items-center justify-center overflow-hidden bg-[var(--surface-2)] ${isImageOnlyBubble ? `w-full ${hasReply ? "" : `rounded-2xl ${tailCorner}`}` : "mb-2 rounded-xl border border-black/10"}`} style={{ minHeight: "12rem", minWidth: "12rem" }}>
                                                <div className="flex flex-col items-center gap-1.5 text-[var(--text-muted)]">
                                                    <ImageOff className="h-6 w-6" />
                                                    <span className="text-xs font-medium">{t("chat.thread.image_expired")}</span>
                                                </div>
                                                {isImageOnlyBubble && (
                                                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 px-3 py-2 text-[10px] text-[var(--text-muted)]">
                                                        <span>{formatMessageTime(message.timestamp, nowTimestamp, t)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        ) : null}

                                        {isExpiredVideo ? (
                                            <div className={`relative flex items-center justify-center overflow-hidden bg-[var(--surface-2)] ${isVideoOnlyBubble ? `w-full ${hasReply ? "" : `rounded-2xl ${tailCorner}`}` : "mb-2 rounded-xl border border-black/10"}`} style={{ minHeight: "12rem", minWidth: "16rem" }}>
                                                <div className="flex flex-col items-center gap-1.5 text-[var(--text-muted)]">
                                                    <VideoOff className="h-6 w-6" />
                                                    <span className="text-xs font-medium">{t("chat.thread.video_expired")}</span>
                                                </div>
                                                {isVideoOnlyBubble && (
                                                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 px-3 py-2 text-[10px] text-[var(--text-muted)]">
                                                        <span>{formatMessageTime(message.timestamp, nowTimestamp, t)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        ) : null}
                                        
                                        {videoUrl ? (() => {
                                            const videoMaxViews = typeof msgBody?.maxViews === "number" ? msgBody.maxViews : 2147483647;
                                            // Unlimited videos are sent with MAX_VIDEO_VIEWS, older ones with 2147483647.
                                            const isLimitedVideo = videoMaxViews < MAX_VIDEO_VIEWS;
                                            return (
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`group/media relative block overflow-hidden bg-black ${
                                                        isVideoOnlyBubble
                                                            ? `w-full ${hasReply ? "" : `rounded-2xl ${tailCorner}`}`
                                                            : `mb-2 rounded-xl border border-black/10 ${shouldBlurIncomingMedia ? "cursor-pointer" : ""}`
                                                    }`}
                                                    onMouseEnter={() => handleMediaMouseEnter(message.messageId)}
                                                    onMouseLeave={() => handleMediaMouseLeave(message.messageId)}
                                                    {...mediaTapProps((tile) => {
                                                        if (shouldBlurIncomingMedia && !isDesktop) {
                                                            revealMediaMessage(message.messageId);
                                                            lastTapRef.current = null;
                                                            return;
                                                        }
                                                        // Same hero open as images, read when the viewer opens.
                                                        const getHeroRect = () => getHeroRectFromElement(tile);
                                                        if (isDesktop) {
                                                            openFullScreenImage(videoUrl, undefined, "video", message.messageId, Number(message.senderId), getHeroRect());
                                                            return;
                                                        }
                                                        if (messageLongPressTriggeredRef.current) {
                                                            messageLongPressTriggeredRef.current = false;
                                                            return;
                                                        }
                                                        scheduleMobileTap(message, () => {
                                                            openFullScreenImage(videoUrl, undefined, "video", message.messageId, Number(message.senderId), getHeroRect());
                                                        });
                                                    })}
                                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.currentTarget.click(); }}
                                                >
                                                    <div className="js-video-spinner pointer-events-none absolute inset-0 flex items-center justify-center">
                                                        <Loader2 className="h-5 w-5 animate-spin text-white/60" />
                                                    </div>
                                                    <video
                                                        preload="metadata"
                                                        muted
                                                        src={proxyMediaUrl(videoUrl, { as: "video" })}
                                                        onLoadedMetadata={(e) => { (e.currentTarget as HTMLVideoElement).currentTime = 0.001; }}
                                                        onSeeked={(e) => {
                                                            const el = e.currentTarget;
                                                            el.style.opacity = "1";
                                                            const parent = el.parentElement;
                                                            const spinner = parent?.querySelector<HTMLElement>(".js-video-spinner");
                                                            if (spinner) spinner.style.display = "none";
                                                            const badge = parent?.querySelector<HTMLElement>(".js-video-play-badge");
                                                            if (badge) badge.style.opacity = "1";
                                                        }}
                                                        className={`w-full object-cover opacity-0 ${PRIVACY_BLUR_TRANSITION_CLASS} ${isVideoOnlyBubble ? "max-h-80" : "max-h-64"} ${mediaBlurClassName}`}
                                                    />
                                                    {isLimitedVideo && (
                                                        videoMaxViews === 1 ? (
                                                            <MediaBadge icon={<Eye className="h-3.5 w-3.5" />} label={t("chat.attachments.view_once")} />
                                                        ) : (
                                                            <MediaBadge icon={<Repeat2 className="h-3.5 w-3.5" />} label={t("chat.attachments.replay")} />
                                                        )
                                                    )}
                                                    <div
                                                        className={`js-video-play-badge pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200`}
                                                    >
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition group-hover/media:bg-black/80">
                                                            <Play className="h-5 w-5 fill-white text-white" />
                                                        </div>
                                                    </div>
                                                    {isVideoOnlyBubble && (
                                                        <div className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 py-2 text-white">
                                                            <div className="flex items-center justify-between gap-2 text-[10px]">
                                                                <div className="flex items-center gap-2">
                                                                    {pending ? <span>{t("chat.sending")}</span> : null}
                                                                    {failed ? <span>{t("chat.thread.failed")}</span> : null}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    {localOnly ? (
                                                                        <span title={t("chat.thread.from_local_history")}><History className="h-3 w-3 opacity-80" /></span>
                                                                    ) : null}
                                                                    <span>{formatMessageTime(message.timestamp, nowTimestamp, t)}</span>
                                                                    {isDesktop && !pending && !isLocalClientMessageId(message.messageId) ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                setContextMenuState({ messageId: message.messageId, x: event.clientX, y: event.clientY });
                                                                            }}
                                                                            className="rounded-md p-1 hover:bg-white/10"
                                                                        >
                                                                            <MoreVertical className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })() : null}

                                    {audioUrl ? (() => {
                                        const audioBody = message.body as Record<string, unknown> | null | undefined;
                                        const audioLengthRaw = typeof audioBody?.length === "number" ? audioBody.length : null;
                                        // >600: stored in ms (iOS audio/aac); <=600: stored in seconds (webm upload endpoint)
                                        const audioDurationHint = audioLengthRaw != null
                                            ? (audioLengthRaw > 600 ? audioLengthRaw / 1000 : audioLengthRaw)
                                            : undefined;
                                        //console.log("[audio message]", { messageId: message.messageId, body: audioBody, audioLengthRaw, audioDurationHint });
                                        return (
                                            <div onClick={(e) => e.stopPropagation()}>
                                                <AudioMessagePlayer
                                                    src={audioUrl}
                                                    messageId={message.messageId}
                                                    mine={mine}
                                                    durationHint={audioDurationHint}
                                                />
                                            </div>
                                        );
                                    })() : null}

                                    {isAlbumReactionBubble ? (() => {
                                        const rxBody = message.body as Record<string, unknown> | null | undefined;
                                        const rxTarget = getAlbumContentReplyTarget(message);
                                        const rxCachedThumbUri = rxTarget
                                            ? getCachedAlbumContentThumbUri(rxTarget.albumId, rxTarget.contentId)
                                            : null;
                                        const rxPreviewUrl = rxCachedThumbUri
                                            ?? (typeof rxBody?.previewUrl === "string" ? rxBody.previewUrl : null);
                                        const rxAlbumId = typeof rxBody?.albumId === "number" ? rxBody.albumId : null;
                                        const rxLabel = mine
                                            ? t("chat.preview.tapped_album_photo_theirs")
                                            : t("chat.preview.tapped_album_photo_yours");
                                        return (
                                            <>
                                                <button
                                                    type="button"
                                                    className={`group/media relative block overflow-hidden rounded-2xl ${tailCorner} ${isDesktop ? "w-full" : "w-36"}`}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (!rxAlbumId) return;
                                                        // Reacting/replying to your own album doesn't happen — the
                                                        // album this bubble points at always belongs to whichever
                                                        // side did NOT send the reaction/reply message.
                                                        if (isDesktop) { void openAlbumViewerById(rxAlbumId, !mine, rxTarget?.contentId); return; }
                                                        if (messageLongPressTriggeredRef.current) { messageLongPressTriggeredRef.current = false; return; }
                                                        if (shouldBlurIncomingMedia && rxPreviewUrl) {
                                                            revealMediaMessage(message.messageId);
                                                            lastTapRef.current = null;
                                                            return;
                                                        }
                                                        scheduleMobileTap(message, () => void openAlbumViewerById(rxAlbumId, !mine, rxTarget?.contentId));
                                                    }}
                                                    onMouseEnter={() => handleMediaMouseEnter(message.messageId)}
                                                    onMouseLeave={() => handleMediaMouseLeave(message.messageId)}
                                                >
                                                    {rxPreviewUrl ? (
                                                        <img src={proxyMediaUrl(rxPreviewUrl)} alt="" className={`aspect-square w-full object-cover ${PRIVACY_BLUR_TRANSITION_CLASS} ${mediaBlurClassName}`} />
                                                    ) : (
                                                        <div className="h-48 w-full bg-[var(--surface-2)]" />
                                                    )}
                                                    <div className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 py-2 text-white">
                                                        <div className="flex items-center justify-between gap-2 text-[10px]">
                                                            <div className="flex items-center opacity-90">
                                                                <Album className="h-3 w-3 shrink-0" />
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {localOnly ? (
                                                                    <span title={t("chat.thread.from_local_history")}><History className="h-3 w-3 opacity-80" /></span>
                                                                ) : null}
                                                                <span>{formatMessageTime(message.timestamp, nowTimestamp, t)}</span>
                                                                {isDesktop && !pending && !isLocalClientMessageId(message.messageId) ? (
                                                                    <button type="button" onClick={(e) => { e.stopPropagation(); setContextMenuState({ messageId: message.messageId, x: e.clientX, y: e.clientY }); }} className="rounded-md p-1 hover:bg-white/10">
                                                                        <MoreVertical className="h-3.5 w-3.5" />
                                                                    </button>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </button>
                                                <p className={`mt-1 text-xs opacity-60 ${mine ? "text-right" : "text-left"}`}>{rxLabel}</p>
                                            </>
                                        );
                                    })() : null}

                                    {location ? (
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                const url = isDesktop
                                                    ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lon}`
                                                    : isIos()
                                                    ? `https://maps.apple.com/?ll=${location.lat},${location.lon}&q=${location.lat},${location.lon}`
                                                    : `geo:${location.lat},${location.lon}?q=${location.lat},${location.lon}`;
                                                const doOpen = () => {
                                                    openUrl(url).catch((error) => {
                                                        appLog.error("Failed to open map URL", error);
                                                        window.open(url, "_blank");
                                                    });
                                                };
                                                if (isDesktop) { doOpen(); return; }
                                                if (messageLongPressTriggeredRef.current) {
                                                    messageLongPressTriggeredRef.current = false;
                                                    return;
                                                }
                                                scheduleMobileTap(message, doOpen);
                                            }}
                                            className={`block overflow-hidden ${isLocationOnlyBubble && hasReply ? "" : `rounded-2xl ${tailCorner}`} text-left transition hover:brightness-110`}
                                        >
                                            <div className="relative">
                                                <MapLocationPreview lat={location.lat} lon={location.lon} className="h-48 w-48 pointer-events-none" />
                                                {isLocationOnlyBubble ? (
                                                    <div className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 py-2 text-white">
                                                        <div className="flex items-center justify-between gap-2 text-[10px]">
                                                            <div className="flex items-center gap-2">
                                                                {pending ? <span>{t("chat.sending")}</span> : null}
                                                                {failed ? <span>{t("chat.thread.failed")}</span> : null}
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {localOnly ? (
                                                                    <span title={t("chat.thread.from_local_history")}><History className="h-3 w-3 opacity-80" /></span>
                                                                ) : null}
                                                                <span>{formatMessageTime(message.timestamp, nowTimestamp, t)}</span>
                                                                {isDesktop && !pending && !isLocalClientMessageId(message.messageId) ? (
                                                                    <>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                setContextMenuState({ messageId: message.messageId, x: event.clientX, y: event.clientY });
                                                                            }}
                                                                            className="rounded-md p-1 hover:bg-white/10"
                                                                        >
                                                                            <MoreVertical className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    </>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </button>
                                    ) : null}

                                    {isAlbumMessage && !isAlbumOnlyBubble ? (
                                        <div className={`relative mb-2 rounded-xl border border-black/10 p-2 ${isLocked ? "bg-[var(--surface-2)] opacity-60" : "bg-[color-mix(in_srgb,var(--surface)_76%,transparent)]"} ${(localOnly || isCachedExpiredAlbum) ? "opacity-50" : ""}`}>
                                            {albumCover ? (
                                                <img
                                                    src={proxyMediaUrl(albumCover)}
                                                    alt={t("chat.thread.album_cover")}
                                                    className={`mb-2 h-36 w-full rounded-lg object-cover ${isLocked ? "blur-[2px] opacity-50" : ""}`}
                                                />
                                            ) : null}
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-medium">
                                                    {isLocked ? (
                                                        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                                                            <Lock className="h-3.5 w-3.5" />
                                                            {t("chat.expiration.expired")}
                                                        </div>
                                                    ) : t("chat.thread.album_share")}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (albumId) void openAlbumViewerById(albumId, mine);
                                                    }}
                                                    className="rounded-md border border-black/20 px-2 py-1 text-[11px]"
                                                    disabled={!albumId || isLocked}
                                                >
                                                    {t("chat.open")}
                                                </button>
                                            </div>
                                            {!isLocked && isExpiringMedia && (expiresAt > Date.now() || isOnce) && (
                                                <AlbumExpirationCountdown
                                                    expiresAt={expiresAt}
                                                    isOnce={isOnce}
                                                    t={t}
                                                />
                                            )}
                                        </div>
                                    ) : null}

                                    {message.type === "ProfilePhotoReply" ? (() => {
                                        const hashTarget = getReplyImageHashTarget(message);
                                        const cachedPhotoUri = hashTarget ? getCachedMediaUri(hashTarget.mediaKey) : null;
                                        const body = message.body as Record<string, unknown> | null | undefined;
                                        const hash = typeof body?.imageHash === "string" ? body.imageHash : null;
                                        const photoUrl = cachedPhotoUri ?? (hash ? getThumbImageUrl(hash, "320x320") : null);
                                        // Full size when the photo is still live; the cached thumb otherwise.
                                        const fullPhotoUrl = hash ? getProfileImageUrl(hash, "1024x1024") : photoUrl;
                                        return (
                                            <div
                                                role={fullPhotoUrl ? "button" : undefined}
                                                onClick={fullPhotoUrl ? (event) => {
                                                    event.stopPropagation();
                                                    const tile = event.currentTarget;
                                                    // Our reply quotes their photo, theirs one of ours.
                                                    const open = () => hash
                                                        ? openProfilePhotos(hash, mine, getHeroRectFromElement(tile))
                                                        : openFullScreenImage(fullPhotoUrl, undefined, "image", undefined, undefined, getHeroRectFromElement(tile));
                                                    if (isDesktop) { open(); return; }
                                                    if (messageLongPressTriggeredRef.current) { messageLongPressTriggeredRef.current = false; return; }
                                                    scheduleMobileTap(message, open);
                                                } : undefined}
                                                className={`relative mb-2.5 mt-1 flex overflow-hidden rounded-[6px] text-xs ${fullPhotoUrl ? "cursor-pointer active:opacity-70" : ""} ${mine ? "bg-black/20" : "bg-black/[0.08]"}`}
                                            >
                                                <div className={`absolute left-0 top-0 h-full w-[3px] shrink-0 ${mine ? "bg-white/60" : "bg-[var(--accent)]/50"}`} />
                                                <div className="min-w-0 flex-1 py-[13px] pl-[13px] pr-2.5">
                                                    <p className="mb-0.5 font-semibold opacity-60 truncate">{mine
                                                        ? t("chat.thread.replied_to_name", {
                                                                name: localNickname || selectedConversation.data.name || t("common.unknown_display_name"),
                                                            })
                                                        : t("chat.thread.replied_to_myself")}</p>
                                                    <p className="opacity-60">{t("chat.thread.profile_photo")}</p>
                                                </div>
                                                {photoUrl && (
                                                    <div className="relative w-14 shrink-0 self-stretch overflow-hidden">
                                                        <ProfileImage
                                                            src={photoUrl}
                                                            alt=""
                                                            className="absolute inset-0 object-top"
                                                            iconClassName="h-5 w-5"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })() : null}

                                    {!isMediaOnlyBubble && !isAudioOnlyBubble && !gaymojiUrl
                                    && !(imageUrl && (messageText === t("chat.thread.shared_image") || messageText === t("chat.thread.shared_gif")))
                                    && !((videoUrl || isExpiredVideo) && messageText === t("chat.thread.shared_video")) ? (
                                        isUnsupportedMessage ? (
                                            <div className={`relative mt-1 flex items-center gap-2.5 overflow-hidden rounded-[6px] p-[13px] text-xs ${mine ? "bg-black/20" : "bg-black/[0.08]"}`}>
                                                <MessageCircleQuestion className="h-4 w-4 shrink-0 opacity-70" />
                                                <div className="min-w-0 flex-1">
                                                    <p className="mb-0.5 font-semibold opacity-60 truncate">
                                                        {t("chat.thread.unsupported_message", {
                                                            defaultValue: "Unsupported message",
                                                        })}
                                                    </p>
                                                    <p className="line-clamp-2 break-words opacity-80">
                                                        {t("chat.thread.unsupported_message_description", {
                                                            defaultValue: "This message type isn't supported in this app version yet.",
                                                        })}
                                                    </p>
                                                </div>
                                            </div>
                                        ) : isTrulyUnsentMessage ? (
                                            <div className="flex items-center gap-1.5 italic opacity-60">
                                                <Undo2 className="h-3.5 w-3.5 shrink-0" />
                                                <p className="whitespace-pre-wrap break-words">{displayText}</p>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="whitespace-pre-wrap break-words select-text">
                                                    {renderTextWithLinks(displayText, mine, (url) => requestOpenLink(url))}
                                                </p>
                                                {translatedText ? (
                                                    <div className="mt-1.5 flex items-start gap-1.5 text-[0.9em] opacity-70">
                                                        <Languages className="mt-[0.2em] h-[1em] w-[1em] shrink-0" aria-hidden="true" />
                                                        <p className="min-w-0 whitespace-pre-wrap break-words select-text">
                                                            {renderTextWithLinks(translatedText, mine, (url) => requestOpenLink(url))}
                                                        </p>
                                                    </div>
                                                ) : isTranslating ? (
                                                    <div className="mt-1.5 flex items-center gap-1.5 text-[0.9em] opacity-70">
                                                        <Loader2 className="h-[1em] w-[1em] shrink-0 animate-spin" aria-hidden="true" />
                                                        <span>{t("auto_translate.translating", { defaultValue: "Translating…" })}</span>
                                                    </div>
                                                ) : null}
                                            </>
                                        )
                                    ) : null}
                                    </div>

                                    {!isLocalClientMessageId(message.messageId) ? (
                                        (isDesktop ? (
                                            <button
                                                type="button"
                                                ref={(el) => { if (el) reactionButtonRefs.current.set(message.messageId, el); else reactionButtonRefs.current.delete(message.messageId); }}
                                                onClick={() => void handleReact(message)}
                                                className={`${hasOtherReaction ? "group/rxn " : ""}text-lg inline-flex ${fireButtonClass} absolute z-10 transition-opacity ${
                                                    message.reactions.length > 0 || isAlbumReactionBubble ? "opacity-100" : "opacity-0 hover:opacity-25"
                                                }`}
                                            >
                                                {hasOtherReaction ? (
                                                    <>
                                                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/rxn:opacity-100 transition-opacity" style={{transform: backFlameTransform, filter: flameOutline}}>
                                                            {reactionEmoji}
                                                        </span>
                                                        <span style={{position: "relative", zIndex: 1, filter: flameOutline}}>{reactionEmoji}</span>
                                                    </>
                                                ) : reactionContent}
                                            </button>
                                        ) : (
                                            <span
                                                ref={(el) => { if (el) reactionButtonRefs.current.set(message.messageId, el); else reactionButtonRefs.current.delete(message.messageId); }}
                                                className={`text-lg inline-flex pointer-events-none ${fireButtonClass} absolute z-10 transition-opacity ${
                                                message.reactions.length > 0 || isAlbumReactionBubble ? "opacity-100" : "opacity-0"
                                            }`}>
                                                {reactionContent}
                                            </span>
                                        ))
                                    ) : null}

                                    {!isMediaOnlyBubble ? (
                                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] opacity-80">
                                        <div className="flex items-center gap-2">
                                            {pending ? <span>{t("chat.sending")}</span> : null}
                                            {failed ? <span>{t("chat.thread.failed")}</span> : null}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {localOnly ? (
                                                <span title={t("chat.thread.from_local_history")}><History className="h-3 w-3 opacity-70" /></span>
                                            ) : null}
                                            <span>
                                                {formatMessageTime(message.timestamp, nowTimestamp, t)}
                                            </span>
                                            {isDesktop &&
                                            !pending &&
                                            !isLocalClientMessageId(message.messageId) ? (
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setContextMenuState({ messageId: message.messageId, x: event.clientX, y: event.clientY });
                                                    }}
                                                    className="rounded-md p-1 hover:bg-black/10"
                                                >
                                                    <MoreVertical className="h-3.5 w-3.5" />
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                    ) : null}

                                    {failed ? (
                                        <button
                                            type="button"
                                            onClick={(event) => { event.stopPropagation(); handleRetry(message); }}
                                            className="mt-1 rounded-lg bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] px-2 py-1 text-[11px] font-semibold"
                                        >
                                            {t("chat.retry")}
                                        </button>
                                    ) : null}
                                </div>

                                {mine && !pending && !failed && lastMyMessageId === message.messageId && (
                                    // Absolutely positioned so a long label ("Read yesterday") doesn't widen the bubble column.
                                    <div className="relative h-5 w-full">
                                        <span
                                            className="absolute right-1 top-1 whitespace-nowrap text-[8px] font-medium uppercase tracking-wider text-[var(--text-muted)] opacity-80"
                                            title={
                                                threadLastReadTimestamp != null && message.timestamp <= threadLastReadTimestamp
                                                    ? t("chat.read_at", { time: formatFullDateTime(threadLastReadTimestamp) })
                                                    : undefined
                                            }
                                        >
                                            {threadLastReadTimestamp != null && message.timestamp <= threadLastReadTimestamp
                                                ? <ReadStatusRelativeTime readAt={threadLastReadTimestamp} t={t} />
                                                : t("chat.unread")}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                        </Fragment>
                    );
                        })}
                        </div>
                    </div>
                ));
            })()}
            </div>
            {isPartnerTyping && (
                <div className="flex items-end gap-2 px-4 py-1">
                    <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-[var(--surface-2)] px-3 py-2.5">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: "0ms" }} />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: "160ms" }} />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: "320ms" }} />
                    </div>
                </div>
            )}
            <div ref={threadBottomRef} className="h-3 shrink-0" />
			{reactionParticles && reactionParticles.items.map((p, i) => p.emoji ? (
				<span
					key={`rp-${reactionParticles.key}-${i}`}
					className="animate-emoji-particle-rise"
					style={{left: reactionParticles.x, top: reactionParticles.y, opacity: 0, fontSize: p.size, lineHeight: 1, zIndex: 9999, "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--dur": `${p.dur}s`, "--delay": `${p.delay}s`} as React.CSSProperties}
				>{p.emoji}</span>
			) : (
				<div
					key={`rp-${reactionParticles.key}-${i}`}
					className="animate-particle-rise"
					style={{left: reactionParticles.x, top: reactionParticles.y, opacity: 0, width: p.size, height: p.size, background: "rgba(249,115,22,0.9)", boxShadow: `0 0 ${p.size * 3}px ${p.size}px rgba(249,115,22,0.6)`, zIndex: 9999, "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--dur": `${p.dur}s`, "--delay": `${p.delay}s`} as React.CSSProperties}
				/>
			))}
			{contextMenuPresence.rendered && contextMenuTarget ? (
				<MessageContextMenu
					visible={contextMenuPresence.visible}
					x={contextMenuPresence.rendered.x}
					y={contextMenuPresence.rendered.y}
					actions={contextMenuActions}
					onClose={() => setContextMenuState(null)}
				/>
			) : null}
			<PromptDialog
				isOpen={banWordPrompt !== null}
				title={t("chat.actions.ban_word", { defaultValue: "Add forbidden keyword" })}
				message={t("chat.actions.ban_word_prompt", {
					defaultValue: "Trim this message down to the specific keyword you want to ban:",
				})}
				defaultValue={banWordPrompt?.text ?? ""}
				confirmLabel={t("chat.actions.ban_word_confirm", { defaultValue: "Add" })}
				cancelLabel={t("chat.actions.cancel")}
				onConfirm={(wordToBan) => {
					const currentList = getForbiddenWords();
					const newList = currentList ? `${currentList}, ${wordToBan}` : wordToBan;
					void setForbiddenWords(newList);
					toast.success(
						t("chat.actions.ban_word_added", {
							defaultValue: "Added \"{{word}}\" to forbidden keywords!",
							word: wordToBan,
						}),
					);
					setBanWordPrompt(null);
				}}
				onCancel={() => setBanWordPrompt(null)}
			/>
			<ConfirmDialog
				isOpen={pendingLinkUrl !== null}
				title={t("chat.open_link_title", { defaultValue: "Open link?" })}
				message={t("chat.open_link_message", {
					defaultValue: "You're about to open this link: {{url}}",
					url: pendingLinkUrl ?? "",
				})}
				confirmLabel={t("chat.open_link_confirm", { defaultValue: "Open" })}
				cancelLabel={t("chat.actions.cancel")}
				onConfirm={confirmOpenLink}
				onCancel={() => setPendingLinkUrl(null)}
				dontAskAgainLabel={t("profile_details.dont_ask_again")}
				dontAskAgainChecked={dontAskLinkOpenAgain}
				onDontAskAgainChange={setDontAskLinkOpenAgain}
			/>
		</div>
	);
}