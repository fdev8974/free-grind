/**
 * Determinate circular progress (0–100) drawn in currentColor, for places that
 * would otherwise show a spinner but know how far along they are.
 */
export function ProgressRing({
	progress,
	className,
	strokeWidth = 3,
}: {
	progress: number;
	className?: string;
	strokeWidth?: number;
}) {
	const radius = 12 - strokeWidth / 2;
	const circumference = 2 * Math.PI * radius;
	const clamped = Math.min(100, Math.max(0, progress));
	return (
		<svg
			viewBox="0 0 24 24"
			className={`-rotate-90 ${className ?? ""}`}
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(clamped)}
		>
			<circle cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={strokeWidth} />
			<circle
				cx="12"
				cy="12"
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeDasharray={circumference}
				strokeDashoffset={circumference * (1 - clamped / 100)}
				className="transition-[stroke-dashoffset] duration-300"
			/>
		</svg>
	);
}

/** Over a media preview while it uploads: the ring, and with `label` (e.g. a
 * video's phase) that and the percentage below it. `progress: null` is work
 * without a known end (e.g. the server still processing an upload): the ring
 * spins and the label goes without a percentage. Chat bubbles, the drawers'
 * upload placeholders, album items still processing. */
export function MediaUploadOverlay({ progress, label }: { progress: number | null; label?: string }) {
	// The preview dimmed as a whole, and a plain white ring on it (no disc
	// behind): white reads on any picture, and the accent stays "selected".
	return (
		<div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/50 text-white">
			{progress == null ? (
				<ProgressRing progress={25} className="h-9 w-9 animate-spin drop-shadow" />
			) : (
				<ProgressRing progress={progress} className="h-9 w-9 drop-shadow" />
			)}
			{label ? (
				<span className="max-w-[calc(100%-8px)] truncate text-[11px] font-semibold tabular-nums drop-shadow">
					{progress == null ? label : `${label} · ${Math.round(progress)}%`}
				</span>
			) : null}
		</div>
	);
}
