<template>
	<!-- Behind the whole home page: drifting brand-colored glows, with a
	     fading dot grid behind the hero. -->
	<div class="HomeBackdrop" aria-hidden="true">
		<div class="dots" />
		<div class="glow one" />
		<div class="glow two" />
		<div class="glow three" />
		<div class="glow four" />
		<div class="glow five" />
		<div class="glow six" />
	</div>
</template>

<style scoped>
.HomeBackdrop {
	position: absolute;
	inset: calc(var(--vp-nav-height) * -1) 0 0;
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
	background: var(--home-accent);
}

.two {
	top: 80px;
	right: -8%;
	width: 620px;
	height: 620px;
	background: var(--home-accent-2);
	animation-duration: 28s;
	animation-delay: -8s;
}

.three {
	top: 420px;
	left: 30%;
	width: 480px;
	height: 480px;
	background: #9333ea;
	animation-duration: 34s;
	animation-delay: -16s;
}

/* Further down: features, community and the download banner. Percentages,
   so they follow the page however tall it gets. */
.four {
	top: 38%;
	right: -12%;
	width: 560px;
	height: 560px;
	background: var(--home-accent);
	animation-duration: 30s;
	animation-delay: -4s;
}

.five {
	top: 60%;
	left: -14%;
	width: 600px;
	height: 600px;
	background: var(--home-accent-2);
	animation-duration: 26s;
	animation-delay: -12s;
}

.six {
	top: 80%;
	left: 35%;
	width: 520px;
	height: 520px;
	background: #9333ea;
	animation-duration: 32s;
	animation-delay: -20s;
}

.dots {
	position: absolute;
	inset: 0 0 auto;
	height: 960px;
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
