import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

/** Tap ids as the API uses them: 0 = 👋, 1 = 🔥, 2 = 😈. */
export const tapEmoji = (id: number) => id === 0 ? "👋" : id === 2 ? "😈" : "🔥";
export const tapParticleColor = (id: number) => id === 0 ? "rgba(234,179,8,0.9)" : id === 2 ? "rgba(168,85,247,0.9)" : "rgba(249,115,22,0.9)";
export const tapGlow = (id: number) => id === 0 ? "drop-shadow(0 0 10px rgba(234,179,8,0.95))" : id === 2 ? "drop-shadow(0 0 10px rgba(168,85,247,0.95))" : "drop-shadow(0 0 10px rgba(249,115,22,0.95))";

type TapParticle = { dx: number; dy: number; size: number; dur: number; delay: number; emoji?: string };

export type TapFlyBurstState = {
	id: number;
	/** Restarts the animation when it changes (e.g. Date.now()). */
	key: number;
	/** Where the emoji starts, as an offset from the screen center. */
	originDx: number;
	originDy: number;
	particles: TapParticle[];
};

export function makeTapParticles(tapId?: number): TapParticle[] {
	const dots = Array.from({ length: 28 }, (_, i) => {
		const angle = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
		const dist = Math.random() * 280 + 160;
		return {
			dx: Math.cos(angle) * dist,
			dy: Math.sin(angle) * dist,
			size: Math.random() * 10 + 4,
			dur: Math.random() * 0.45 + 0.4,
			delay: Math.random() * 0.08 + 0.62,
		};
	});
	const eggplants = tapId === 2 ? Array.from({ length: 6 }, (_, i) => {
		const angle = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
		const dist = Math.random() * 260 + 140;
		return {
			dx: Math.cos(angle) * dist,
			dy: Math.sin(angle) * dist,
			size: 24,
			dur: Math.random() * 0.3 + 1.0,
			delay: Math.random() * 0.1 + 0.64,
			emoji: "🍆",
		};
	}) : [];
	return [...dots, ...eggplants];
}

/** A burst starting from `el` (the button that sent the tap). */
export function createTapFlyBurst(tapId: number, el: Element | null | undefined): TapFlyBurstState {
	const rect = el?.getBoundingClientRect();
	return {
		id: tapId,
		key: Date.now(),
		originDx: rect ? rect.left + rect.width / 2 - window.innerWidth / 2 : window.innerWidth / 2 - 110,
		originDy: rect ? rect.top + rect.height / 2 - window.innerHeight / 2 : window.innerHeight / 2 - 80,
		particles: makeTapParticles(tapId),
	};
}

/** How long a burst runs; clear the state after this. */
export const TAP_FLY_BURST_MS = 1400;

/**
 * The sent-tap effect: the emoji flies from its button to the screen center,
 * grows and fades, then bursts into particles. Portaled to <body> so it covers
 * the screen above any sheet or viewer.
 */
export function TapFlyBurst({ burst }: { burst: TapFlyBurstState }) {
	return createPortal(
		<>
			{burst.particles.map((p, i) => p.emoji ? (
				<span
					key={`p-${burst.key}-${i}`}
					className="animate-emoji-particle-rise"
					style={{
						left: "50%", top: "50%", opacity: 0,
						fontSize: `${p.size}px`, lineHeight: 1,
						filter: tapGlow(burst.id), zIndex: 202,
						"--dx": `${p.dx}px`, "--dy": `${p.dy}px`,
						"--dur": `${p.dur}s`, "--delay": `${p.delay}s`,
					} as CSSProperties}
				>{p.emoji}</span>
			) : (
				<div
					key={`p-${burst.key}-${i}`}
					className="animate-particle-rise"
					style={{
						left: "50%", top: "50%", opacity: 0,
						width: `${p.size}px`, height: `${p.size}px`,
						background: tapParticleColor(burst.id),
						boxShadow: `0 0 ${p.size * 3}px ${p.size}px ${tapParticleColor(burst.id)}`,
						zIndex: 202,
						"--dx": `${p.dx}px`, "--dy": `${p.dy}px`,
						"--dur": `${p.dur}s`, "--delay": `${p.delay}s`,
					} as CSSProperties}
				/>
			))}
			<span
				key={`emoji-${burst.key}`}
				className="animate-tap-fly-center fixed pointer-events-none"
				style={{ left: "50%", top: "50%", zIndex: 201, filter: tapGlow(burst.id), "--tap-origin-dx": `${burst.originDx}px`, "--tap-origin-dy": `${burst.originDy}px` } as CSSProperties}
			>
				{tapEmoji(burst.id)}
			</span>
		</>,
		document.body,
	);
}
