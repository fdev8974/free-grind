import { useState } from "react";
import { createPortal } from "react-dom";
import { useIsHalloween } from "../hooks/useIsHalloween";
import { useDesktopBreakpoint } from "../hooks/useDesktopBreakpoint";

// Blood running down from the top edge: [left %, width px, length px, duration s, delay s].
// Lengths are for desktop; see MOBILE_SCALE.
const DRIPS: [number, number, number, number, number][] = [
	[2.5, 9, 46, 11, 0],
	[8, 6, 22, 9, 3.1],
	[14.5, 12, 78, 14, 1.4],
	[21, 7, 30, 10, 5.6],
	[27.5, 5, 18, 8, 2.2],
	[33, 10, 58, 12, 7.3],
	[40, 7, 26, 9, 0.8],
	[46.5, 14, 96, 16, 4.1],
	[53, 6, 20, 8, 6.4],
	[58.5, 9, 44, 11, 2.7],
	[65, 11, 70, 13, 8.2],
	[71.5, 6, 24, 9, 1.9],
	[77, 8, 36, 10, 5.1],
	[83.5, 13, 88, 15, 3.3],
	[90, 6, 28, 9, 6.9],
	[96, 9, 50, 12, 0.5],
];

// Irregular pool along the top: [left %, radius px].
const BLOBS: [number, number][] = Array.from({ length: 42 }, (_, i) => [i * 2.5, 6 + ((i * 37) % 11)]);

// On mobile the header controls (location pill, filters) sit right below the
// status bar, so the blood stays a thin fringe there instead of covering them.
const MOBILE_SCALE = 0.35;

// Drip cycle: grows slowly, a drop falls off, the rest pulls back up a bit.
const GROW_KEYS = "0;0.62;0.68;1";
const GROW_SPLINES = "0.5 0 0.9 0.6;0.2 0 0.4 1;0.4 0 0.6 1";

function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HalloweenOverlay() {
	const isHalloween = useIsHalloween();
	const [still] = useState(prefersReducedMotion);
	const scale = useDesktopBreakpoint() ? 1 : MOBILE_SCALE;
	if (!isHalloween) {
		return null;
	}

	return createPortal(
		<div className="pointer-events-none fixed inset-0 z-[9998] overflow-hidden" aria-hidden="true">
			<div className="halloween-vignette absolute inset-0" />

			{/* Falling drops: outside the goo filter so they stay crisp over the whole screen. */}
			{!still && (
				<svg className="absolute inset-0 h-full w-full overflow-visible">
					{DRIPS.filter(([, width]) => width >= 9).map(([left, width, fullLength, dur, delay]) => {
						const length = Math.round(fullLength * scale);
						return (
						<svg key={left} x={`${left}%`} overflow="visible">
							<ellipse cx={0} cy={length} rx={width * 0.45} ry={width * 0.6} fill="#a8001a" opacity={0}>
								<animate attributeName="cy" values={`${length};${length};${length + 1400}`} keyTimes="0;0.62;0.8" calcMode="spline" keySplines="0 0 1 1;0.55 0 1 0.45" dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
								<animate attributeName="opacity" values="0;0;0.9;0.9;0" keyTimes="0;0.61;0.62;0.76;0.8" dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
							</ellipse>
						</svg>
						);
					})}
				</svg>
			)}

			<svg className="halloween-blood absolute inset-x-0 top-0 h-[140px] w-full overflow-visible">
				<defs>
					<linearGradient id="halloween-blood-fill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="120">
						<stop offset="0" stopColor="#2e0004" />
						<stop offset="0.25" stopColor="#7a000e" />
						<stop offset="1" stopColor="#c2001e" />
					</linearGradient>
					{/* Gooey merge (blur + alpha threshold) so drips flow out of the pool like
					    liquid, then a specular pass for a wet sheen. */}
					<filter id="halloween-goo" x="-5%" y="-20%" width="110%" height="140%" colorInterpolationFilters="sRGB">
						<feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
						<feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="goo" />
						<feGaussianBlur in="goo" stdDeviation="2.5" result="gooBlur" />
						<feSpecularLighting in="gooBlur" surfaceScale="5" specularConstant="1" specularExponent="28" lightingColor="#ff9a9a" result="spec">
							<feDistantLight azimuth="235" elevation="50" />
						</feSpecularLighting>
						<feComposite in="spec" in2="goo" operator="in" result="sheen" />
						<feComposite in="goo" in2="sheen" operator="arithmetic" k1="0" k2="1" k3="0.55" k4="0" />
					</filter>
				</defs>
				<g filter="url(#halloween-goo)" fill="url(#halloween-blood-fill)">
					<rect x="0" y="-20" width="100%" height="28" />
					{BLOBS.map(([left, r]) => (
						<circle key={left} cx={`${left}%`} cy={4} r={scale < 1 ? r * 0.7 : r} />
					))}
					{DRIPS.map(([left, width, fullLength, dur, delay]) => {
						const length = Math.round(fullLength * scale);
						const head = width * 0.75;
						const rest = Math.round(length * 0.55);
						const timing = { dur: `${dur}s`, begin: `${delay}s`, repeatCount: "indefinite", calcMode: "spline", keyTimes: GROW_KEYS, keySplines: GROW_SPLINES } as const;
						return (
							<svg key={left} x={`${left}%`} overflow="visible">
								<rect x={-width / 2} y={0} width={width} height={still ? length : 4} rx={width / 2}>
									{!still && <animate attributeName="height" values={`4;${length};${rest};4`} {...timing} />}
								</rect>
								<circle cx={0} cy={still ? length : 4} r={head}>
									{!still && <animate attributeName="cy" values={`4;${length};${rest};4`} {...timing} />}
								</circle>
							</svg>
						);
					})}
				</g>
			</svg>
		</div>,
		document.body,
	);
}
