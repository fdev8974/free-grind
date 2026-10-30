import { Flame, MessageCircle, Check, Loader2 } from "lucide-react";
import { LayoutGridFilled as GridIcon, UserFilled } from "./icons/FilledIcons";
import toast from "react-hot-toast";
import { RightNowIcon } from "./icons/RightNowIcon";
import { useNavigate, useLocation } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "../utils/cn";
import { useApiFunctions } from "../hooks/useApiFunctions";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/useAuth";
import { useExploreMode } from "../contexts/ExploreModeContext";
import { useIsRightNowLive } from "../hooks/useIsRightNowLive";
import {
	getInterestLastSeen,
	INTEREST_SEEN_EVENT,
	markInterestSeen,
	getInboxLastSeen,
	INBOX_SEEN_EVENT,
	markInboxSeen,
} from "../services/seenStore";
import { CHAT_REALTIME_EVENT } from "./ChatRealtimeBridge";
import { messageSchema, type Message } from "../types/messages";
import type { RealtimeEnvelope } from "../types/chat-realtime";
import { useInterestData } from "../hooks/queries/useInterestQueries";
import { isAndroid, isIos } from "../services/saveMedia";
import { haptic } from "../utils/haptics";
import { Avatar } from "./ui/avatar";
import { useMyOwnProfile } from "../hooks/queries/useProfileQueries";
import { getProfilePhotoHash } from "../pages/app/profile-editor/profileEditorUtils";
import { useDesktopBreakpoint } from "../hooks/useDesktopBreakpoint";
import { getThumbImageUrl } from "../utils/media";
import { getSavedAccountProfile } from "../services/savedAccountProfiles";
import { looksLikeMessageUpdate } from "../utils/messageUpdates";

// Bottom-nav style options; only offered (and only honoured) in the mobile app.
export const NAV_SHOW_LABELS_KEY = "fg-nav-show-labels";
// Bar style: unset/"false" = full width, "true" = floating card, "fade" =
// floating without a card, on a dark fade instead.
export const NAV_FLOATING_KEY = "fg-nav-floating";
export const NAV_STYLE_EVENT = "fg-nav-style-changed";

export type NavBarStyle = "solid" | "floating" | "fade";

export const readNavBarStyle = (): NavBarStyle => {
	const value = window.localStorage.getItem(NAV_FLOATING_KEY);
	return value === "fade" ? "fade" : value === "true" ? "floating" : "solid";
};

const readNavStyle = () => ({
	showLabels: window.localStorage.getItem(NAV_SHOW_LABELS_KEY) === "true",
	barStyle: readNavBarStyle(),
});

/**
 * The bottom nav's effective look, kept in sync with the customization page.
 * `fullWidth`: edge-to-edge bar (mobile app default) instead of the floating
 * card desktop/web always use — overlays placed above the nav (e.g. the Right
 * Now map card) need less bottom offset then. `transparent`: floating tabs
 * without a card, kept readable by a dark fade from the screen edge.
 */
export function useNavStyle(): { fullWidth: boolean; hideLabels: boolean; transparent: boolean } {
	const [isMobilePlatform] = useState(() => isAndroid() || isIos());
	const [navStyle, setNavStyle] = useState(readNavStyle);
	useEffect(() => {
		const onChange = () => setNavStyle(readNavStyle());
		window.addEventListener(NAV_STYLE_EVENT, onChange);
		return () => window.removeEventListener(NAV_STYLE_EVENT, onChange);
	}, []);
	return {
		// Mobile app hides labels by default; desktop/web always shows them.
		hideLabels: isMobilePlatform && !navStyle.showLabels,
		// Full-width edge-to-edge bar in the mobile app, unless the user opted
		// into the floating card that desktop/web always use.
		fullWidth: isMobilePlatform && navStyle.barStyle === "solid",
		transparent: isMobilePlatform && navStyle.barStyle === "fade",
	};
}

/**
 * Extracts and validates chat messages from a variety of possible realtime envelope formats.
 * WebSocket events from the API can wrap messages in several ways (e.g., direct payload,
 * nested in a 'message' field, or as an array of 'messages').
 */
function extractMessages(envelope: RealtimeEnvelope): Message[] {
	const candidates: Message[] = [];

	// 1. Try to parse the payload directly as a single message
	const direct = messageSchema.safeParse(envelope.payload);
	if (direct.success) candidates.push(direct.data);

	// 2. Deep-probe common nesting patterns in the envelope structure
	for (const payload of [envelope.payload, envelope.data, envelope]) {
		if (!payload || typeof payload !== "object") continue;
		const record = payload as Record<string, unknown>;

		// Check for single nested message: { message: { ... } }
		if (record.message) {
			const parsed = messageSchema.safeParse(record.message);
			if (parsed.success) candidates.push(parsed.data);
		}

		// Check for multiple messages: { messages: [ { ... }, { ... } ] }
		if (Array.isArray(record.messages)) {
			for (const candidate of record.messages) {
				const parsed = messageSchema.safeParse(candidate);
				if (parsed.success) candidates.push(parsed.data);
			}
		}
	}

	// 3. Deduplicate messages by their unique ID to avoid double-processing
	const seen = new Set<string>();
	return candidates.filter((m) => {
		if (seen.has(m.messageId)) return false;
		seen.add(m.messageId);
		return true;
	});
}

export function NavBar() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const apiFunctions = useApiFunctions();
	const { userId, savedAccounts, switchAccount } = useAuth();
	const { data: myProfile } = useMyOwnProfile();
	const { data: interestData } = useInterestData();
	const { isExploreActive } = useExploreMode();
	// A live (public) Right Now session takes the grid tab's color over everything, explore included.
	const isRightNowLive = useIsRightNowLive();
	const { hideLabels, fullWidth, transparent } = useNavStyle();
	// Desktop: vertical rail on the left instead of the bottom bar.
	const rail = useDesktopBreakpoint();

	const pathRef = useRef(location.pathname);
	useEffect(() => {
		pathRef.current = location.pathname;
	}, [location.pathname]);

	// Tracks which conversations are muted so the realtime handler can ignore
	// their messages without waiting for the next poll.
	const mutedConversationIdsRef = useRef<Set<string>>(new Set());

	const [activeTab, setActiveTab] = useState("browse");
	const setUnreadCount = useState(0)[1];
	const [interestUnseen, setInterestUnseen] = useState(false);
	const [inboxUnseen, setInboxUnseen] = useState(false);

	// Read preferences directly from localStorage (defaulting to true if not set)
	const [showRightNow] = useState(() => window.localStorage.getItem("fg-show-right-now") !== "false");
	const [showInterest] = useState(() => window.localStorage.getItem("fg-show-interest") !== "false");

	const profileImageHash = getProfilePhotoHash(myProfile);
	const profilePhotoUrl = profileImageHash ? getThumbImageUrl(profileImageHash, "75x75") : null;

	// Quick account switcher: opened by long-pressing the settings tab when more
	// than one account is saved. A plain tap still just opens settings.
	const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);
	const [switchingProfileId, setSwitchingProfileId] = useState<string | null>(null);
	const accountSwitcherRef = useRef<HTMLDivElement>(null);
	const hasAccountSwitcher = savedAccounts.length > 1;
	const settingsLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Set once the long press has opened the switcher, so the trailing
	// mousedown/click of that same press doesn't also navigate to settings.
	const settingsLongPressFiredRef = useRef(false);

	const cancelSettingsLongPress = () => {
		if (settingsLongPressTimerRef.current) {
			clearTimeout(settingsLongPressTimerRef.current);
			settingsLongPressTimerRef.current = null;
		}
	};

	useEffect(() => cancelSettingsLongPress, []);

	useEffect(() => {
		if (!isAccountSwitcherOpen) return;
		const handler = (e: MouseEvent | TouchEvent) => {
			const target = e.target as Element | null;
			if (accountSwitcherRef.current?.contains(target)) return;
			// The settings tab handles its own presses (long press reopens, tap navigates).
			if (target?.closest?.("[data-nav-account-tab]")) return;
			setIsAccountSwitcherOpen(false);
		};
		document.addEventListener("mousedown", handler);
		document.addEventListener("touchstart", handler);
		return () => {
			document.removeEventListener("mousedown", handler);
			document.removeEventListener("touchstart", handler);
		};
	}, [isAccountSwitcherOpen]);

	useEffect(() => {
		setIsAccountSwitcherOpen(false);
	}, [location.pathname]);

	const handleSwitchAccount = async (profileId: string) => {
		setSwitchingProfileId(profileId);
		try {
			await switchAccount(profileId);
			setIsAccountSwitcherOpen(false);
			navigate("/");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to switch account.");
		} finally {
			setSwitchingProfileId(null);
		}
	};

	const navItems = [
		{
			value: "browse",
			label: t("nav.browse"),
			icon: GridIcon,
			path: "/",
			visible: true, // Mandatory
		},
		{
			value: "right-now",
			label: t("nav.right_now"),
			icon: RightNowIcon,
			path: "/right-now",
			visible: showRightNow, // Toggleable
		},
		{
			value: "interest",
			label: t("nav.interest"),
			icon: Flame,
			path: "/interest",
			visible: showInterest, // Toggleable
		},
		{
			value: "inbox",
			label: t("nav.inbox"),
			icon: MessageCircle,
			path: "/chat",
			visible: true, // Mandatory
		},
		{
			value: "settings",
			label: t("nav.settings", { defaultValue: "Settings" }),
			icon: null,
			path: "/settings",
			visible: true, // Mandatory
		},
	].filter(item => item.visible);

	// Update active tab based on current path
	useEffect(() => {
		// Shared albums lives under /settings but is opened from the inbox.
		if (location.pathname === "/settings/shared-albums") {
			setActiveTab("inbox");
			return;
		}
		const currentItem = navItems.find(
			(item) =>
				(item.path === "/" &&
					(location.pathname === "/" ||
						location.pathname.startsWith("/browse/"))) ||
				location.pathname === item.path ||
				(item.path !== "/" && location.pathname.startsWith(`${item.path}/`)),
		);
		if (currentItem) {
			setActiveTab(currentItem.value);
		}
	}, [location.pathname, navItems]);

	useEffect(() => {
		let cancelled = false;

		const refreshInboxState = async () => {
			if (document.hidden) return;
			const isAtInbox = pathRef.current.startsWith("/chat") || pathRef.current === "/settings/shared-albums";
			try {
				// Fetch the latest inbox summary to sync unread counts and global "seen" state
				const response = await apiFunctions.listConversations({
					page: 1,
				});

				if (cancelled) return;

				mutedConversationIdsRef.current = new Set(
					response.entries
						.filter((entry) => entry.data.muted)
						.map((entry) => entry.data.conversationId),
				);

				const totalUnread = response.entries.reduce(
					(sum, entry) => sum + (entry.data.muted ? 0 : entry.data.unreadCount || 0),
					0,
				);
				setUnreadCount(totalUnread);

				const lastSeen = getInboxLastSeen();
				const newest = response.entries.reduce(
					(max, entry) => Math.max(max, entry.data.lastActivityTimestamp ?? 0),
					0,
				);

				if (lastSeen === 0 && newest > 0) {
					// Initialize "last seen" on first run to avoid showing stale dots
					window.localStorage.setItem("fg-inbox-last-seen", String(newest));
				}

				// Keeps the "last seen" bookmark current while the user is looking
				// at the inbox, so the dot doesn't reappear immediately when they
				// switch away — unrelated to whether anything is actually unread.
				if (isAtInbox && newest > lastSeen) {
					markInboxSeen(newest);
				}

				// A conversation only lights up the dot if it's both genuinely
				// unread (server-reported unreadCount, the same signal the inbox
				// rows themselves trust — not just "some activity happened") *and*
				// that activity is newer than the last time the inbox list was
				// actually viewed. The unreadCount check keeps the user's own
				// outgoing messages, an automation auto-reply sent while this page
				// isn't mounted, or a message already read on another device from
				// falsely lighting it up. The lastSeen check keeps an unread
				// conversation the user already looked at (but didn't open) from
				// re-lighting the dot on every later remount/poll — visiting the
				// inbox list once is enough to acknowledge it. Muted conversations
				// never contribute at all, regardless of unread state.
				const hasUnseenUnread = response.entries.some(
					(entry) =>
						!entry.data.muted &&
						(entry.data.unreadCount ?? 0) > 0 &&
						(entry.data.lastActivityTimestamp ?? 0) > lastSeen,
				);
				setInboxUnseen(!isAtInbox && hasUnseenUnread);
			} catch {
				if (!cancelled) {
					setUnreadCount(0);
					setInboxUnseen(false);
				}
			}
		};

		void refreshInboxState();
		// Background safety poll to catch updates from other devices/stale socket
		const intervalId = window.setInterval(refreshInboxState, 60_000);

		const handleRealtime = (event: Event) => {
			const isAtInbox = pathRef.current.startsWith("/chat") || pathRef.current === "/settings/shared-albums";
			// If we are already looking at the inbox, suppress the dot immediately
			if (isAtInbox) {
				setInboxUnseen(false);
				return;
			}

			// Extract messages directly from the realtime event to avoid an expensive API reload.
			// This ensures the notification dot appears instantly with the incoming message.
			const envelope = (event as CustomEvent<RealtimeEnvelope>).detail;
			const messages = extractMessages(envelope);
			if (messages.length > 0) {
				const lastSeen = getInboxLastSeen();
				// Check for messages from other users, excluding muted conversations
				const fromOthers = messages.filter(
					(m) =>
						userId != null &&
						Number(m.senderId) !== Number(userId) &&
						!looksLikeMessageUpdate(m, userId) &&
						!mutedConversationIdsRef.current.has(m.conversationId)
				);

				if (fromOthers.length > 0) {
					const newest = Math.max(...fromOthers.map((m) => m.timestamp));
					// Show dot if the message is actually newer than our last visit
					if (newest > lastSeen) {
						setInboxUnseen(true);
					}
					// Optimistically increment the total unread count shown in the UI
					setUnreadCount((prev) => prev + fromOthers.length);
				}
			}
		};
		const onSeen = () => setInboxUnseen(false);

		const onVisibilityChange = () => {
			if (!document.hidden) {
				void refreshInboxState();
			}
		};

		window.addEventListener(CHAT_REALTIME_EVENT, handleRealtime);
		window.addEventListener(INBOX_SEEN_EVENT, onSeen as EventListener);
		window.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
			window.removeEventListener(CHAT_REALTIME_EVENT, handleRealtime as EventListener);
			window.removeEventListener(INBOX_SEEN_EVENT, onSeen as EventListener);
			window.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [apiFunctions, userId]);

	// Clear the inbox dot immediately when navigating to the chat section or shared albums
	useEffect(() => {
		if (location.pathname.startsWith("/chat") || location.pathname === "/settings/shared-albums") {
			setInboxUnseen(false);
		}
	}, [location.pathname]);

	// Track whether the Interest tab has anything new since the user last
	// looked. Listens for live update events via the useInterestData hook.
	useEffect(() => {
		const refreshInterestUnseen = () => {
			if (!interestData) return;
			const isAtInterest = pathRef.current === "/interest";
			const lastSeen = getInterestLastSeen();

			const newest = Math.max(
				...(interestData.taps.map(t => t.timestamp || 0)),
				...(interestData.views.map(v => v.timestamp || 0)),
				0
			);

			// On first run (no stored seen timestamp), treat current state as
			// already seen so we don't show a stale dot.
			if (lastSeen === 0) {
				if (newest > 0) {
					markInterestSeen(newest);
				}
				setInterestUnseen(false);
				return;
			}

			// If we are currently on the interest page, ensure our "last seen"
			// timestamp is at least as high as the newest item.
			if (isAtInterest && newest > lastSeen) {
				markInterestSeen(newest);
			}

			setInterestUnseen(!isAtInterest && newest > lastSeen);
		};

		refreshInterestUnseen();

		const onSeen = () => setInterestUnseen(false);
		window.addEventListener(INTEREST_SEEN_EVENT, onSeen as EventListener);

		return () => {
			window.removeEventListener(INTEREST_SEEN_EVENT, onSeen as EventListener);
		};
	}, [interestData]);

	// Clear the interest dot immediately when navigating to the interest section
	useEffect(() => {
		if (location.pathname === "/interest") {
			setInterestUnseen(false);
		}
	}, [location.pathname]);

	const handleTabChange = (value: string) => {
		setActiveTab(value);
		const item = navItems.find((i) => i.value === value);
		// Radix fires onValueChange from both mousedown and focus, and
		// depending on render timing a single tap can hit both — pushing the
		// same tab twice, so the first system back appeared to do nothing.
		// BrowserRouter pushes synchronously, so the second call sees the
		// already-updated pathname and skips.
		if (item && window.location.pathname !== item.path) {
			navigate(item.path);
		}
	};

	// Publish the bar's rendered height (safe-area padding included) as
	// --nav-height, so floating UI (FABs, map cards) can sit right above it
	// regardless of full-width/floating style or hidden labels. The desktop
	// rail takes no bottom space; it flags the root instead (data-nav="rail"),
	// which sets --nav-rail-width for ProtectedLayout's left offset.
	const navRef = useRef<HTMLElement>(null);
	useLayoutEffect(() => {
		const nav = navRef.current;
		if (!nav) return;
		const root = document.documentElement;
		if (rail) {
			root.style.setProperty("--nav-height", "0px");
			root.dataset.nav = "rail";
			return () => {
				root.style.removeProperty("--nav-height");
				delete root.dataset.nav;
			};
		}
		const publish = () => root.style.setProperty("--nav-height", `${nav.offsetHeight}px`);
		publish();
		const observer = "ResizeObserver" in window ? new ResizeObserver(publish) : null;
		observer?.observe(nav);
		return () => {
			observer?.disconnect();
			root.style.removeProperty("--nav-height");
		};
	}, [rail]);

	// Floating bar: keep the same gap below it as on its sides, like iOS, and
	// let it overlap the gesture-handle / home-indicator area. Only a tall
	// inset (Android 3-button navigation) is kept clear, since the bar would
	// cover the system buttons there.
	const [systemNavInset, setSystemNavInset] = useState(0);
	useLayoutEffect(() => {
		const probe = document.createElement("div");
		probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)";
		document.body.appendChild(probe);
		const measure = () => {
			const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
			setSystemNavInset(inset > 40 ? inset : 0);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => {
			window.removeEventListener("resize", measure);
			probe.remove();
		};
	}, []);

	// Determine the grid column class safely based on exactly how many tabs remain
	const gridColsClass = 
		navItems.length === 2 ? "grid-cols-2" : 
		navItems.length === 3 ? "grid-cols-3" : 
		navItems.length === 4 ? "grid-cols-4" :
		"grid-cols-5";

	return (
		<nav
			ref={navRef}
			className={cn(
				rail
					? // No fill or border: the tabs sit on the page background like the
						// page headers, so the header glow runs behind them and only the
						// content is shown as cards. Top padding = the page headers' own
						// (--header-top), so the first tab lines up with the page title;
						// bottom padding = the pages' --page-bottom, so the profile tab ends
						// level with the page content.
						"fixed inset-y-0 left-0 w-[var(--nav-rail-width)] pt-[var(--header-top)] pb-[var(--page-bottom)]"
					: "fixed inset-x-0 bottom-0",
				// While the account switcher is open, lift the bar (and the switcher
				// inside it) above the pages' floating action buttons (z-[60]).
				isAccountSwitcherOpen ? "z-[65]" : "z-50",
				!rail && !fullWidth && "px-3 pb-[calc(var(--nav-system-inset)+0.75rem)] md:px-4 md:pb-[calc(var(--nav-system-inset)+1rem)]",
			)}
			style={{ "--nav-system-inset": `${systemNavInset}px` } as React.CSSProperties}
		>
			{/* Floating styles: a dark fade rising from the screen edge (like the
			    profile footer actions) sets the bar off from the content. Strong for
			    the transparent style, where it alone keeps the icons readable; lighter
			    behind the card. It reaches above the bar without adding to its height
			    (--nav-height). */}
			{!rail && !fullWidth && (
				<div
					aria-hidden
					className={cn("pointer-events-none absolute inset-x-0 bottom-0", transparent ? "-top-24" : "-top-12")}
					style={{
						background: transparent
							? "linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 45%, rgba(0,0,0,0.7) 72%, transparent 100%)"
							: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.2) 70%, transparent 100%)",
					}}
				/>
			)}
			{/* Mobile app: full-width bar that extends under the system navigation
			    bar (edge-to-edge), with the safe-area inset as inner padding.
			    Floating style: rounded capsule (transparent style: without the card).
			    Desktop: left rail. */}
			<div
				className={cn(
					"relative",
					rail
						? "h-full"
						: fullWidth
							? "w-full border-t border-[var(--border)] pt-1.5 pb-[calc(env(safe-area-inset-bottom,0px)+0.375rem)]"
							: // Capsule shape; extra side padding keeps the outer tabs off the curve.
								cn("mx-auto w-full max-w-4xl rounded-full px-3 py-1.5", !transparent && "border border-[var(--border)]"),
				)}
				style={
					rail || transparent
						? undefined
						: {
								backgroundColor: "rgba(22, 29, 39, 0.8)",
								background: "color-mix(in srgb, var(--surface) 80%, transparent)",
								backdropFilter: "blur(24px)",
								WebkitBackdropFilter: "blur(24px)",
							}
				}
			>
				<Tabs
					value={activeTab}
					onValueChange={handleTabChange}
					orientation={rail ? "vertical" : "horizontal"}
					// Keep the tabs at their previous centered width; only the
					// background spans the full screen on mobile.
					className={cn(rail ? "h-full" : fullWidth && "mx-auto w-full max-w-4xl px-[calc(0.75rem+1px+0.375rem)]")}
				>
					<TabsList
						className={cn(
							rail
								? "flex h-full w-full flex-col items-stretch justify-start gap-1 bg-transparent px-2 py-0"
								: cn(
										"grid w-full bg-transparent p-0",
										gridColsClass,
										// Mobile app without labels: keep icon size, shrink the bar instead.
										hideLabels ? "h-12" : "h-16 md:h-[4.1rem]",
									),
						)}
					>
						{navItems.map((item) => {
							const Icon = item.icon;
							const isSwitcherTab = item.value === "settings" && hasAccountSwitcher;
							return (
								<TabsTrigger
									key={item.value}
									value={item.value}
									data-nav-account-tab={isSwitcherTab ? "" : undefined}
									aria-expanded={isSwitcherTab ? isAccountSwitcherOpen : undefined}
									// Radix already switches the tab on mousedown, so by onClick
									// activeTab equals this item; pointerdown still sees the old tab.
									onPointerDown={(e) => {
										if (e.button === 0 && item.value !== activeTab) haptic(10);
										// Touch/pen: long press opens the switcher. Mouse uses right-click instead.
										if (!isSwitcherTab || e.pointerType === "mouse") return;
										settingsLongPressFiredRef.current = false;
										cancelSettingsLongPress();
										settingsLongPressTimerRef.current = setTimeout(() => {
											settingsLongPressTimerRef.current = null;
											settingsLongPressFiredRef.current = true;
											haptic(30);
											setIsAccountSwitcherOpen(true);
										}, 450);
									}}
									onPointerUp={isSwitcherTab ? cancelSettingsLongPress : undefined}
									onPointerLeave={isSwitcherTab ? cancelSettingsLongPress : undefined}
									onPointerCancel={isSwitcherTab ? cancelSettingsLongPress : undefined}
									onContextMenu={
										isSwitcherTab
											? (e) => {
													// Suppress the system/browser menu; on desktop right-click opens the switcher.
													e.preventDefault();
													if (e.nativeEvent instanceof PointerEvent ? e.nativeEvent.pointerType === "mouse" : e.button === 2) {
														setIsAccountSwitcherOpen(true);
													}
												}
											: undefined
									}
									onMouseDown={(e) => {
										// Radix activates tabs on mousedown, i.e. before a touch long press
										// is detected. Default-preventing makes Radix skip it; onClick (on
										// release) navigates instead, unless the press was a long press.
										if (isSwitcherTab) e.preventDefault();
									}}
									onFocus={(e) => {
										// Radix also activates on focus (automatic mode), which on touch
										// happens at press time too; navigation is left to onClick.
										if (isSwitcherTab) e.preventDefault();
									}}
									onClick={() => {
										if (isSwitcherTab && settingsLongPressFiredRef.current) {
											settingsLongPressFiredRef.current = false;
											return;
										}
										if (isSwitcherTab) setIsAccountSwitcherOpen(false);
										if (item.value === "browse" && activeTab === "browse") {
											window.dispatchEvent(new CustomEvent("browse-scroll-top"));
										}
										setActiveTab(item.value);
										navigate(item.path, { replace: true });
									}}
									className={cn(
										isSwitcherTab && "select-none [-webkit-touch-callout:none]",
										"flex h-full flex-col items-center justify-center gap-1 rounded-xl transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] md:gap-1.5",
										// No filled pill (full-width and floating alike), highlight via text color only.
										"data-[state=active]:bg-transparent data-[state=active]:shadow-none",
										rail
											? // Rail: stacked icon + label, tinted pill for the active tab; the
												// profile tab sits at the bottom like in desktop messengers.
												cn(
													"h-auto w-full flex-none px-1 py-2.5 text-[var(--text-muted)] hover-fill hover:text-[var(--text)]",
													"data-[state=active]:bg-[color-mix(in_srgb,currentColor_12%,transparent)]",
													item.value === "settings" && "mt-auto",
												)
											: transparent
												? // On the dark fade: light icons with a shadow, in either theme.
													"text-white/90 drop-shadow-[0_1px_1.5px_rgba(0,0,0,1)] drop-shadow-[0_0_0.8px_rgba(0,0,0,1)] hover:text-white"
												: "text-[var(--text-muted)] hover:text-[var(--text)]",
										item.value === "right-now" || (item.value === "browse" && isRightNowLive)
											? "focus-visible:ring-[var(--right-now)] data-[state=active]:text-[var(--right-now)]"
											: item.value === "browse" && isExploreActive
												? "focus-visible:ring-[var(--explore)] data-[state=active]:text-[var(--explore)]"
												: "focus-visible:ring-[var(--accent)] data-[state=active]:text-[var(--accent)]",
									)}
								>
									{/* Fixed icon-sized slot so the slightly larger avatar overflows evenly
									    instead of pushing its label below the other tabs' labels. */}
									<div className="relative flex h-5 w-5 items-center justify-center md:h-[1.2rem] md:w-[1.2rem]">
										{Icon ? (
											<Icon className="h-5 w-5 fill-current md:h-[1.2rem] md:w-[1.2rem]" />
										) : !profilePhotoUrl ? (
											// No profile photo: a user icon that takes the tab's (active) color like the other icons.
											<UserFilled className="h-5 w-5 md:h-[1.2rem] md:w-[1.2rem]" />
										) : (
											<Avatar
												src={profilePhotoUrl}
												alt={t("browse_page.your_profile_photo")}
												className={cn(
													"h-6 w-6 shrink-0 border-0 ring-2 transition-colors md:h-[1.35rem] md:w-[1.35rem]",
													activeTab !== "settings" && !isAccountSwitcherOpen
														? "ring-transparent"
														: "ring-[var(--accent)]",
												)}
											/>
										)}
										{(item.value === "inbox" && inboxUnseen) ||
										(item.value === "interest" && interestUnseen) ? (
											<span className="absolute -right-1 -top-1 flex h-2 w-2">
												<span
													className={cn(
														"absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
														activeTab === "right-now" || (activeTab === "browse" && isRightNowLive)
															? "bg-[var(--right-now)]"
															: activeTab === "browse" && isExploreActive
																? "bg-[var(--explore)]"
																: "bg-[var(--accent)]",
													)}
												></span>
												<span
													className={cn(
														"relative inline-block h-2 w-2 rounded-full ring-1 ring-[var(--surface)]",
														activeTab === "right-now" || (activeTab === "browse" && isRightNowLive)
															? "bg-[var(--right-now)]"
															: activeTab === "browse" && isExploreActive
																? "bg-[var(--explore)]"
																: "bg-[var(--accent)]",
													)}
												></span>
											</span>
										) : null}
									</div>
									{hideLabels && !rail ? (
										<span className="sr-only">{item.label}</span>
									) : (
										<span className={rail ? "w-full whitespace-normal break-words text-center text-[0.7rem] leading-tight" : "text-xs md:text-[0.8rem]"}>
											{item.label}
										</span>
									)}
								</TabsTrigger>
							);
						})}
					</TabsList>
				</Tabs>

				{isAccountSwitcherOpen && (
					<div
						ref={accountSwitcherRef}
						className={cn(
							"absolute z-50 w-max min-w-[14rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150",
							// Rail: opens to the right of the profile tab at the bottom.
							rail
								? "bottom-3 left-full ml-2 slide-in-from-left-2"
								: cn("bottom-full mb-2 slide-in-from-bottom-2", fullWidth ? "right-3" : "right-0"),
						)}
					>
						<div className="flex flex-col gap-1">
							{savedAccounts.map((account) => {
								const isActive = userId != null && String(userId) === account.profileId;
								const isSwitching = switchingProfileId === account.profileId;
								const savedProfile = getSavedAccountProfile(account.profileId);
								return (
									<button
										key={account.profileId}
										type="button"
										onClick={() => void handleSwitchAccount(account.profileId)}
										disabled={isActive || isSwitching}
										className="flex min-w-0 items-center gap-2.5 rounded-sm px-1.5 py-1.5 text-left transition-colors hover-fill disabled:cursor-default"
									>
										<div className="relative h-10 w-10 shrink-0">
											<Avatar
												src={savedProfile.photoHash ? getThumbImageUrl(savedProfile.photoHash, "75x75") : null}
												alt=""
												className="h-full w-full rounded-full border-0"
											/>
											{isSwitching && (
												<div className="absolute inset-0 flex items-center justify-center rounded-full bg-[var(--surface)]/80">
													<Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
												</div>
											)}
											{isActive && (
												<div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)] text-white ring-2 ring-[var(--surface)]">
													<Check className="h-2.5 w-2.5" strokeWidth={3} />
												</div>
											)}
										</div>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold leading-snug text-[var(--text)]">
												{savedProfile.displayName || t("settings.account_unnamed", { defaultValue: "Someone" })}
											</p>
											{account.email && (
												<p className="truncate text-xs text-[var(--text-muted)] leading-snug mt-0.5">
													{account.email}
												</p>
											)}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</nav>
	);
}