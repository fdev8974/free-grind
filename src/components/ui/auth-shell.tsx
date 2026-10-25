import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../utils/cn";
import freeGrindLogo from "../../images/freegrind-logo.webp";

export function AuthShell({
	title,
	subtitle,
	children,
	footer,
	toolbar,
	gestureProps,
}: {
	title: string;
	subtitle: string;
	children: ReactNode;
	footer?: ReactNode;
	/** Pinned between the header and the scrolling form, e.g. a method switcher. */
	toolbar?: ReactNode;
	/** Touch handlers for the scrolling form, e.g. useSwipeTabs for the toolbar's tabs. */
	gestureProps?: HTMLAttributes<HTMLDivElement>;
}) {
	return (
		<div className="fs-card-outer">
			<div className="fs-card-inner">
				<div
					className="auth-glow animate-morph-glow pointer-events-none absolute left-1/2 top-0 -z-0 h-96 w-96 -translate-x-1/2 -translate-y-1/2"
					style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 28%, transparent) 0%, transparent 70%)" }}
					aria-hidden="true"
				/>

				{/* Header */}
				<div
					className="animate-fade-in relative flex shrink-0 flex-col items-center px-6 pb-10 text-center"
					style={{ paddingTop: "max(64px, env(safe-area-inset-top))" }}
				>
					<img
						src={freeGrindLogo}
						alt="Free Grind"
						className="mb-7 h-16 w-16 rounded-2xl object-cover drop-shadow-[0_12px_20px_rgba(0,0,0,0.4)]"
					/>
					<h1 className="text-2xl font-bold text-[var(--text)]">{title}</h1>
					<p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">{subtitle}</p>
				</div>

				{toolbar ? <div className="animate-fade-in relative shrink-0 px-6">{toolbar}</div> : null}

				{/* Form */}
				<div
					className={cn(
						"animate-fade-in relative flex min-h-0 flex-1 flex-col overflow-y-auto px-6",
						// Content fades out under the pinned toolbar instead of being cut off hard.
						toolbar
							? "pt-5 [mask-image:linear-gradient(to_bottom,transparent,black_20px)]"
							: // Room for the inputs' focus outline, which the scroll container would clip.
								"pt-1",
					)}
					data-lenis-prevent
					{...gestureProps}
				>
					<div className="flex-1">{children}</div>
					{footer ? (
						<div
							className="mt-6 text-center"
							style={{ paddingBottom: "max(24px, calc(env(safe-area-inset-bottom) + 16px))" }}
						>
							{footer}
						</div>
					) : (
						<div style={{ paddingBottom: "max(24px, calc(env(safe-area-inset-bottom) + 16px))" }} />
					)}
				</div>
			</div>
		</div>
	);
}
