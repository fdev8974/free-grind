import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";

type NotificationBannerProps = {
	title: string;
	body: string;
	avatarUrl?: string | null;
	/** Shown in place of the avatar when there's no picture. */
	fallbackIcon?: ReactNode;
	/** Small badge on the avatar's corner (e.g. the tap emoji). */
	badge?: ReactNode;
	onOpen: () => void;
};

/**
 * Content of an in-app notification toast (chat message, tap), laid out like
 * an inbox row: round avatar, bold sender name, and up to two lines of body
 * text. Rendered inside AppToaster's banner variant (BANNER_TOAST_CLASS),
 * which supplies the menu-surface card, width and swipe-to-dismiss.
 */
export function NotificationBanner({ title, body, avatarUrl, fallbackIcon, badge, onOpen }: NotificationBannerProps) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full min-w-0 items-center gap-3 text-left transition-transform duration-150 active:scale-[0.98]"
		>
			<span className="relative shrink-0">
				{avatarUrl ? (
					<img
						src={avatarUrl}
						alt=""
						draggable={false}
						className="h-11 w-11 rounded-full bg-[var(--surface-2)] object-cover"
					/>
				) : (
					<span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--accent-readable)]">
						{fallbackIcon ?? <MessageCircle className="h-5 w-5" />}
					</span>
				)}
				{badge ? (
					<span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--menu-bg)] text-[12px] leading-none">
						{badge}
					</span>
				) : null}
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[15px] font-semibold leading-snug text-[var(--text)]">{title}</span>
				<span className="line-clamp-2 break-words [overflow-wrap:anywhere] text-sm font-normal leading-snug text-[var(--text-muted)]">{body}</span>
			</span>
		</button>
	);
}
