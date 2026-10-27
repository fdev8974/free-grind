<script setup lang="ts">
import { withBase } from "vitepress";

// The hero's phone shows content/screenshots/hero.* if there is one, else
// the grid screenshot ("1-grid.jpg", …); without either, the logo.
const screenshots = new Map(
	Object.entries(
		import.meta.glob<string>("../../content/screenshots/*.{png,jpg,jpeg,webp,avif}", {
			eager: true,
			query: "?url",
			import: "default",
		}),
	).map(([path, src]) => [
		path
			.split("/")
			.pop()!
			.replace(/\.[^.]+$/, "")
			.replace(/^\d+[-_ ]*/, "")
			.toLowerCase(),
		src,
	]),
);

const hero = screenshots.get("hero") ?? screenshots.get("grid");
</script>

<template>
	<div v-if="hero" class="HeroPhone">
		<img :src="hero" alt="Free Grind on a phone" fetchpriority="high" />
	</div>
	<img v-else class="image-src" :src="withBase('/logo.webp')" alt="Free Grind logo" />
</template>

<style scoped>
.HeroPhone {
	position: relative;
	z-index: 1;
	width: 140px;
	rotate: 6deg;
	animation: phone-float 7s ease-in-out infinite;
}

@media (min-width: 640px) {
	.HeroPhone {
		width: 150px;
	}
}

img:not(.image-src) {
	display: block;
	box-sizing: border-box;
	width: 100%;
	aspect-ratio: 9 / 19.5;
	object-fit: cover;
	object-position: top;
	border: 5px solid #0b0f15;
	border-radius: 24px;
	background-color: #0b0f15;
	box-shadow:
		0 0 0 1px #2b3646,
		0 40px 80px -24px color-mix(in srgb, var(--home-accent) 55%, transparent);
}

@keyframes phone-float {
	50% {
		translate: 0 -12px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.HeroPhone {
		animation: none;
	}
}
</style>
