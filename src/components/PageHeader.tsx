import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "../utils/cn";
import { HeaderBackButton } from "./HeaderBackButton";

type PageHeaderProps = {
	title: ReactNode;
	/** Rendered below the header, scrolling with the content — not part of the sticky bar. */
	subtitle?: ReactNode;
	/** Shown right after the title (e.g. a badge). */
	titleAccessory?: ReactNode;
	/** Right-aligned header buttons. */
	actions?: ReactNode;
	backTo?: string;
	onBack?: () => void;
	backLabel?: string;
	className?: string;
	subtitleClassName?: string;
};

/** Distance (px) over which the backdrop fades in — same feel as the profile header. */
const FADE_DISTANCE = 24;

/** Sticky top bar for window-scrolled pages: back arrow + title, transparent at
 * the top and fading into an opaque, bordered bar once the page scrolls —
 * mirrors the profile page's floating header. Must be the first child of an
 * `.app-screen` (it pulls itself over that padding, see `.page-header`). */
export function PageHeader({
	title,
	subtitle,
	titleAccessory,
	actions,
	backTo,
	onBack,
	backLabel,
	className,
	subtitleClassName,
}: PageHeaderProps) {
	const navigate = useNavigate();
	const [progress, setProgress] = useState(0);

	useEffect(() => {
		const update = () => setProgress(Math.min(1, Math.max(0, window.scrollY / FADE_DISTANCE)));
		update();
		window.addEventListener("scroll", update, { passive: true });
		return () => window.removeEventListener("scroll", update);
	}, []);

	const handleBack = onBack ?? (backTo ? () => navigate(backTo) : undefined);

	return (
		<>
			{/* With a back button the row uses the profile header's gutter (px-4 sm:px-5) so
			    the icons sit where they do on the profile page and in the photo viewer. */}
			<header
				className={cn(
					"page-header sticky top-0 z-30 -mx-[var(--app-px)] pb-2.5",
					handleBack || actions ? "px-4 sm:px-5" : "px-[var(--app-px)]",
					!subtitle && "mb-4",
					className,
				)}
			>
				{/* Full-bleed (100vw, centred) so the bar spans the window on desktop rather than
				    stopping at the page's max-width; the overshoot is clipped by html's overflow-x. */}
				<div
					className="pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 border-b border-[var(--border)]"
					// Same frosted glass as the bottom NavBar.
					style={{
						opacity: progress,
						background: "color-mix(in srgb, var(--surface) 90%, transparent)",
						backdropFilter: "blur(16px)",
						WebkitBackdropFilter: "blur(16px)",
					}}
					aria-hidden="true"
				/>
				<div className="relative flex min-h-10 items-center gap-2">
					{handleBack && <HeaderBackButton onClick={handleBack} label={backLabel} />}
					<div className="flex min-w-0 flex-1 items-center gap-2">
						<h1 className="min-w-0 truncate text-lg font-semibold">{title}</h1>
						{titleAccessory}
					</div>
					{actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
				</div>
			</header>
			{subtitle && <p className={cn("app-subtitle mb-6 mt-1", subtitleClassName)}>{subtitle}</p>}
		</>
	);
}
