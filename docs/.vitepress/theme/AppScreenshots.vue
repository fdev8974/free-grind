<script setup lang="ts">
import { withBase } from "vitepress";

// One open tile per feature: the whole phone screenshot, then its text. A
// screenshot in content/screenshots/ named after a feature's key
// ("1-grid.jpg", "chat.webp", …) is what its phone shows; features without
// one are text only.
const files = import.meta.glob<string>(
	"../../content/screenshots/*.{png,jpg,jpeg,webp,avif}",
	{ eager: true, query: "?url", import: "default" },
);

const screenshots = new Map(
	Object.entries(files).map(([path, src]) => [
		path
			.split("/")
			.pop()!
			.replace(/\.[^.]+$/, "")
			.replace(/^\d+[-_ ]*/, "")
			.toLowerCase(),
		src,
	]),
);

const features = [
	{
		key: "grid",
		title: "Unlocked grid",
		text: "Browse everyone nearby, page after page, without a subscription.",
		link: "/guide/features/unlocked-grid",
	},
	{
		key: "chat",
		title: "Chats that stay",
		text: "Messages and media stay on your device, even after unsends and blocks.",
		link: "/guide/features/chat-history",
	},
	{
		key: "filters",
		title: "Filters for everything",
		text: "Age, height, weight, tags and quick filters for the grid.",
		link: "/guide/features/unlocked-grid",
	},
	{
		key: "location",
		title: "Teleport anywhere",
		text: "Pick any spot on the map and show up in the grid there.",
		link: "/guide/features/location-spoofing",
	},
	{
		key: "profile",
		title: "Full profiles",
		text: "Every detail at a glance, with taps, favorites and private notes.",
		link: "/guide/features/interest",
	},
	{
		key: "customization",
		title: "Make it yours",
		text: "Color scheme, accent color, pure black mode and more.",
		link: "/guide/faq",
	},
].map((feature) => ({
	...feature,
	src: screenshots.get(feature.key),
	link: withBase(feature.link),
}));
</script>

<template>
	<section class="AppScreenshots">
		<div class="container">
			<header>
				<p class="eyebrow">Features</p>
				<h2>Everything Grindr should have been</h2>
				<p class="lead">No paywalls, no ads, no tracking. Just the app, the way you'd build it yourself.</p>
			</header>

			<div class="tiles">
				<a v-for="feature in features" :key="feature.key" :href="feature.link" class="tile">
					<div v-if="feature.src" class="shot">
						<div class="glow" />
						<img :src="feature.src" :alt="`Free Grind: ${feature.title}`" loading="lazy" />
					</div>
					<h3>{{ feature.title }}</h3>
					<p>{{ feature.text }}</p>
					<span class="more">Learn more →</span>
				</a>
			</div>
		</div>
	</section>
</template>

<style scoped>
.AppScreenshots {
	padding: 24px 24px 64px;
}

@media (min-width: 640px) {
	.AppScreenshots {
		padding: 32px 48px 96px;
	}
}

@media (min-width: 960px) {
	.AppScreenshots {
		padding: 32px 64px 96px;
	}
}

.container {
	margin: 0 auto;
	max-width: 1152px;
}

header {
	margin: 0 auto 56px;
	max-width: 760px;
	text-align: center;
}

.eyebrow {
	margin: 0;
	font-size: 13px;
	font-weight: 600;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--vp-c-brand-1);
}

h2 {
	margin: 12px 0 0;
	font-size: 32px;
	font-weight: 800;
	line-height: 40px;
	letter-spacing: -0.02em;
	color: var(--vp-c-text-1);
}

@media (min-width: 640px) {
	h2 {
		font-size: 40px;
		line-height: 48px;
	}
}

.lead {
	margin: 16px 0 0;
	font-size: 17px;
	line-height: 28px;
	color: var(--vp-c-text-2);
}

/* Swipeable row on phones, an open grid from tablets up. */
.tiles {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: 72%;
	gap: 24px;
	margin: 0 -24px;
	padding: 0 24px 8px;
	overflow-x: auto;
	scroll-snap-type: x mandatory;
	scrollbar-width: none;
}

.tiles::-webkit-scrollbar {
	display: none;
}

@media (min-width: 640px) {
	.tiles {
		grid-auto-flow: row;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 56px 40px;
		margin: 0;
		padding: 0;
		overflow: visible;
	}
}

@media (min-width: 960px) {
	.tiles {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
}

.tile {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	scroll-snap-align: center;
	color: inherit;
	text-decoration: none;
}

/* The whole phone, at its own aspect ratio. */
.shot {
	position: relative;
	display: flex;
	justify-content: center;
	align-items: flex-start;
	margin-bottom: 24px;
	width: 100%;
}

.glow {
	position: absolute;
	top: 12%;
	left: 50%;
	width: 90%;
	height: 70%;
	translate: -50% 0;
	border-radius: 50%;
	background: radial-gradient(closest-side, color-mix(in srgb, var(--home-accent) 40%, transparent), transparent);
	filter: blur(30px);
	opacity: 0.7;
	transition: opacity 0.4s;
}

img {
	position: relative;
	display: block;
	box-sizing: border-box;
	margin-top: 12px;
	width: 62%;
	height: auto;
	border: 5px solid #0b0f15;
	border-radius: 28px;
	background-color: #0b0f15;
	box-shadow:
		0 0 0 1px #2b3646,
		0 32px 64px -24px color-mix(in srgb, var(--home-accent) 45%, transparent);
	transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.tile:hover img {
	transform: translateY(-10px);
}

.tile:hover .glow {
	opacity: 1;
}

h3 {
	margin: 0;
	font-size: 18px;
	font-weight: 700;
	line-height: 26px;
	color: var(--vp-c-text-1);
	transition: color 0.25s;
}

.tile:hover h3 {
	color: var(--vp-c-brand-1);
}

.tile p {
	margin: 6px 0 0;
	max-width: 320px;
	font-size: 14px;
	line-height: 22px;
	color: var(--vp-c-text-2);
}

.more {
	margin-top: 12px;
	font-size: 14px;
	font-weight: 600;
	color: var(--vp-c-brand-1);
}

@media (prefers-reduced-motion: reduce) {
	img {
		transition: none;
	}

	.tile:hover img {
		transform: none;
	}
}
</style>
