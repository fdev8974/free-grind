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
			<header
				className={cn(
					"page-header sticky top-0 z-30 -mx-[var(--app-px)] px-[var(--app-px)] pb-4",
					subtitle ? "rail:mb-6" : "mb-4",
					className,
				)}
			>
				{/* Desktop nav rail: no bar, which would either run behind the rail or stop
				    hard at it. The content just fades out into the page background under the
				    header, like the tab pages' scroll containers. */}
				<div
					className="page-backdrop pointer-events-none absolute inset-x-0 top-0 -bottom-6 hidden rail:block"
					style={{
						opacity: progress,
						maskImage: "linear-gradient(to bottom, black 70%, transparent)",
						WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent)",
					}}
					aria-hidden="true"
				/>
				{/* Full-bleed (100vw, centred) so the bar spans the window rather than stopping
				    at the page's max-width; the overshoot is clipped by html's overflow-x. */}
				<div
					className="pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 border-b border-[var(--border)]/60 rail:hidden"
					// Same frosted glass as the bottom NavBar and the chat composer.
					style={{
						opacity: progress,
						background: "color-mix(in srgb, var(--surface) 86%, transparent)",
						backdropFilter: "blur(24px)",
						WebkitBackdropFilter: "blur(24px)",
					}}
					aria-hidden="true"
				/>
				{/* Row is exactly one tab-header title line tall; the taller buttons overflow it
				    symmetrically, so their centres land on --header-icon-center like the Inbox icons. */}
				{/* Grid so the desktop subtitle below can share the title's column. With a
				    subtitle, desktop stacks title + subtitle as one block with the buttons
				    centred on it, like the Sexual Health / Videos headers. */}
				<div className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
					{handleBack ? (
						<div className={cn("flex h-[var(--header-row-h)] items-center", subtitle && "rail:row-span-2")}>
							<HeaderBackButton onClick={handleBack} label={backLabel} />
						</div>
					) : <span />}
					<div className={cn("flex h-[var(--header-row-h)] min-w-0 items-center gap-2", subtitle && "rail:h-auto", !handleBack && "-ml-2")}>
						<h1 className="min-w-0 truncate text-lg font-semibold">{title}</h1>
						{titleAccessory}
					</div>
					{actions ? (
						<div className={cn("flex h-[var(--header-row-h)] shrink-0 items-center gap-1", subtitle && "rail:row-span-2")}>{actions}</div>
					) : <span className={cn(subtitle && "rail:row-span-2")} />}
					{/* Desktop: the subtitle sits in the header right under the title, so it
					    stays visible while the page scrolls. */}
					{subtitle && (
						<p className={cn("app-subtitle col-start-2 hidden rail:block", !handleBack && "-ml-2")}>
							{subtitle}
						</p>
					)}
				</div>
			</header>
			{subtitle && <p className={cn("app-subtitle mb-6 mt-1 rail:hidden", subtitleClassName)}>{subtitle}</p>}
		</>
	);
}
