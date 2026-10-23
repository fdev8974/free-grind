import { useCallback, useEffect, useState, useRef } from "react";
import { cn } from "../../utils/cn";

interface RangeSliderProps {
	min: number;
	max: number;
	step?: number;
	minDefault: number;
	maxDefault: number;
	label: string;
	unit?: string;
	formatValue?: (value: number) => string;
	activeColor?: string;
	onChange: (min: number, max: number) => void;
	showSeparator?: boolean;
	/** Skips the built-in label/value row entirely — use when the label and current value are already shown by a surrounding section header. */
	hideHeader?: boolean;
}

interface SliderProps {
	min: number;
	max: number;
	step?: number;
	defaultValue: number;
	label: string;
	displayValue: string;
	activeColor?: string;
	trackColor?: string;
	hideHeader?: boolean;
	/** Floats displayValue in a bubble above the thumb, following it as it's dragged, instead of (or in addition to) the header badge. */
	showValueBubble?: boolean;
	onChange: (value: number) => void;
	/** Fires once when the user releases the thumb (mouse/touch/keyboard), separately from the continuous `onChange` — use this to persist the value instead of writing on every intermediate tick while dragging. */
	onCommit?: (value: number) => void;
}

// Matches the 24px thumb in sliderStyles below. The native thumb's travel is
// inset by half its own width at each end (so it never overflows the track),
// so a thumb's center sits at `HALF + percent * (100% - THUMB)` — the filled
// range and the value bubble use the same formula to line up with it exactly.
const THUMB_SIZE_PX = 24;
const HALF_THUMB_PX = THUMB_SIZE_PX / 2;
function thumbCenterOffset(percent: number): string {
	return `calc(${HALF_THUMB_PX}px + ${percent / 100} * (100% - ${THUMB_SIZE_PX}px))`;
}

/**
 * Shared styles for both RangeSlider and Slider components.
 *
 * DESIGN NOTE:
 * Styling range inputs across different WebViews (WebKit on iOS/Android, WebView2 on Windows)
 * requires vendor-specific pseudo-elements. We use pointer-events: none on the container
 * and pointer-events: all on the thumb to allow overlapping inputs in the RangeSlider.
 * The native track is made exactly thumb-tall and transparent, so the thumb is centered
 * by construction in every engine; the visible track is drawn by .slider below.
 * No color-mix() here: webviews without it would get Tailwind-style solid fallbacks.
 */
const sliderStyles = `
	.thumb,
	.thumb::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		-webkit-tap-highlight-color: transparent;
	}

	.thumb {
		pointer-events: none; /* Disable interaction on the container track */
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		height: ${THUMB_SIZE_PX}px;
		width: 100%;
		margin: 0;
		outline: none;
		background: none;
	}

	.thumb--left {
		z-index: 3;
	}

	.thumb--right {
		z-index: 4;
	}

	.thumb--single {
		z-index: 5;
	}

	.thumb::-webkit-slider-runnable-track {
		height: ${THUMB_SIZE_PX}px;
		background: transparent;
		border: none;
	}

	.thumb::-moz-range-track {
		height: ${THUMB_SIZE_PX}px;
		background: transparent;
		border: none;
	}

	.thumb::-webkit-slider-thumb {
		width: ${THUMB_SIZE_PX}px;
		height: ${THUMB_SIZE_PX}px;
		margin-top: 0;
		border: none;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), 0 0 0 0.5px rgba(0, 0, 0, 0.12);
		cursor: grab;
		pointer-events: all; /* Re-enable interaction specifically for the thumb */
		transition: transform 120ms ease;
	}

	.thumb::-moz-range-thumb {
		width: ${THUMB_SIZE_PX}px;
		height: ${THUMB_SIZE_PX}px;
		border: none;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), 0 0 0 0.5px rgba(0, 0, 0, 0.12);
		cursor: grab;
		pointer-events: all;
		transition: transform 120ms ease;
	}

	.thumb:active::-webkit-slider-thumb {
		cursor: grabbing;
		transform: scale(1.12);
	}

	.thumb:active::-moz-range-thumb {
		cursor: grabbing;
		transform: scale(1.12);
	}

	.thumb:focus-visible::-webkit-slider-thumb {
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), 0 0 0 3px var(--slider-color, var(--accent));
	}

	.thumb:focus-visible::-moz-range-thumb {
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), 0 0 0 3px var(--slider-color, var(--accent));
	}

	/* Visible track, centered on the thumbs */
	.slider {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 6px;
		transform: translateY(-50%);
	}

	.slider__track,
	.slider__range {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: 9999px;
	}

	.slider__track {
		left: 0;
		right: 0;
		background: var(--track-color, rgba(127, 127, 127, 0.25));
		z-index: 1;
	}

	.slider__range {
		background: var(--slider-color, var(--accent));
		z-index: 2;
	}
`;

/** Neutral value pill for the optional header row. */
const VALUE_PILL_CLASS = "rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold tabular-nums text-[var(--text)]";

/**
 * A custom Dual-Range Slider component for selecting a range (min/max).
 */
export function RangeSlider({
	min,
	max,
	step = 1,
	minDefault,
	maxDefault,
	label,
	unit = "",
	formatValue,
	activeColor,
	onChange,
	showSeparator = false,
	hideHeader = false,
}: RangeSliderProps) {
	const [minValue, setMinValue] = useState(minDefault);
	const [maxValue, setMaxValue] = useState(maxDefault);
	const minValRef = useRef(minDefault);
	const maxValRef = useRef(maxDefault);

	const style = activeColor ? { "--slider-color": activeColor } as React.CSSProperties : {};

	useEffect(() => {
		setMinValue(minDefault);
		minValRef.current = minDefault;
	}, [minDefault]);

	useEffect(() => {
		setMaxValue(maxDefault);
		maxValRef.current = maxDefault;
	}, [maxDefault]);

	const getPercent = useCallback(
		(value: number) => ((value - min) / (max - min)) * 100,
		[min, max],
	);

	return (
		<div className="flex flex-col gap-0.5 py-1" style={style}>
			{!hideHeader && (
				<div
					className={cn("flex justify-between items-center mb-1", showSeparator && "border-b border-[var(--border)] pb-2 mb-2")}
				>
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
							{label}
						</span>
					</div>
					<span className={VALUE_PILL_CLASS}>
						{formatValue ? formatValue(minValue) : `${minValue}${unit}`} - {formatValue ? formatValue(maxValue) : `${maxValue}${unit}`}{maxValue >= max ? "+" : ""}
					</span>
				</div>
			)}

			<div className="relative h-10 flex items-center">
				<input
					type="range"
					min={min}
					max={max}
					step={step}
					value={minValue}
					onChange={(event) => {
						const value = Math.min(Number(event.target.value), maxValue - step);
						setMinValue(value);
						minValRef.current = value;
						onChange(value, maxValue);
					}}
					className="thumb thumb--left"
					style={{ zIndex: minValue > max - 100 ? "5" : undefined }}
				/>
				<input
					type="range"
					min={min}
					max={max}
					step={step}
					value={maxValue}
					onChange={(event) => {
						const value = Math.max(Number(event.target.value), minValue + step);
						setMaxValue(value);
						maxValRef.current = value;
						onChange(minValue, value);
					}}
					className="thumb thumb--right"
				/>

				<div className="slider">
					<div className="slider__track" />
					<div
						className="slider__range"
						style={{
							left: thumbCenterOffset(getPercent(minValue)),
							right: `calc(100% - ${thumbCenterOffset(getPercent(maxValue))})`,
						}}
					/>
				</div>
			</div>

			<style>{sliderStyles}</style>
		</div>
	);
}

/**
 * A custom Single-Handle Slider component for selecting a single value.
 * Used for filters like "Max Distance".
 */
export function Slider({
	min,
	max,
	step = 1,
	defaultValue,
	label,
	displayValue,
	activeColor,
	trackColor,
	hideHeader = false,
	showValueBubble = false,
	onChange,
	onCommit,
}: SliderProps) {
	const [value, setValue] = useState(defaultValue);

	const style = {
		...(activeColor ? { "--slider-color": activeColor } : {}),
		...(trackColor ? { "--track-color": trackColor } : {}),
	} as React.CSSProperties;

	useEffect(() => {
		setValue(defaultValue);
	}, [defaultValue]);

	const getPercent = useCallback(
		(val: number) => ((val - min) / (max - min)) * 100,
		[min, max],
	);

	return (
		<div className="flex flex-col gap-0.5 py-1" style={style}>
			{!hideHeader && (
				<div className="flex justify-between items-center mb-1">
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
							{label}
						</span>
					</div>
					<span className={VALUE_PILL_CLASS}>
						{displayValue}
					</span>
				</div>
			)}

			<div className={`relative flex items-center h-10 ${showValueBubble ? "mt-4" : ""}`}>
				{showValueBubble && (
					<div
						className="pointer-events-none absolute -top-4 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--slider-color,var(--accent))] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-contrast)]"
						style={{ left: thumbCenterOffset(getPercent(value)) }}
					>
						{displayValue}
					</div>
				)}
				<input
					type="range"
					min={min}
					max={max}
					step={step}
					value={value}
					onChange={(event) => {
						const val = Number(event.target.value);
						setValue(val);
						onChange(val);
					}}
					onMouseUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
					onTouchEnd={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
					onKeyUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
					className="thumb thumb--single"
				/>

				<div className="slider">
					<div className="slider__track" />
					<div
						className="slider__range"
						style={{ left: 0, width: thumbCenterOffset(getPercent(value)) }}
					/>
				</div>
			</div>

			<style>{sliderStyles}</style>
		</div>
	);
}
