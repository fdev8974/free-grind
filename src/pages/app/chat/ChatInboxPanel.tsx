import { Archive, BellOff, Check, CheckCheck, EyeOff, Loader2, MessageCircle, Pin, Star, Trash2 } from "lucide-react";
import { BellOffFilled, EyeOffFilled, HomeFilled, LocateFixedFilled, Trash2Filled } from "../../../components/icons/FilledIcons";
import { RightNowIcon } from "../../../components/icons/RightNowIcon";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChatSearchPanel } from "./ChatSearchPanel";
import { ChatInboxHeader, type ChatInboxHeaderProps } from "./ChatInboxHeader";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { SheetActionList, afterSheetClose } from "../../../components/ui/action-sheet";
import { useLocateProfile } from "../gridpage/hooks/useLocateProfile";
import { isLocateEnabled } from "../../../utils/optionalFeatures";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { ProfileImage } from "../../../components/ui/profile-image";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import type { ConversationEntry } from "../../../types/messages";
import type { ChatContactIndexRecord } from "../../../types/chat-contact-index";
import { PullToRefreshContainer } from "../components/PullToRefreshContainer";
import {
	formatConversationTime,
	getOtherParticipant,
	getParticipantAvatarUrl,
	getParticipantOnlineMeta,
	getPreviewText,
} from "../chat/chatUtils";
import toast from "react-hot-toast";
import { getShowReadReceiptToggle, isReadReceiptsHidden, isReadReceiptsOverridden, toggleReadReceiptsHidden, useReadReceiptsChanged } from "../../../utils/privacy";
import { useApiFunctions } from "../../../hooks/useApiFunctions";
import {
	SKIP_DELETE_CONVERSATION_CONFIRM_KEY,
	isDeleteConversationConfirmSkipped,
} from "../../../utils/blockConfirm";
import { useRevealOnScroll } from "../../../hooks/useRevealOnScroll";
import { useAvatarCache } from "../../../hooks/useAvatarCache";
import { resolveAvatarSrc } from "../../../services/avatarStore";
import { useInboxSyncStatus } from "../../../hooks/useInboxSyncStatus";
import { FEED_HEADER_OFFSET, FEED_MASK_GRADIENT_STOP } from "../../../config/design-config";
import { haptic } from "../../../utils/haptics";
import { menuTransitionStyle, usePresence } from "../../../hooks/usePresence";

/** Footer bar below the chat list's scroll area (not inside it) — reads as
 * part of the list (same border/background as a conversation row) rather
 * than a floating pill, and lives outside the scrolling region entirely so
 * conversation rows never scroll behind/through it. Desktop-only: there's no
 * fixed bottom nav to clear here, so a plain footer row works; on mobile the
 * fixed bottom nav bar leaves no clean spot for it, so that gets a minimal
 * caption in the header instead (ChatSyncHeaderCaption in ChatInboxHeader).
 * Only rendered while a sync is actually in flight; idle/done/error states
 * show nothing here (Settings > Data has those). */
function ChatSyncFooterRow({ userId }: { userId: number | null }) {
	const { t } = useTranslation();
	const status = useInboxSyncStatus(userId);

	if (status.phase !== "syncing_list" && status.phase !== "syncing_messages") {
		return null;
	}

	const progressPercent =
		status.phase === "syncing_messages" && status.total > 0
			? Math.round((status.completed / status.total) * 100)
			: null;

	const label =
		status.phase === "syncing_list"
			? t("chat.sync_progress.syncing_list", {
					defaultValue: "Syncing chats… {{count}} checked",
					count: status.conversationsSoFar,
				})
			: t("chat.sync_progress.syncing_messages_percent", {
					defaultValue: "Syncing messages… {{percent}}%",
					percent: progressPercent ?? 0,
				});

	return (
		<div className="z-20 flex shrink-0 items-center gap-3 border-t border-[var(--surface-2)] bg-[var(--surface)] px-4 py-3">
			<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" />
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs font-medium text-[var(--text-muted)]">{label}</p>
				<div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
					<div
						className={
							progressPercent == null
								? "h-full w-2/5 animate-progress-indeterminate rounded-full bg-[var(--accent)]"
								: "h-full rounded-full bg-[var(--accent)] transition-all duration-300"
						}
						style={progressPercent != null ? { width: `${progressPercent}%` } : undefined}
					/>
				</div>
			</div>
		</div>
	);
}

type ChatInboxPanelProps = ChatInboxHeaderProps & {
	isLoadingInbox: boolean;
	isLoadingMoreInbox: boolean;
	inboxError: string | null;
	filteredConversations: ConversationEntry[];
	archivedConversationIds: Set<string>;
	nextPage: number | null;
	selectedConversationId: string | null;
	userId: number | null;
	localNicknamesByProfileId: Record<string, string>;
	chatContactIndexByProfileId: Record<string, ChatContactIndexRecord>;
	nowTimestamp: number;
	inboxListRef: RefObject<HTMLDivElement | null>;
	showHeader: boolean;
	onRefreshInbox: () => Promise<void>;
	onLoadMoreInbox: () => void;
	onSelectConversation: (conversation: ConversationEntry) => void;
	onOpenConversationById: (conversationId: string) => void;
	onViewProfile: (profileId: number) => void;
	typingConversationIds?: Set<string>;
	onTogglePinConversation: (conversationId: string, isPinned: boolean) => void | Promise<void>;
	onToggleMuteConversation: (conversationId: string, isMuted: boolean) => void | Promise<void>;
	hiddenConversationIds: Set<string>;
	onToggleHideConversation: (conversationId: string, isHidden: boolean) => void;
	onDeleteConversation: (conversationId: string) => void | Promise<void>;
	onDeleteConversationLocal: (conversationId: string) => void | Promise<void>;
	isDeletingConversationId: string | null;
};

type ChatConversationRowProps = {
	conversation: ConversationEntry;
	userId: number | null;
	localNicknamesByProfileId: Record<string, string>;
	chatContactIndexByProfileId: Record<string, ChatContactIndexRecord>;
	nowTimestamp: number;
	isSelected: boolean;
	isTyping: boolean;
	isArchived: boolean;
	isDesktop: boolean;
	onSelectConversation: (c: ConversationEntry) => void;
	onViewProfile: (profileId: number) => void;
	onOpenContextMenu: (conversation: ConversationEntry, isArchived: boolean, x: number, y: number) => void;
	onOpenActionSheet: (conversation: ConversationEntry, isArchived: boolean, title: string) => void;
	onSwipePin: (conversation: ConversationEntry) => void;
	onSwipeDeleteRequest: (conversation: ConversationEntry, isArchived: boolean) => void;
};

type ConversationAction = {
	key: string;
	label: string;
	icon: ReactNode;
	onSelect: () => void;
	destructive?: boolean;
};

type ConversationActionHandlers = {
	onTogglePin: () => void;
	onToggleMute: () => void;
	onToggleHide: () => void;
	/** Only set while the per-chat read-receipts toggle is enabled in Privacy settings. */
	onToggleReadReceipts?: () => void;
	onDelete: () => void;
	/** Only set while the optional Locate feature is enabled. */
	onLocate?: () => void;
	isLocating?: boolean;
};

// Shared by the desktop right-click menu and the mobile long-press sheet so
// both always offer the same actions. Toggle icons stay the same glyph and
// only fill in while their state is active.
function buildConversationActions(
	t: TFunction,
	conversation: ConversationEntry,
	isArchived: boolean,
	isHidden: boolean,
	handlers: ConversationActionHandlers,
): ConversationAction[] {
	const isPinned = conversation.data.pinned;
	const isMuted = conversation.data.muted;
	return [
		...(!isArchived
			? [{
				key: "pin",
				label: isPinned ? t("chat.unpin") : t("chat.pin"),
				icon: <Pin className={`h-4 w-4 ${isPinned ? "fill-current" : ""}`} />,
				onSelect: handlers.onTogglePin,
			}]
			: []),
		{
			key: "mute",
			label: isMuted ? t("chat.unmute") : t("chat.mute"),
			icon: isMuted ? <BellOffFilled className="h-4 w-4" /> : <BellOff className="h-4 w-4" />,
			onSelect: handlers.onToggleMute,
		},
		{
			key: "hide",
			label: isHidden
				? t("chat.unhide_conversation", { defaultValue: "Unhide chat" })
				: t("chat.hide_conversation", { defaultValue: "Hide chat" }),
			icon: isHidden ? <EyeOffFilled className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />,
			onSelect: handlers.onToggleHide,
		},
		...(handlers.onToggleReadReceipts && !isArchived
			? (() => {
				const hidden = isReadReceiptsHidden(conversation.data.conversationId);
				return [{
					key: "read-receipts",
					label: `${t("chat.read_receipts_label")}: ${hidden ? t("chat.read_receipts_off") : t("chat.read_receipts_on")}`,
					icon: hidden ? <Check className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />,
					onSelect: handlers.onToggleReadReceipts,
				}];
			})()
			: []),
		...(handlers.onLocate
			? [{
				key: "locate",
				label: handlers.isLocating ? t("profile_details.locating") : t("profile_details.locate"),
				icon: <LocateFixedFilled className="h-4 w-4" />,
				onSelect: handlers.onLocate,
			}]
			: []),
		{
			key: "delete",
			label: t("chat.delete_conversation"),
			icon: <Trash2Filled className="h-4 w-4" />,
			onSelect: handlers.onDelete,
			destructive: true,
		},
	];
}

function ConversationActionSheet({
	title,
	actions,
	onClose,
}: {
	title: string;
	actions: ConversationAction[];
	onClose: () => void;
}) {
	// Portal to <body> for the same reason as ConversationContextMenu: inside
	// PullToRefreshContainer's transformed wrapper the fixed sheet gets trapped
	// in its stacking context and ends up under the bottom nav.
	return createPortal(
		<SheetActionList
			title={title}
			isDesktop={false}
			onClose={onClose}
			actions={actions.map((action) => ({
				key: action.key,
				icon: action.icon as ReactElement<{ className?: string }>,
				label: action.label,
				tone: action.destructive ? "danger" : "default",
				// Run it once the sheet has finished closing — it pops its own history
				// entry on close, which would otherwise race anything the action opens
				// (e.g. the delete confirmation).
				onSelect: () => afterSheetClose(action.onSelect),
			}))}
		/>,
		document.body,
	);
}

// Pinning is a server-side flag on a live conversation — it doesn't make
// sense (and the API has nothing to target) once we've locally archived a
// conversation the server can no longer produce.
function ConversationContextMenu({
	visible = true,
	conversation,
	isArchived,
	isHidden,
	x,
	y,
	onClose,
	onTogglePin,
	onToggleMute,
	onToggleHide,
	onToggleReadReceipts,
	onDelete,
	onLocate,
	isLocating,
}: {
	visible?: boolean;
	conversation: ConversationEntry;
	isArchived: boolean;
	isHidden: boolean;
	x: number;
	y: number;
	onClose: () => void;
	onTogglePin: () => void;
	onToggleMute: () => void;
	onToggleHide: () => void;
	onToggleReadReceipts?: () => void;
	onDelete: () => void;
	onLocate?: () => void;
	isLocating?: boolean;
}) {
	const { t } = useTranslation();
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

	const actions = buildConversationActions(t, conversation, isArchived, isHidden, {
		onTogglePin,
		onToggleMute,
		onToggleHide,
		onToggleReadReceipts,
		onDelete,
		onLocate,
		isLocating,
	});

	// Portal to <body> — the list sits inside PullToRefreshContainer, which
	// applies a `transform` to its content wrapper (even at rest, translateY(0)
	// counts). That establishes a new containing block for `position: fixed`
	// descendants, so without the portal this menu would be positioned and
	// clipped relative to that wrapper instead of the viewport.
	return createPortal(
		<div
			ref={menuRef}
			style={{ top: position.top, left: position.left, ...menuTransitionStyle(visible, "top left") }}
			className="fixed z-[70] flex min-w-[190px] flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl"
		>
			{actions.map((action) => (
				<Fragment key={action.key}>
					{action.destructive && <div className="-mx-2 mt-1 border-t border-[var(--border)] pt-1" />}
					<button
						type="button"
						onClick={action.onSelect}
						className={`flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition ${
							action.destructive
								? "text-red-500 hover:bg-red-500/10"
								: "text-[var(--text)] hover:bg-[var(--surface-2)]"
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

function ChatConversationRow({
	conversation,
	userId,
	localNicknamesByProfileId,
	chatContactIndexByProfileId,
	nowTimestamp,
	isSelected,
	isTyping,
	isArchived,
	isDesktop,
	onSelectConversation,
	onViewProfile,
	onOpenContextMenu,
	onOpenActionSheet,
	onSwipePin,
	onSwipeDeleteRequest,
}: ChatConversationRowProps) {
	const { t } = useTranslation();
	const { showDebugInfo, chatRowSwipeActions } = usePreferences();
	const { ref, revealClass } = useRevealOnScroll();
	useAvatarCache();

	const contentRef = useRef<HTMLDivElement | null>(null);
	const pinIconRef = useRef<HTMLDivElement | null>(null);
	const deleteIconRef = useRef<HTMLDivElement | null>(null);
	const swipeStateRef = useRef<{
		startX: number;
		startY: number;
		dx: number;
		armed: boolean;
		lock: "pending" | "horizontal" | "vertical";
	} | null>(null);
	const suppressClickRef = useRef(false);
	const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cancelLongPress = () => {
		if (longPressTimerRef.current) {
			clearTimeout(longPressTimerRef.current);
			longPressTimerRef.current = null;
		}
	};
	useEffect(() => cancelLongPress, []);

	const SWIPE_THRESHOLD = 60;
	const SWIPE_MAX_DRAG = 96;
	const DIRECTION_LOCK_DISTANCE = 8;
	const LONG_PRESS_MS = 450;

	const resetSwipeVisual = () => {
		const content = contentRef.current;
		if (content) {
			content.style.transition = "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s ease";
			content.style.transform = "translateX(0px)";
			content.style.boxShadow = "none";
		}
		for (const icon of [pinIconRef.current, deleteIconRef.current]) {
			if (!icon) continue;
			icon.style.transition = "opacity 0.2s, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)";
			icon.style.opacity = "0";
			icon.style.transform = "scale(0.5)";
		}
	};

	const handleTouchStart = (event: React.TouchEvent) => {
		if (isDesktop || event.touches.length !== 1) {
			swipeStateRef.current = null;
			return;
		}
		const touch = event.touches[0];
		swipeStateRef.current = { startX: touch.clientX, startY: touch.clientY, dx: 0, armed: false, lock: "pending" };
		cancelLongPress();
		longPressTimerRef.current = setTimeout(() => {
			longPressTimerRef.current = null;
			// Holding still: end the gesture here so the release neither swipes
			// nor opens the chat.
			swipeStateRef.current = null;
			suppressClickRef.current = true;
			haptic(30);
			onOpenActionSheet(conversation, isArchived, displayName);
		}, LONG_PRESS_MS);
	};

	const handleTouchMove = (event: React.TouchEvent) => {
		if (isDesktop || event.touches.length !== 1) return;
		const state = swipeStateRef.current;
		if (!state || state.lock === "vertical") return;

		const touch = event.touches[0];
		const rawDx = touch.clientX - state.startX;
		const rawDy = touch.clientY - state.startY;

		if (state.lock === "pending") {
			if (Math.max(Math.abs(rawDx), Math.abs(rawDy)) < DIRECTION_LOCK_DISTANCE) return;
			cancelLongPress();
			// With swipe actions off, any movement just ends the gesture (it was
			// only being tracked for the long press).
			if (!chatRowSwipeActions) {
				swipeStateRef.current = null;
				return;
			}
			// Whichever axis moved further decides the gesture — once it's a
			// vertical scroll we stop touching the row entirely so scrolling
			// the list can never leave a swipe "armed" for the next touchend.
			state.lock = Math.abs(rawDy) > Math.abs(rawDx) ? "vertical" : "horizontal";
			if (state.lock === "vertical") return;
		}
		// Pinning isn't available for archived conversations, so don't let a
		// right-swipe reveal an action that would silently do nothing.
		if (rawDx > 0 && isArchived) return;

		const dx = Math.max(-SWIPE_MAX_DRAG, Math.min(SWIPE_MAX_DRAG, rawDx));
		state.dx = dx;

		const content = contentRef.current;
		if (content && dx !== 0) {
			content.style.transition = "none";
			content.style.transform = `translateX(${dx}px)`;
			content.style.boxShadow =
				"-8px 0 16px -4px rgba(0, 0, 0, 0.35), 8px 0 16px -4px rgba(0, 0, 0, 0.35)";
		}
		const activeIcon = dx > 0 ? pinIconRef.current : deleteIconRef.current;
		const inactiveIcon = dx > 0 ? deleteIconRef.current : pinIconRef.current;
		if (inactiveIcon) inactiveIcon.style.opacity = "0";
		if (activeIcon) {
			const progress = Math.min(Math.abs(dx) / 40, 1);
			activeIcon.style.transition = "none";
			activeIcon.style.opacity = String(progress);
			activeIcon.style.transform = `scale(${0.5 + progress * 0.5})`;
		}

		const isArmed = Math.abs(dx) > SWIPE_THRESHOLD;
		if (isArmed !== state.armed) {
			state.armed = isArmed;
			if (isArmed) {
				haptic(15);
			}
		}
	};

	const handleTouchEnd = () => {
		cancelLongPress();
		const state = swipeStateRef.current;
		swipeStateRef.current = null;
		if (!state) return;

		if (Math.abs(state.dx) > 8) {
			suppressClickRef.current = true;
		}
		resetSwipeVisual();
		if (!state.armed) return;

		if (state.dx > 0) {
			onSwipePin(conversation);
		} else {
			onSwipeDeleteRequest(conversation, isArchived);
		}
	};

	const handleTouchCancel = () => {
		cancelLongPress();
		swipeStateRef.current = null;
		resetSwipeVisual();
	};

	const handleClick = () => {
		if (suppressClickRef.current) {
			suppressClickRef.current = false;
			return;
		}
		onSelectConversation(conversation);
	};

	const handleContextMenu = (event: React.MouseEvent) => {
		event.preventDefault();
		// Touch devices fire contextmenu on long press too; the sheet handles that.
		if (!isDesktop) return;
		onOpenContextMenu(conversation, isArchived, event.clientX, event.clientY);
	};

	const otherParticipant = getOtherParticipant(conversation, userId);
	const otherProfileId = otherParticipant?.profileId ? String(otherParticipant.profileId) : null;
	const localNickname = otherProfileId ? localNicknamesByProfileId[otherProfileId] : null;
	const displayName = localNickname || conversation.data.name || t("common.unknown_display_name");
	const otherParticipantOnlineMeta = getParticipantOnlineMeta(
		otherParticipant?.lastOnline,
		otherParticipant?.onlineUntil,
		nowTimestamp,
		t,
	);
	const isOtherParticipantOnline = otherParticipantOnlineMeta.isOnline;
	const databaseUnread = otherProfileId ? chatContactIndexByProfileId[otherProfileId]?.unreadCount ?? 0 : 0;
	const apiUnread = conversation.data.unreadCount;
	// Only badge chats that deviate from the global setting; otherwise every row would carry the icon.
	const readReceiptsOverridden = isReadReceiptsOverridden(conversation.data.conversationId);
	const readReceiptsHidden = isReadReceiptsHidden(conversation.data.conversationId);

	return (
		<div ref={ref} className={`relative overflow-hidden ${revealClass}`}>
			<div className="pointer-events-none absolute inset-0 flex items-center justify-between px-6">
				<div
					ref={pinIconRef}
					className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-3)]"
					style={{ opacity: 0, transform: "scale(0.5)" }}
				>
					<Pin className="h-4 w-4 text-[var(--accent)]" />
				</div>
				<div
					ref={deleteIconRef}
					className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-3)]"
					style={{ opacity: 0, transform: "scale(0.5)" }}
				>
					<Trash2 className="h-4 w-4 text-red-500" />
				</div>
			</div>
			<div
				ref={contentRef}
				onClick={handleClick}
				onContextMenu={handleContextMenu}
				onTouchStart={handleTouchStart}
				onTouchEnd={handleTouchEnd}
				onTouchMove={handleTouchMove}
				onTouchCancel={handleTouchCancel}
				style={{
					touchAction: "pan-y",
					...(isSelected
						? { borderLeft: "2px solid var(--accent)", paddingLeft: "14px" }
						: { paddingLeft: "16px" }),
				}}
				className="no-touch-callout relative flex cursor-pointer items-center gap-4 border-b border-[var(--surface-2)] py-3 pr-4 text-left transition"
			>
					<button
						type="button"
						title={displayName}
						aria-label={displayName}
						onClick={(e) => {
							e.stopPropagation();
							if (otherParticipant?.profileId) onViewProfile(otherParticipant.profileId);
						}}
						className="relative shrink-0 disabled:cursor-default disabled:opacity-80"
					>
						<div className="h-15 w-15 squircle bg-[var(--surface-2)] drop-shadow-sm">
							<ProfileImage
								src={resolveAvatarSrc(
									otherParticipant?.primaryMediaHash,
									getParticipantAvatarUrl(otherParticipant?.primaryMediaHash),
								)}
								alt={displayName}
								className={isArchived ? "grayscale" : undefined}
							/>
						</div>
						{isArchived ? (
							<span
								title={t("chat.archived.badge", { defaultValue: "Archived" })}
								className="absolute -bottom-0.5 -right-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-[var(--bg)] bg-[var(--surface-2)] shadow-sm"
							>
								<Archive className="h-2.5 w-2.5 text-[var(--text-muted)]" />
							</span>
						) : (
							isOtherParticipantOnline && (
								<span className={`absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 rounded-full border-[1.5px] border-[var(--bg)] shadow-sm ${otherParticipantOnlineMeta.isEndingSoon ? "bg-amber-500" : "bg-green-500"}`} />
							)
						)}
						{conversation.data.pinned ? (
							<div className="absolute -top-1 -right-1 rounded-full bg-black/40 p-0.5 text-white backdrop-blur-sm">
								<Pin className="h-2.5 w-2.5 fill-current" />
							</div>
						) : null}
					</button>

					<div className="min-w-0 flex-1">
						<div className="flex items-center justify-between gap-2">
							<div className="flex min-w-0 items-center gap-1.5">
								<p className="truncate text-sm font-semibold text-[var(--text)]">
									{displayName}
								</p>
								{conversation.data.muted && (
									<span title={t("chat.muted")}>
										<BellOffFilled className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
									</span>
								)}
								{conversation.data.favorite && (
									<span title={t("chat.favorite")}>
										<Star className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--accent)]" />
									</span>
								)}
								{conversation.data.rightNow === "HOSTING" && (
									<span title={t("right_now.hosting")}>
										<HomeFilled className="h-3.5 w-3.5 shrink-0 text-[var(--right-now)]" />
									</span>
								)}
								{conversation.data.rightNow === "NOT_HOSTING" && (
									<span title={t("right_now.not_hosting", { defaultValue: "Right Now" })}>
										<RightNowIcon className="h-3.5 w-3.5 shrink-0 text-[var(--right-now)]" />
									</span>
								)}
								{readReceiptsOverridden && (readReceiptsHidden ? (
									<span title={t("privacy.read_receipts_hidden_badge")}>
										<EyeOff className="h-3.5 w-3.5 shrink-0 text-purple-400" />
									</span>
								) : (
									<span title={t("privacy.read_receipts_shown_badge", { defaultValue: "Read receipts sent for this chat" })}>
										<CheckCheck className="h-3.5 w-3.5 shrink-0 text-purple-400" />
									</span>
								))}
							</div>
							<span className="shrink-0 text-xs text-[var(--text-muted)]">
								{formatConversationTime(conversation.data.lastActivityTimestamp)}
							</span>
						</div>

						<div className="mt-0.5 flex items-center justify-between gap-2">
							<p className={`truncate text-sm ${
								conversation.data.unreadCount > 0 ? "font-semibold text-[var(--text)]" : "text-[var(--text-muted)]"
							}`}>
								{isTyping ? (
									<span className="italic text-[var(--accent)]">{t("chat.typing")}</span>
								) : (
									getPreviewText(conversation, t)
								)}
							</p>
							{conversation.data.unreadCount > 0 ? (
								<span className={`flex min-w-[20px] shrink-0 flex-col items-center justify-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--accent-contrast)] shadow-sm ${showDebugInfo ? "min-h-[28px]" : ""}`}>
									<span>{conversation.data.unreadCount}</span>
									{showDebugInfo && (
										<span className="text-[7px] leading-tight opacity-80">
											db:{databaseUnread} a:{apiUnread}
										</span>
									)}
								</span>
							) : null}
						</div>
					</div>
				</div>
			</div>
		);
	}

export function ChatInboxPanel({
	isDesktop,
	isLoadingInbox,
	isLoadingMoreInbox,
	inboxError,
	inboxFilters,
	pinnedFilter,
	hasActiveInboxFilters,
	activeFilterCount,
	filteredConversations,
	archivedConversationIds,
	nextPage,
	realtimeStatusMeta,
	selectedConversationId,
	userId,
	localNicknamesByProfileId,
	chatContactIndexByProfileId,
	nowTimestamp,
	inboxListRef,
	showHeader,
	isSearchOpen,
	searchQuery,
	onSetIsSearchOpen,
	onSetSearchQuery,
	onSetIsFiltersOpen,
	onSetFiltersDraft,
	onRefreshInbox,
	onLoadMoreInbox,
	onSelectConversation,
	onOpenConversationById,
	onViewProfile,
	onClearInboxFilters,
	onToggleFavoritesOnly,
	onToggleUnreadOnly,
	onToggleRightNowOnly,
	onToggleOnlineNowOnly,
	archivedFilter,
	hiddenFilter,
	needsReplyOnly,
	typingConversationIds,
	onTogglePinConversation,
	onToggleMuteConversation,
	hiddenConversationIds,
	onToggleHideConversation,
	onDeleteConversation,
	onDeleteConversationLocal,
	isDeletingConversationId,
}: ChatInboxPanelProps) {
	const { t } = useTranslation();
	useReadReceiptsChanged();
	const apiFunctions = useApiFunctions();
	// Read on mount, same as the thread header; toggled in Privacy settings.
	const [showReadReceiptToggle] = useState(getShowReadReceiptToggle);
	const lastScrollAtRef = useRef(0);
	const lastRequestedPageRef = useRef<number | null>(null);
	const [contextMenuState, setContextMenuState] = useState<{
		conversation: ConversationEntry;
		isArchived: boolean;
		x: number;
		y: number;
	} | null>(null);
	const contextMenuPresence = usePresence(contextMenuState);
	const [actionSheetState, setActionSheetState] = useState<{
		conversation: ConversationEntry;
		isArchived: boolean;
		title: string;
	} | null>(null);

	const conversationActionHandlers = (
		conversation: ConversationEntry,
		isArchived: boolean,
		close: () => void,
	): ConversationActionHandlers => ({
		onTogglePin: () => {
			close();
			void onTogglePinConversation(conversation.data.conversationId, conversation.data.pinned);
		},
		onToggleMute: () => {
			close();
			void onToggleMuteConversation(conversation.data.conversationId, conversation.data.muted);
		},
		onToggleHide: () => {
			close();
			onToggleHideConversation(
				conversation.data.conversationId,
				hiddenConversationIds.has(conversation.data.conversationId),
			);
		},
		...(showReadReceiptToggle
			? {
				onToggleReadReceipts: () => {
					close();
					const conversationId = conversation.data.conversationId;
					const nowHidden = toggleReadReceiptsHidden(conversationId);
					// Same as the thread header toggle: once receipts are back on, tell the
					// server we've read what's already there.
					const lastMessageId = conversation.data.preview?.messageId;
					if (!nowHidden && lastMessageId) {
						apiFunctions.markRead(conversationId, lastMessageId).catch(() => {});
					}
					toast.success(nowHidden ? "Read receipts turned off for this chat." : "Read receipts turned on for this chat.");
				},
			}
			: {}),
		onDelete: () => {
			close();
			requestDeleteConversation(conversation, isArchived);
		},
		...(() => {
			const otherProfileId = getOtherParticipant(conversation, userId)?.profileId;
			if (!showLocate || !otherProfileId) return {};
			return {
				onLocate: () => {
					close();
					handleTriangleProfile(String(otherProfileId));
				},
				isLocating: isLocatingProfile,
			};
		})(),
	});
	const { isLocatingProfile, handleTriangleProfile, locateSheet } = useLocateProfile({ isDesktop });
	// Read on mount like ProfileDetailsModal does; toggled in Optional Features.
	const [showLocate] = useState(isLocateEnabled);
	const [deleteConfirmState, setDeleteConfirmState] = useState<{
		conversation: ConversationEntry;
		isArchived: boolean;
	} | null>(null);
	const [dontAskDeleteAgain, setDontAskDeleteAgain] = useState(false);

	const requestDeleteConversation = (conversation: ConversationEntry, isArchived: boolean) => {
		if (isDeleteConversationConfirmSkipped()) {
			if (isArchived) {
				void onDeleteConversationLocal(conversation.data.conversationId);
			} else {
				void onDeleteConversation(conversation.data.conversationId);
			}
			return;
		}
		setDontAskDeleteAgain(false);
		setDeleteConfirmState({ conversation, isArchived });
	};

	const markUserScroll = () => {
		lastScrollAtRef.current = Date.now();
	};

	useEffect(() => {
		const handleWindowScroll = () => {
			lastScrollAtRef.current = Date.now();
		};

		window.addEventListener("scroll", handleWindowScroll, { passive: true });
		window.addEventListener("touchmove", handleWindowScroll, { passive: true });

		return () => {
			window.removeEventListener("scroll", handleWindowScroll);
			window.removeEventListener("touchmove", handleWindowScroll);
		};
	}, []);

	// Virtualized rows — the list can hold the user's entire local chat
	// history (see inboxSync.ts's background sync), potentially thousands of
	// conversations, so only what's actually in view (plus a small overscan
	// buffer) is ever mounted. estimateSize is a rough guess at a row's
	// resting height; measureElement (wired below, on each row's wrapper)
	// corrects it once a row's real height is known, so variable-height rows
	// (wrapping preview text, badges, etc.) still lay out correctly.
	const rowVirtualizer = useVirtualizer({
		count: filteredConversations.length,
		getScrollElement: () => inboxListRef.current,
		estimateSize: () => 82,
		overscan: 8,
		getItemKey: (index) => filteredConversations[index]?.data.conversationId ?? index,
	});
	const virtualItems = rowVirtualizer.getVirtualItems();
	const lastVirtualItemIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

	// Load-more trigger — fires once virtualization has actually rendered a
	// row at (or past) the end of what's currently loaded, i.e. the user has
	// scrolled to the bottom, replacing the old IntersectionObserver+sentinel
	// approach (a sentinel row's ref would otherwise only ever attach once
	// virtualization decided to mount that row in the first place).
	useEffect(() => {
		if (!nextPage || isLoadingMoreInbox) {
			return;
		}
		if (lastVirtualItemIndex < filteredConversations.length - 1) {
			return;
		}
		if (lastRequestedPageRef.current === nextPage) {
			return;
		}
		lastRequestedPageRef.current = nextPage;
		onLoadMoreInbox();
	}, [lastVirtualItemIndex, filteredConversations.length, isLoadingMoreInbox, nextPage, onLoadMoreInbox]);

	return (
		<PullToRefreshContainer
			className={`flex min-h-0 flex-col overflow-hidden ${
				isDesktop ? "native-card h-full" : "h-dvh p-0"
			}`}
			contentClassName="flex flex-1 flex-col min-h-0"
			style={
				!isDesktop
					? { paddingTop: "calc(env(safe-area-inset-top, 0px) + clamp(14px, 2.2vw, 28px))" }
					: undefined
			}
			onRefresh={onRefreshInbox}
			isDisabled={isLoadingInbox || isLoadingMoreInbox || isSearchOpen}
			isAtTop={() => (inboxListRef.current?.scrollTop ?? 0) <= 0}
			refreshingLabel={t("chat.refreshing_inbox")}
		>
			{showHeader && (
				<ChatInboxHeader
					isDesktop={isDesktop}
					userId={userId}
					realtimeStatusMeta={realtimeStatusMeta}
					inboxFilters={inboxFilters}
					pinnedFilter={pinnedFilter}
					hasActiveInboxFilters={hasActiveInboxFilters}
					activeFilterCount={activeFilterCount}
					isSearchOpen={isSearchOpen}
					searchQuery={searchQuery}
					onSetIsSearchOpen={onSetIsSearchOpen}
					onSetSearchQuery={onSetSearchQuery}
					onSetIsFiltersOpen={onSetIsFiltersOpen}
					onSetFiltersDraft={onSetFiltersDraft}
					onToggleFavoritesOnly={onToggleFavoritesOnly}
					onToggleUnreadOnly={onToggleUnreadOnly}
					onToggleRightNowOnly={onToggleRightNowOnly}
					onToggleOnlineNowOnly={onToggleOnlineNowOnly}
					onClearInboxFilters={onClearInboxFilters}
					archivedFilter={archivedFilter}
					hiddenFilter={hiddenFilter}
					needsReplyOnly={needsReplyOnly}
				/>
			)}

			{isSearchOpen ? (
				<ChatSearchPanel
					isDesktop={isDesktop}
					searchQuery={searchQuery}
					onClose={() => { onSetIsSearchOpen(false); onSetSearchQuery(""); }}
					onOpenConversationById={onOpenConversationById}
				/>
			) : (
				<div
					className="relative flex-1 min-h-0"
					style={!isDesktop ? { marginTop: `-${FEED_HEADER_OFFSET}` } : undefined}
				>
					<div
						ref={inboxListRef}
						onScroll={markUserScroll}
						data-lenis-prevent
						className="h-full overflow-y-auto"
						style={!isDesktop ? {
							paddingTop: FEED_HEADER_OFFSET,
							maskImage: `linear-gradient(to bottom, transparent, black ${FEED_MASK_GRADIENT_STOP})`,
							WebkitMaskImage: `linear-gradient(to bottom, transparent, black ${FEED_MASK_GRADIENT_STOP})`,
						} : undefined}
					>
						<div className={!isDesktop ? "pb-[calc(env(safe-area-inset-bottom,0px)+120px)]" : ""}>
							{isLoadingInbox ? (
								<div className="flex flex-col">
									{Array.from({ length: 12 }).map((_, i) => (
										<div key={i} className="flex items-center gap-4 border-b border-[var(--surface-2)] py-3 px-4">
											<div className="h-15 w-15 shrink-0 squircle animate-pulse bg-[var(--surface-2)]" />
											<div className="flex flex-1 flex-col gap-2">
												<div className="flex items-center justify-between gap-3">
													<div className="h-3 w-28 animate-pulse rounded-full bg-[var(--surface-2)]" />
													<div className="h-2.5 w-10 animate-pulse rounded-full bg-[var(--border)]" />
												</div>
												<div className="h-2.5 w-40 animate-pulse rounded-full bg-[var(--border)]" />
											</div>
										</div>
									))}
								</div>
							) : inboxError ? (
								<div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
									<p className="text-sm text-[var(--text-muted)]">{inboxError}</p>
									<button
										type="button"
										onClick={onRefreshInbox}
										className="btn-accent px-4 py-2 text-sm"
									>
										{t("chat.retry")}
									</button>
								</div>
							) : filteredConversations.length === 0 ? (
								<div className="flex flex-col items-center justify-center gap-3 p-6 text-center text-[var(--text-muted)]">
									<MessageCircle className="h-8 w-8" />
									<p className="text-sm">
										{hasActiveInboxFilters
											? t("chat.no_conversations_match")
											: t("chat.no_conversations")}
									</p>
								</div>
							) : (
								<>
									<div
										style={{
											position: "relative",
											width: "100%",
											height: rowVirtualizer.getTotalSize(),
										}}
									>
										{virtualItems.map((virtualRow) => {
											const conversation = filteredConversations[virtualRow.index];
											if (!conversation) {
												return null;
											}
											return (
												<div
													key={virtualRow.key}
													data-index={virtualRow.index}
													ref={rowVirtualizer.measureElement}
													style={{
														position: "absolute",
														top: 0,
														left: 0,
														width: "100%",
														transform: `translateY(${virtualRow.start}px)`,
													}}
												>
													<ChatConversationRow
														conversation={conversation}
														userId={userId}
														localNicknamesByProfileId={localNicknamesByProfileId}
														chatContactIndexByProfileId={chatContactIndexByProfileId}
														nowTimestamp={nowTimestamp}
														isSelected={conversation.data.conversationId === selectedConversationId}
														isTyping={typingConversationIds?.has(conversation.data.conversationId) ?? false}
														isArchived={archivedConversationIds.has(conversation.data.conversationId)}
														isDesktop={isDesktop}
														onSelectConversation={onSelectConversation}
														onViewProfile={onViewProfile}
														onOpenActionSheet={(c, isArchived, title) =>
															setActionSheetState({ conversation: c, isArchived, title })
														}
														onOpenContextMenu={(c, isArchived, x, y) =>
															setContextMenuState({ conversation: c, isArchived, x, y })
														}
														onSwipePin={(c) => void onTogglePinConversation(c.data.conversationId, c.data.pinned)}
														onSwipeDeleteRequest={requestDeleteConversation}
													/>
												</div>
											);
										})}
									</div>

									{nextPage && isLoadingMoreInbox ? (
										<p className="px-3 py-2 text-center text-xs text-[var(--text-muted)]">
											{t("chat.loading")}
										</p>
									) : null}
								</>
							)}
						</div>
					</div>
				</div>
			)}

			{isDesktop && !isSearchOpen && <ChatSyncFooterRow userId={userId} />}

			{contextMenuPresence.rendered ? (
				<ConversationContextMenu
					visible={contextMenuPresence.visible}
					conversation={contextMenuPresence.rendered.conversation}
					isArchived={contextMenuPresence.rendered.isArchived}
					isHidden={hiddenConversationIds.has(contextMenuPresence.rendered.conversation.data.conversationId)}
					x={contextMenuPresence.rendered.x}
					y={contextMenuPresence.rendered.y}
					onClose={() => setContextMenuState(null)}
					{...conversationActionHandlers(contextMenuPresence.rendered.conversation, contextMenuPresence.rendered.isArchived, () => setContextMenuState(null))}
				/>
			) : null}

			{locateSheet ? createPortal(locateSheet, document.body) : null}

			{actionSheetState ? (
				<ConversationActionSheet
					title={actionSheetState.title}
					actions={buildConversationActions(
						t,
						actionSheetState.conversation,
						actionSheetState.isArchived,
						hiddenConversationIds.has(actionSheetState.conversation.data.conversationId),
						// The sheet closes itself before running the action.
						conversationActionHandlers(actionSheetState.conversation, actionSheetState.isArchived, () => {}),
					)}
					onClose={() => setActionSheetState(null)}
				/>
			) : null}

			<ConfirmDialog
				isOpen={deleteConfirmState !== null}
				title={t("chat.delete_conversation")}
				message={t("chat.delete_conversation_confirm")}
				confirmLabel={t("chat.delete_conversation")}
				cancelLabel={t("chat.actions.cancel")}
				onConfirm={() => {
					if (!deleteConfirmState) return;
					const { conversation, isArchived } = deleteConfirmState;
					if (dontAskDeleteAgain && typeof window !== "undefined") {
						localStorage.setItem(SKIP_DELETE_CONVERSATION_CONFIRM_KEY, "true");
					}
					setDeleteConfirmState(null);
					if (isArchived) {
						void onDeleteConversationLocal(conversation.data.conversationId);
					} else {
						void onDeleteConversation(conversation.data.conversationId);
					}
				}}
				onCancel={() => setDeleteConfirmState(null)}
				isProcessing={
					deleteConfirmState != null &&
					isDeletingConversationId === deleteConfirmState.conversation.data.conversationId
				}
				confirmTone="danger"
				dontAskAgainLabel={t("profile_details.dont_ask_again")}
				dontAskAgainChecked={dontAskDeleteAgain}
				onDontAskAgainChange={setDontAskDeleteAgain}
			/>
		</PullToRefreshContainer>
	);
}
