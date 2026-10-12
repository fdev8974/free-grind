import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Full-page prompt in the same fs-card shell as TokenExpiredPrompt and
 * VersionAnnouncement: full screen on mobile, a centered card on desktop.
 * No close button — `footer` holds the only ways out.
 */
export function FullscreenPrompt({
	icon: Icon,
	title,
	description,
	children,
	footer,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	children?: ReactNode;
	footer: ReactNode;
}) {
	return (
		<div className="fs-card-outer fs-card-overlay z-[110] no-touch-callout">
			<div className="fs-card-inner fs-card-lg flex flex-col">
				<div
					className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 text-center"
					style={{ paddingTop: "max(48px, env(safe-area-inset-top))", paddingBottom: "24px" }}
					data-lenis-prevent
				>
					<div className="mb-6 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]">
						<Icon className="h-9 w-9 text-[var(--accent)]" />
					</div>
					<h1 className="text-2xl font-bold text-[var(--text)]">{title}</h1>
					<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>
					{children ? <div className="mt-8 w-full max-w-sm">{children}</div> : null}
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
	"flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:brightness-110 disabled:opacity-60";

export const fullscreenSecondaryButtonClass =
	"w-full rounded-xl py-3 text-sm font-medium text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-60";
