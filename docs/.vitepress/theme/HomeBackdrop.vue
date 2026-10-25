<template>
	<!-- Behind the hero: drifting brand-colored glows over a fading dot grid. -->
	<div class="HomeBackdrop" aria-hidden="true">
		<div class="glow one" />
		<div class="glow two" />
		<div class="glow three" />
		<div class="dots" />
	</div>
</template>

<style scoped>
.HomeBackdrop {
	position: absolute;
	inset: calc(var(--vp-nav-height) * -1) 0 auto;
	height: 960px;
	overflow: hidden;
	pointer-events: none;
	z-index: 0;
}

.glow {
	position: absolute;
	border-radius: 50%;
	filter: blur(90px);
	opacity: var(--home-glow-opacity);
	animation: drift 22s ease-in-out infinite alternate;
}

.one {
	top: -120px;
	left: -10%;
	width: 560px;
	height: 560px;
	background: #ffcc01;
}

.two {
	top: 80px;
	right: -8%;
	width: 620px;
	height: 620px;
	background: #f97316;
	animation-duration: 28s;
	animation-delay: -8s;
}

.three {
	top: 420px;
	left: 30%;
	width: 480px;
	height: 480px;
	background: #fb923c;
	animation-duration: 34s;
	animation-delay: -16s;
}

.dots {
	position: absolute;
	inset: 0;
	background-image: radial-gradient(var(--home-dot-color) 1px, transparent 1px);
	background-size: 24px 24px;
	mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, #000 30%, transparent 75%);
}

@keyframes drift {
	from {
		transform: translate(0, 0) scale(1);
	}
	to {
		transform: translate(60px, 40px) scale(1.15);
	}
}

@media (prefers-reduced-motion: reduce) {
	.glow {
		animation: none;
	}
}
</style>
