import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Ban, EyeOff, MessageCircle, Pencil, PencilLine, Star, StarOff } from "lucide-react";
import { SheetActionList, afterSheetClose } from "../../../../components/ui/action-sheet";
import { menuTransitionStyle } from "../../../../hooks/usePresence";
import { LocateFixedFilled } from "../../../../components/icons/FilledIcons";
import type { NicknameRename } from "../../../../hooks/useNicknameNameChange";

type GridTileContextMenuProps = {
	/** Drives the desktop menu's enter/exit transition (see usePresence). */
	visible?: boolean;
	x: number;
	y: number;
	isDesktop: boolean;
	title: string;
	isFavorite: boolean;
	hasNickname: boolean;
	/** Shown under the nickname action: their own display name, or the rename. */
	nicknameRename?: NicknameRename;
	onClose: () => void;
	onMessage: () => void;
	onToggleFavorite: () => void;
	onEditNickname: () => void;
	onHide: () => void;
	onBlock: () => void;
	/** Only passed while the optional Locate feature is enabled. */
	onLocate?: () => void;
	locateLabel?: string;
	/** Your own tile: then this is the only action (no message, favorite, hide, block…). */
	onEditProfile?: () => void;
};

type TileAction = {
	key: string;
	icon: ReactNode;
	label: string;
	description?: string;
	onClick: () => void;
	danger?: boolean;
};

// Mirrors chat messages: a positioned context menu on desktop, an action
// bottom sheet on mobile. Both close themselves before running the action
// (the sheet animates out via SheetClose), so the action callbacks don't.
export function GridTileContextMenu({
	visible = true,
	x,
	y,
	isDesktop,
	title,
	isFavorite,
	hasNickname,
	nicknameRename,
	onClose,
	onMessage,
	onToggleFavorite,
	onEditNickname,
	onHide,
	onBlock,
	onLocate,
	locateLabel,
	onEditProfile,
}: GridTileContextMenuProps) {
	const { t } = useTranslation();

	const actions: TileAction[] = onEditProfile ? [
		{
			key: "edit-profile",
			icon: <Pencil className={isDesktop ? "h-4 w-4" : "h-3.5 w-3.5"} />,
			label: t("profile_editor.edit_profile", { defaultValue: "Edit profile" }),
			onClick: onEditProfile,
		},
	] : [
		{
			key: "message",
			icon: <MessageCircle className={isDesktop ? "h-4 w-4" : "h-3.5 w-3.5"} />,
			label: t("profile_details.message"),
			onClick: onMessage,
		},
		{
			key: "favorite",
			icon: isFavorite
				? <StarOff className={isDesktop ? "h-4 w-4" : "h-3.5 w-3.5"} />
				: <Star className={isDesktop ? "h-4 w-4" : "h-3.5 w-3.5"} />,
			label: isFavorite ? t("chat.unfavorite") : t("chat.favorite"),
			onClick: onToggleFavorite,
		},
		{
			key: "nickname",
			icon: <PencilLine className={isDesktop ? "h-4 w-4" : "h-3.5 w-3.5"} />,
			label: hasNickname ? t("chat.nicknames.edit") : t("chat.nicknames.set"),
			description: nicknameRename?.realName
				? nicknameRename.previousName
					? t("chat.nicknames.real_name_changed", { previous: nicknameRename.previousName, name: nicknameRename.realName })
					: t("chat.nicknames.real_name", { name: nicknameRename.realName })
				: undefined,
			onClick: onEditNickname,
		},
		...(onLocate
			? [{
				key: "locate",
				icon: <LocateFixedFilled className={isDesktop ? "h-4 w-4" : "h-3.5 w-3.5"} />,
				label: locateLabel ?? t("profile_details.locate"),
				onClick: onLocate,
			}]
			: []),
		{
			key: "hide",
			icon: <EyeOff className={isDesktop ? "h-4 w-4" : "h-3.5 w-3.5"} />,
			label: t("profile_details.hide"),
			onClick: onHide,
		},
		{
			key: "block",
			icon: <Ban className={isDesktop ? "h-4 w-4" : "h-3.5 w-3.5"} />,
			label: t("profile_details.block"),
			onClick: onBlock,
			danger: true,
		},
	];

	if (!isDesktop) {
		return (
			<SheetActionList
				title={title}
				isDesktop={false}
				onClose={onClose}
				actions={actions.map((action) => ({
					key: action.key,
					icon: action.icon as ReactElement<{ className?: string }>,
					label: action.label,
					description: action.description,
					tone: action.danger ? "danger" : "default",
					// The closing sheet pops its history entry, which would undo a
					// navigation (Message) run right away — run actions after it.
					onSelect: () => afterSheetClose(action.onClick),
				}))}
			/>
		);
	}

	return <DesktopTileMenu visible={visible} x={x} y={y} actions={actions} onClose={onClose} />;
}

// Same shape as the chat inbox's ConversationContextMenu — portaled to
// <body> because PullToRefreshContainer applies a `transform` to its content,
// which would otherwise become the containing block for `position: fixed`.
function DesktopTileMenu({
	visible,
	x,
	y,
	actions,
	onClose,
}: {
	visible: boolean;
	x: number;
	y: number;
	actions: TileAction[];
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
		const handlePointerDown = (event: PointerEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				onClose();
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("scroll", onClose, true);
		window.addEventListener("resize", onClose);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("scroll", onClose, true);
			window.removeEventListener("resize", onClose);
		};
	}, [onClose]);

	return createPortal(
		<div
			ref={menuRef}
			style={{ top: position.top, left: position.left, ...menuTransitionStyle(visible, "top left") }}
			onContextMenu={(e) => e.preventDefault()}
			className="no-touch-callout fixed z-[70] flex min-w-[190px] flex-col gap-1 rounded-lg menu-surface p-2"
		>
			{actions.map((action) => (
				<Fragment key={action.key}>
					{action.danger && <div className="-mx-2 mt-1 border-t border-[var(--border)] pt-1" />}
					<button
						type="button"
						onClick={() => {
							onClose();
							action.onClick();
						}}
						className={`flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition ${
							action.danger
								? "text-red-500 hover:bg-red-500/10 active:bg-red-500/15"
								: "text-[var(--text)] hover-fill"
						}`}
					>
						{action.icon}
						{action.description ? (
							<span className="flex min-w-0 flex-col">
								<span>{action.label}</span>
								<span className="truncate text-xs text-[var(--text-muted)]">{action.description}</span>
							</span>
						) : action.label}
					</button>
				</Fragment>
			))}
		</div>,
		document.body,
	);
}
