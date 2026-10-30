import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

/**
 * App-shell backdrop for a full-screen prompt a routed page shows in place of
 * itself (settings previews, About's announcement). Portaled to <body> so it
 * covers the whole window: inside ProtectedLayout it would start right of the
 * desktop nav rail, leaving the rail visible beside/through the prompt.
 */
export function FullscreenPortal({ className = "", children }: { className?: string; children: ReactNode }) {
	return createPortal(<div className={`app-shell fixed inset-0 ${className}`}>{children}</div>, document.body);
}

/**
 * Full-page prompt in the same fs-card shell as TokenExpiredPrompt and
 * VersionAnnouncement: full screen on mobile, a centered card on desktop.
 * No close button — `footer` holds the only ways out. Pass `overlay` when
 * it's rendered on top of a page instead of replacing it: fs-card-outer is
 * transparent on mobile, so it then needs its own backdrop there.
 */
export function FullscreenPrompt({
	icon: Icon,
	title,
	description,
	children,
	footer,
	overlay = false,
}: {
	icon: LucideIcon;
	title: string;
	description?: string;
	children?: ReactNode;
	footer: ReactNode;
	overlay?: boolean;
}) {
	return (
		<div className="fs-card-outer fs-card-overlay z-[110] no-touch-callout">
			{overlay ? (
				// app-shell for the same bg + accent glow the gated prompts sit on;
				// the inline position/z-index override its relative/0.
				<div className="app-shell sm:hidden" style={{ position: "fixed", inset: 0, zIndex: -1, minHeight: 0 }} />
			) : null}
			<div className="fs-card-inner fs-card-lg flex flex-col">
				<div
					className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 text-center"
					style={{ paddingTop: "max(48px, env(safe-area-inset-top))", paddingBottom: "24px" }}
					data-lenis-prevent
				>
					{/* my-auto rather than justify-center: centers short content, but
					    content taller than the screen still scrolls from its top. */}
					<div className="my-auto flex w-full flex-col items-center">
						<div className={`mb-6 ${fullscreenIconTileClass}`}>
							<Icon className="h-9 w-9" />
						</div>
						<h1 className="text-2xl font-bold text-[var(--text)]">{title}</h1>
						{description ? (
							<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>
						) : null}
						{children ? <div className="mt-8 w-full max-w-sm">{children}</div> : null}
					</div>
				</div>

				<div
					className="flex shrink-0 flex-col gap-2 px-6 pt-2"
					style={{ paddingBottom: "max(28px, calc(env(safe-area-inset-bottom) + 12px))" }}
				>
					{footer}
				</div>
			</div>
		</div>
	);
}

export const fullscreenPrimaryButtonClass =
	"flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-[15px] font-semibold text-[var(--accent-contrast)] shadow-[0_4px_14px_rgba(0,0,0,0.2)] transition-[transform,filter] duration-150 hover:brightness-110 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

// Deliberately no fill: the secondary way out stays a quiet text button.
export const fullscreenSecondaryButtonClass =
	"w-full rounded-full py-3 text-sm font-medium text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-60";

/** Same borderless card as the app pages (.native-card in index.css). */
export const fullscreenCardClass = "native-card";

/** The prompt's big accent icon tile, also used by the onboarding steps. */
export const fullscreenIconTileClass =
	"flex h-20 w-20 shrink-0 items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_70%,black)] text-[var(--accent-contrast)] shadow-xl shadow-[var(--accent)]/25";
