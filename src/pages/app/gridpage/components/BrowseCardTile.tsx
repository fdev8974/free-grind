import type { BrowseCard } from "../../GridPage.types";
import { Flame, MessageCircle, Plane, Satellite, Star, Zap } from "lucide-react";
import { MapPinFilled, MapPinOffFilled } from "../../../../components/icons/FilledIcons";
import { RightNowIcon } from "../../../../components/icons/RightNowIcon";
import { useTranslation } from "react-i18next";
import {
	formatDistance,
	getOnlineStatusMeta,
	getDisplayName,
} from "../utils";
import { cn } from "../../../../utils/cn";
import { ProfileImage } from "../../../../components/ui/profile-image";
import { usePreferences } from "../../../../contexts/PreferencesContext";
import type { ChatContactIndexRecord } from "../../../../types/chat-contact-index";
import { useRevealOnScroll } from "../../../../hooks/useRevealOnScroll";
import { useEffect, useRef, useState } from "react";
import { haptic } from "../../../../utils/haptics";
import { TileFlameBurst } from "./TileFlameBurst";
import type { GridTapStatus } from "../hooks/useGridTapStatus";

const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
// A second tap within this window counts as a double tap (flame); a single
// tap only opens the profile once the window has passed.
const DOUBLE_TAP_MS = 250;
const FLAME_BURST_MS = 1200;

type BrowseCardTileProps = {
	card: BrowseCard;
	chatContactStatus?: ChatContactIndexRecord | null;
	localNickname?: string;
	tapStatus?: GridTapStatus;
	onSelectProfile: (profileId: string) => void;
	/** Returns whether the tap was actually sent, which gates the fire animation. */
	onDoubleTapProfile?: (profileId: string, tapId: number) => boolean;
	onMessageProfile: (profileId: string) => void;
	onOpenContextMenu?: (card: BrowseCard, x: number, y: number) => void;
	isDesktop?: boolean;
	/** Hides the Popular badge, e.g. while sorted by distance where it's just noise. */
	hidePopular?: boolean;
};

export function BrowseCardTile({
	card,
	chatContactStatus,
	localNickname,
	tapStatus,
	onSelectProfile,
	onDoubleTapProfile,
	onMessageProfile,
	onOpenContextMenu,
	isDesktop = false,
	hidePopular = false,
}: BrowseCardTileProps) {
	const { t } = useTranslation();
	const { unitsPreset, showDebugInfo, blurGridProfilePictures, doubleTapTapType, doubleTapAction } = usePreferences();
	const { ref, revealClass } = useRevealOnScroll();
	const name = localNickname?.trim() || getDisplayName(card);
	const onlineStatus = getOnlineStatusMeta(card.lastOnline, card.onlineUntil);
	// Online but about to expire (<= 5 minutes left) — show the indicator in amber instead of green.
	const isOnlineEndingSoon = !!onlineStatus.isEndingSoon;
	const onlineTextColor = isOnlineEndingSoon ? "text-amber-500" : "text-green-500";
	const age = typeof card.age === "number" && card.age > 0 ? card.age : null;
	const isDemoCard = card.profileId.toString().startsWith("demo-");
	const isVisiting = card.isVisiting === true;
	const isRoaming = card.roaming === true;
	const isPopular = !hidePopular && card.isPopular === true;
	const isRightNow = card.rightNow === "HOSTING" || card.rightNow === "NOT_HOSTING";
	const isBoosting = card.isBoosting === true;
	const databaseUnread = chatContactStatus?.unreadCount ?? 0;
	const apiUnread = card.unreadCount ?? 0;
	const unreadCount = Math.max(databaseUnread, apiUnread);
	const hasChatted = Boolean(chatContactStatus?.hasChatted) || card.chatted === true || unreadCount > 0;
	const isFavorite = card.favorite === true;
	const hasSentTap = tapStatus?.sent != null;
	const hasReceivedTap = tapStatus?.received != null;

	// Long press on touch, right-click on mouse. The press is cancelled as
	// soon as the finger drifts (i.e. the user is scrolling the grid), and
	// the click that follows a fired long press is swallowed so the profile
	// doesn't open underneath the menu.
	const pressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
	const longPressTriggeredRef = useRef(false);
	const canOpenMenu = Boolean(onOpenContextMenu) && !isDemoCard;

	const cancelPress = () => {
		if (pressRef.current) {
			clearTimeout(pressRef.current.timer);
			pressRef.current = null;
		}
	};

	const handlePointerDown = (event: React.PointerEvent) => {
		longPressTriggeredRef.current = false;
		cancelPress();
		if (!canOpenMenu || event.pointerType === "mouse") return;
		const { clientX: x, clientY: y } = event;
		pressRef.current = {
			x,
			y,
			timer: setTimeout(() => {
				pressRef.current = null;
				longPressTriggeredRef.current = true;
				haptic(15);
				onOpenContextMenu?.(card, x, y);
			}, LONG_PRESS_MS),
		};
	};

	const handlePointerMove = (event: React.PointerEvent) => {
		const press = pressRef.current;
		if (!press) return;
		if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
			cancelPress();
		}
	};

	const handleContextMenu = (event: React.MouseEvent) => {
		event.preventDefault();
		// Android WebViews also fire contextmenu on a touch long press — the
		// timer above owns that case.
		if (!canOpenMenu || pressRef.current || longPressTriggeredRef.current) return;
		onOpenContextMenu?.(card, event.clientX, event.clientY);
	};

	const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [flameBurst, setFlameBurst] = useState<{ key: number; tapId: number } | null>(null);

	useEffect(() => {
		if (flameBurst === null) return;
		const timer = setTimeout(() => setFlameBurst(null), FLAME_BURST_MS);
		return () => clearTimeout(timer);
	}, [flameBurst]);

	useEffect(() => () => {
		if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
	}, []);

	const handleClick = () => {
		if (longPressTriggeredRef.current) {
			longPressTriggeredRef.current = false;
			return;
		}
		if (isDemoCard) return;
		// Without double tap there's nothing to wait for, so open right away.
		if (!onDoubleTapProfile || doubleTapTapType === null) {
			onSelectProfile(card.profileId);
			return;
		}

		if (singleTapTimerRef.current) {
			clearTimeout(singleTapTimerRef.current);
			singleTapTimerRef.current = null;
			if (doubleTapAction === "chat") {
				haptic(15);
				onMessageProfile(card.profileId);
				return;
			}
			if (onDoubleTapProfile(card.profileId, doubleTapTapType)) {
				haptic(30, [15, 10, 25]);
				setFlameBurst({ key: Date.now(), tapId: doubleTapTapType });
			}
			return;
		}

		singleTapTimerRef.current = setTimeout(() => {
			singleTapTimerRef.current = null;
			onSelectProfile(card.profileId);
		}, DOUBLE_TAP_MS);
	};


	return (
		<div ref={ref} className={cn(!isDesktop && "bg-black rounded-[4px] overflow-hidden", revealClass)}>
			<button
				type="button"
				key={card.profileId}
				onClick={handleClick}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={cancelPress}
				onPointerCancel={cancelPress}
				onPointerLeave={cancelPress}
				onContextMenu={handleContextMenu}
				className={cn(
					"no-touch-callout touch-manipulation surface-card-grid overflow-hidden text-left transition-transform w-full block relative",
					!isDemoCard && "active:scale-95",
					isDesktop
						? "rounded-xl shadow-sm"
						: "rounded-[4px]",
					isBoosting ? "p-[2.5px] z-20" : isRightNow ? "p-[2px]" : "p-0",
					isDemoCard && "cursor-default"
				)}
			>
				{/* Animated Gradient Border Layer (Enhanced Glow) */}
				{isBoosting ? (
					<div
						className="absolute inset-[-100%] animate-[spin_5s_linear_infinite] z-0 blur-[15px] opacity-100"
						style={{
							background: 'conic-gradient(from 0deg, transparent 0deg, var(--accent) 180deg, transparent 360deg)'
						}}
					/>
				) : isRightNow ? (
					/* Static pulsing border signalling "available right now" — suppressed
						while boosting so the two glows don't compete for attention. */
					<div
						className="absolute inset-0 z-0 rounded-[inherit] animate-pulse"
						style={{
							background: 'var(--right-now)',
							boxShadow: '0 0 8px 1px var(--right-now)',
						}}
					/>
				) : null}

				{/*
					Replace "aspect-[5/5]" with "h-0 pb-[100%]", since "aspect-ratio" collapses tile height to ~0 on
                    pre-iOS-15 WebKit. This triggered an endless pagination loop
                    that crashed the WebView renderer. thank you flo
				*/}
				<div className="relative w-full h-0 pb-[100%] bg-[var(--surface-2)] z-10 rounded-[inherit] overflow-hidden ring-1 ring-inset ring-white/10">
					<div className="absolute inset-0">
					<ProfileImage
						src={card.primaryImageUrl}
						alt={t("browse_page.profile_photo_alt", { name })}
						className={cn(
							(isDemoCard || blurGridProfilePictures) && "blur-md scale-110"
						)}
					/>

					{/* Top vignette — fixed height so it reads as a soft light source
						rather than a flat band clipped to the header content's height */}
					<div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 via-black/25 to-transparent pointer-events-none" />

					{/* Top Header: Name, Age & Status Cluster */}
					<div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2 text-white">
						<div className="min-w-0 flex-1">
							<p className="text-sm sm:text-base font-bold leading-tight truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
								{name}
								{age && <span className="font-semibold text-white/90 ml-1"> {age}</span>}
							</p>
						</div>

						<div className={cn(
							"flex shrink-0 items-center",
							onlineStatus.isOnline ? "gap-1" : "gap-0.5"
						)}>
							{(isRightNow || isPopular) && (
								<div className="flex items-center gap-0.5">
									{isPopular && (
										<span className="inline-flex" title="Popular">
											<Zap
												className="h-4 w-4 text-amber-400 drop-shadow-[0_1px_1.5px_rgba(0,0,0,1)] drop-shadow-[0_0_0.8px_rgba(0,0,0,1)]"
												strokeWidth={2.5}
											/>
										</span>
									)}
									{isRightNow && (
										<span className="inline-flex" title="Right Now">
											<RightNowIcon className="h-4 w-4 text-[var(--right-now)] drop-shadow-[0_1px_1.5px_rgba(0,0,0,1)] drop-shadow-[0_0_0.8px_rgba(0,0,0,1)]" />
										</span>
									)}
								</div>
							)}
							{onlineStatus.isOnline ? (
								isVisiting ? (
									<span className="inline-flex" title={t("profile_details.visiting")}>
										<Plane
											className={cn("h-4 w-4 drop-shadow-[0_1px_1.5px_rgba(0,0,0,1)] drop-shadow-[0_0_0.8px_rgba(0,0,0,1)]", onlineTextColor)}
											strokeWidth={2.5}
										/>
									</span>
								) : isRoaming ? (
									<span className="inline-flex" title={t("profile_details.roaming")}>
										<Satellite
											className={cn("h-4 w-4 drop-shadow-[0_1px_1.5px_rgba(0,0,0,1)] drop-shadow-[0_0_0.8px_rgba(0,0,0,1)]", onlineTextColor)}
											strokeWidth={2.5}
										/>
									</span>
								) : (
									<span className={cn("block h-3 w-3 rounded-full shadow-lg ring-2 ring-black/30", isOnlineEndingSoon ? "bg-amber-500" : "bg-green-500")} />
								)
							) : null}
							{!onlineStatus.isOnline && (
								<span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm sm:text-[11px]">
									{t(onlineStatus.labelKey, { count: onlineStatus.count })}
								</span>
							)}
						</div>
					</div>

					{/* Bottom-right: Interaction cluster */}
					<div className="absolute bottom-2 right-2 z-10 flex flex-col items-end gap-1">
						{/* Tap status sits above the row so it doesn't crowd favorite + chat
							next to the distance. Outlined flame = you tapped, filled = they
							tapped you, filled with a white outline = both (mutual). */}
						{(hasSentTap || hasReceivedTap) && (
							<div
								className="flex h-5 w-5 items-center justify-center drop-shadow-[0_1px_1.5px_rgba(0,0,0,1)] drop-shadow-[0_0_0.8px_rgba(0,0,0,1)]"
								title={hasSentTap && hasReceivedTap
									? t("browse_page.tile_tap.mutual", { defaultValue: "You tapped each other" })
									: hasSentTap
										? t("browse_page.tile_tap.sent", { defaultValue: "You tapped them" })
										: t("browse_page.tile_tap.received", { defaultValue: "They tapped you" })}
							>
								<Flame
									className={cn(
										"h-3.5 w-3.5",
										hasSentTap && hasReceivedTap
											? "fill-orange-500 text-white"
											: cn("text-orange-400", hasReceivedTap && "fill-current"),
									)}
									strokeWidth={hasSentTap && !hasReceivedTap ? 2.5 : 2}
								/>
							</div>
						)}
						<div className="flex items-center gap-1">
							{isFavorite && (
								<div className="flex h-5 w-5 items-center justify-center">
									<Star className="h-3.5 w-3.5 fill-current text-yellow-500 drop-shadow-[0_1px_1.5px_rgba(0,0,0,1)] drop-shadow-[0_0_0.8px_rgba(0,0,0,1)]" />
								</div>
							)}

							{unreadCount > 0 ? (
								<span className="flex h-5 min-w-5 flex-col items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-[var(--accent-contrast)] shadow-lg ring-1 ring-black/20">
									<span>{unreadCount}</span>
									{showDebugInfo && !isDemoCard && (
										<span className="text-[7px] leading-tight opacity-80">
											db:{databaseUnread} a:{apiUnread}
										</span>
									)}
								</span>
							) : hasChatted ? (
								<div className="flex h-5 w-5 items-center justify-center">
									<MessageCircle className="h-3.5 w-3.5 fill-current text-white drop-shadow-[0_1px_1.5px_rgba(0,0,0,1)] drop-shadow-[0_0_0.8px_rgba(0,0,0,1)]" />
								</div>
							) : null}
						</div>
					</div>

					{/* Bottom-left: Distance */}
					<div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/70 via-black/25 to-transparent pointer-events-none" />
					<div className="absolute bottom-2 left-2 z-10 flex h-5 items-center text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
						{card.distanceMeters == null || !Number.isFinite(card.distanceMeters) ? (
							<MapPinOffFilled className="h-3.5 w-3.5" />
						) : (
							<span className="inline-flex items-center gap-1 text-xs font-semibold">
								<MapPinFilled className="h-3.5 w-3.5" />
								{formatDistance(card.distanceMeters, t, unitsPreset)}
							</span>
						)}
					</div>

					{flameBurst !== null && <TileFlameBurst key={flameBurst.key} tapId={flameBurst.tapId} />}
					</div>
				</div>
			</button>
		</div>
	);
}
