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
