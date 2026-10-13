import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Ban, EyeOff, MessageCircle, PencilLine, Star, StarOff } from "lucide-react";

type GridTileContextMenuProps = {
	x: number;
	y: number;
	isFavorite: boolean;
	hasNickname: boolean;
	onClose: () => void;
	onMessage: () => void;
	onToggleFavorite: () => void;
	onEditNickname: () => void;
	onHide: () => void;
	onBlock: () => void;
};

// Same shape as the chat inbox's ConversationContextMenu — portaled to
// <body> because PullToRefreshContainer applies a `transform` to its content,
// which would otherwise become the containing block for `position: fixed`.
export function GridTileContextMenu({
	x,
	y,
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

	const itemClassName =
		"flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm text-[var(--text)] transition hover:bg-[var(--surface-2)]";

	return createPortal(
		<div
			ref={menuRef}
			style={{ top: position.top, left: position.left }}
			onContextMenu={(e) => e.preventDefault()}
			className="no-touch-callout fixed z-[70] flex min-w-[190px] flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl"
		>
			<button type="button" onClick={onMessage} className={itemClassName}>
				<MessageCircle className="h-4 w-4" />
				{t("profile_details.message")}
			</button>
			<button type="button" onClick={onToggleFavorite} className={itemClassName}>
				{isFavorite ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
				{isFavorite ? t("chat.unfavorite") : t("chat.favorite")}
			</button>
			<button type="button" onClick={onEditNickname} className={itemClassName}>
				<PencilLine className="h-4 w-4" />
				{hasNickname ? t("chat.nicknames.edit") : t("chat.nicknames.set")}
			</button>
			<button type="button" onClick={onHide} className={itemClassName}>
				<EyeOff className="h-4 w-4" />
				{t("profile_details.hide")}
			</button>
			<div className="-mx-2 mt-1 border-t border-[var(--border)] pt-1" />
			<button
				type="button"
				onClick={onBlock}
				className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm text-red-500 transition hover:bg-red-500/10"
			>
				<Ban className="h-4 w-4" />
				{t("profile_details.block")}
			</button>
		</div>,
		document.body,
	);
}
