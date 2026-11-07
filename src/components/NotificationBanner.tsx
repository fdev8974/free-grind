import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";

type NotificationBannerProps = {
	title: string;
	body: string;
	/** Small label in the title row's trailing corner, e.g. "Now". */
	meta?: string;
	avatarUrl?: string | null;
	/** Shown in place of the avatar when there's no picture. */
	fallbackIcon?: ReactNode;
	/** Small badge on the avatar's corner (e.g. the tap emoji). */
	badge?: ReactNode;
	onOpen: () => void;
};

/**
 * Content of an in-app notification toast (chat message, tap), laid out like
 * a system notification banner: round avatar, bold sender line with a
 * trailing timestamp, and up to two lines of body text. Rendered inside
 * AppToaster's banner variant (BANNER_TOAST_CLASS), which supplies the
 * floating glass surface, width and swipe-to-dismiss.
 */
export function NotificationBanner({ title, body, meta, avatarUrl, fallbackIcon, badge, onOpen }: NotificationBannerProps) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full min-w-0 items-center gap-3 rounded-[18px] text-left transition-transform duration-150 active:scale-[0.98]"
		>
			<span className="relative shrink-0">
				{avatarUrl ? (
					<img
						src={avatarUrl}
						alt=""
						draggable={false}
						className="h-11 w-11 rounded-full bg-[var(--surface-2,var(--border))] object-cover"
					/>
				) : (
					<span className="flex h-11 w-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
						{fallbackIcon ?? <MessageCircle className="h-5 w-5" />}
					</span>
				)}
				{badge ? (
					<span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface)] text-[12px] leading-none shadow-sm ring-1 ring-[var(--border)]/40">
						{badge}
					</span>
				) : null}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-baseline gap-2">
					<span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight text-[var(--text)]">
						{title}
					</span>
					{meta ? <span className="shrink-0 text-xs font-normal text-[var(--text-muted)]">{meta}</span> : null}
				</span>
				<span className="line-clamp-2 text-sm font-normal leading-snug text-[var(--text-muted)]">{body}</span>
			</span>
		</button>
	);
}
