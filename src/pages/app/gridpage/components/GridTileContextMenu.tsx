import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Ban, EyeOff, MessageCircle, PencilLine, Star, StarOff, X } from "lucide-react";
import { BottomSheet, SheetClose } from "../../../../components/ui/bottom-sheet";

type GridTileContextMenuProps = {
	x: number;
	y: number;
	isDesktop: boolean;
	title: string;
	isFavorite: boolean;
	hasNickname: boolean;
	onClose: () => void;
	onMessage: () => void;
	onToggleFavorite: () => void;
	onEditNickname: () => void;
	onHide: () => void;
	onBlock: () => void;
};

type TileAction = {
	key: string;
	icon: ReactNode;
	label: string;
	onClick: () => void;
	danger?: boolean;
};

// Mirrors chat messages: a positioned context menu on desktop, an action
// bottom sheet on mobile. Both close themselves before running the action
// (the sheet animates out via SheetClose), so the action callbacks don't.
export function GridTileContextMenu({
	x,
	y,
	isDesktop,
	title,
	isFavorite,
	hasNickname,
	onClose,
	onMessage,
	onToggleFavorite,
	onEditNickname,
	onHide,
	onBlock,
}: GridTileContextMenuProps) {
	const { t } = useTranslation();

	const actions: TileAction[] = [
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
			onClick: onEditNickname,
		},
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
			<BottomSheet
				isDesktop={false}
				onClose={onClose}
				bg="bg-[color-mix(in_srgb,var(--surface)_92%,black_8%)]"
			>
				<div className="flex items-center justify-between gap-2 px-4 pb-3">
					<p className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">{title}</p>
					<SheetClose className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
						<X className="h-4 w-4" />
					</SheetClose>
				</div>
				<div className="divide-y divide-[var(--border)] pb-1">
					{actions.map((action) => (
						<SheetClose
							key={action.key}
							onClick={action.onClick}
							className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium transition active:bg-[var(--surface-2)] ${
								action.danger ? "text-red-400" : "text-[var(--text)]"
							}`}
						>
							<div
								className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${
									action.danger ? "bg-red-500/10 text-red-400" : "bg-[var(--surface-2)] text-[var(--accent)]"
								}`}
							>
								{action.icon}
							</div>
							{action.label}
						</SheetClose>
					))}
				</div>
			</BottomSheet>
		);
	}

	return <DesktopTileMenu x={x} y={y} actions={actions} onClose={onClose} />;
}

// Same shape as the chat inbox's ConversationContextMenu — portaled to
// <body> because PullToRefreshContainer applies a `transform` to its content,
// which would otherwise become the containing block for `position: fixed`.
function DesktopTileMenu({
	x,
	y,
	actions,
	onClose,
}: {
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
			style={{ top: position.top, left: position.left }}
			onContextMenu={(e) => e.preventDefault()}
			className="no-touch-callout fixed z-[70] flex min-w-[190px] flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl"
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
