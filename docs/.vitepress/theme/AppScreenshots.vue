<script setup lang="ts">
import { withBase } from "vitepress";

// Every image in content/screenshots/ becomes a card, sorted by file name
// ("1-grid.jpg", "2-chat.jpg", …). The name minus the number picks the card's
// text below; unknown names just get a title from the file name.
const files = import.meta.glob<string>(
	"../../content/screenshots/*.{png,jpg,jpeg,webp,avif}",
	{ eager: true, query: "?url", import: "default" },
);

const details: Record<string, { title: string; text: string; link?: string }> = {
	grid: {
		title: "Unlocked grid",
		text: "Browse everyone nearby, page after page, without a subscription.",
		link: "/guide/features/unlocked-grid",
	},
	chat: {
		title: "Chats that stay",
		text: "Messages and media stay on your device, even after unsends and blocks.",
		link: "/guide/features/chat-history",
	},
	filters: {
		title: "Filters for everything",
		text: "Age, height, weight, tags and quick filters for the grid.",
		link: "/guide/features/unlocked-grid",
	},
	location: {
		title: "Teleport anywhere",
		text: "Pick any spot on the map and show up in the grid there.",
		link: "/guide/features/location-spoofing",
	},
	profile: {
		title: "Full profiles",
		text: "Every detail at a glance, with taps, favorites and private notes.",
	},
	customization: {
		title: "Make it yours",
		text: "Color scheme, accent color, pure black mode and more.",
	},
};

const shots = Object.entries(files)
	.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
	.map(([path, src]) => {
		const key = path
			.split("/")
			.pop()!
			.replace(/\.[^.]+$/, "")
			.replace(/^\d+[-_ ]*/, "")
			.toLowerCase();
		const name = key.replace(/[-_]+/g, " ");
		const info = details[key] ?? {
			title: name.charAt(0).toUpperCase() + name.slice(1),
			text: "",
		};
		return { src, ...info, link: info.link && withBase(info.link) };
	});
</script>

<template>
	<section v-if="shots.length" class="AppScreenshots">
		<div class="container">
			<header>
				<p class="eyebrow">Take a look</p>
				<h2>Everything Grindr should have been</h2>
				<p class="lead">No paywalls, no ads, no tracking. Just the app, the way you'd build it yourself.</p>
			</header>

			<div class="cards">
				<component
					:is="shot.link ? 'a' : 'div'"
					v-for="shot in shots"
					:key="shot.src"
					:href="shot.link"
					class="card"
				>
					<h3>{{ shot.title }}</h3>
					<p v-if="shot.text">{{ shot.text }}</p>
					<div class="stage">
						<img :src="shot.src" :alt="`Free Grind: ${shot.title}`" loading="lazy" />
					</div>
				</component>
			</div>
		</div>
	</section>
</template>

<style scoped>
/* Same width and gutters as the feature boxes above (VPFeatures). */
.AppScreenshots {
	padding: 72px 24px 48px;
}

@media (min-width: 640px) {
	.AppScreenshots {
		padding: 96px 48px 64px;
	}
}

@media (min-width: 960px) {
	.AppScreenshots {
		padding: 112px 64px 64px;
	}
}

.container {
	margin: 0 auto;
	max-width: 1152px;
}

header {
	margin: 0 auto 40px;
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

/* Swipeable row on phones, a grid from tablets up. */
.cards {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: 78%;
	gap: 16px;
	margin: 0 -24px;
	padding: 4px 24px 16px;
	overflow-x: auto;
	scroll-snap-type: x mandatory;
	scrollbar-width: none;
}

.cards::-webkit-scrollbar {
	display: none;
}

@media (min-width: 640px) {
	.cards {
		grid-auto-flow: row;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		margin: 0;
		padding: 0;
		overflow: visible;
	}
}

@media (min-width: 960px) {
	.cards {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
}

.card {
	display: flex;
	flex-direction: column;
	scroll-snap-align: center;
	border: 1px solid var(--home-card-border);
	border-radius: 24px;
	padding: 28px;
	color: inherit;
	text-decoration: none;
	background:
		radial-gradient(ellipse 80% 45% at 50% 100%, color-mix(in srgb, var(--vp-button-brand-bg) 22%, transparent), transparent 70%),
		var(--home-card-bg);
	backdrop-filter: blur(12px);
	transition:
		border-color 0.25s,
		box-shadow 0.25s;
}

a.card:hover {
	border-color: rgba(255, 204, 1, 0.7);
	box-shadow: 0 16px 40px -16px rgba(249, 115, 22, 0.45);
}

h3 {
	margin: 0;
	font-size: 18px;
	font-weight: 700;
	line-height: 26px;
	color: var(--vp-c-text-1);
}

.card p {
	margin: 6px 0 0;
	font-size: 14px;
	line-height: 22px;
	color: var(--vp-c-text-2);
}

.stage {
	display: flex;
	justify-content: center;
	margin-top: auto;
	padding-top: 28px;
}

/* The whole screenshot in a phone bezel. */
img {
	display: block;
	box-sizing: border-box;
	width: 72%;
	height: auto;
	border: 6px solid #111;
	border-radius: 34px;
	background-color: #0a0a0a;
	box-shadow:
		0 0 0 1px #3a3a3a,
		0 24px 48px -16px rgba(0, 0, 0, 0.45);
	transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.card:hover img {
	transform: translateY(-8px);
}

@media (prefers-reduced-motion: reduce) {
	img {
		transition: none;
	}

	.card:hover img {
		transform: none;
	}
}
</style>
