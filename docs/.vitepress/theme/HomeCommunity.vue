<script setup lang="ts">
const channels = [
	{
		icon: "i-discord",
		name: "Discord",
		text: "Ask questions, report bugs and test new betas together with the community.",
		action: "Join the server",
		link: "https://discord.gg/cJqTaWPMFF",
	},
	{
		icon: "i-telegram",
		name: "Telegram",
		text: "Release announcements and project news, straight to your phone.",
		action: "Follow updates",
		link: "https://t.me/freegrind",
	},
	{
		icon: "i-github",
		name: "GitHub",
		text: "Read the code, open issues and send pull requests. Everything is public.",
		action: "View the source",
		link: "https://github.com/fdev8974/free-grind",
	},
];
</script>

<template>
	<section class="HomeCommunity">
		<div class="container">
			<header>
				<p class="eyebrow">Community</p>
				<h2>Built in the open, together</h2>
			</header>
			<div class="cards">
				<a
					v-for="channel in channels"
					:key="channel.name"
					:href="channel.link"
					class="card"
					target="_blank"
					rel="noreferrer"
				>
					<span class="vp-icon" :class="channel.icon" aria-hidden="true" />
					<h3>{{ channel.name }}</h3>
					<p>{{ channel.text }}</p>
					<span class="action">{{ channel.action }} →</span>
				</a>
			</div>
		</div>
	</section>
</template>

<style scoped>
.HomeCommunity {
	padding: 0 24px 64px;
}

@media (min-width: 640px) {
	.HomeCommunity {
		padding: 0 48px 96px;
	}
}

@media (min-width: 960px) {
	.HomeCommunity {
		padding: 0 64px 96px;
	}
}

.container {
	margin: 0 auto;
	max-width: 1152px;
}

header {
	margin: 0 auto 40px;
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

.cards {
	display: grid;
	gap: 16px;
}

@media (min-width: 768px) {
	.cards {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
}

.card {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--home-card-border);
	border-radius: 24px;
	padding: 28px;
	color: inherit;
	text-decoration: none;
	background-color: var(--home-card-bg);
	backdrop-filter: blur(12px);
	transition:
		border-color 0.25s,
		box-shadow 0.25s;
}

.card:hover {
	border-color: color-mix(in srgb, var(--home-accent) 70%, transparent);
	box-shadow: 0 16px 40px -16px color-mix(in srgb, var(--home-accent-2) 45%, transparent);
}

.vp-icon {
	font-size: 28px;
	color: var(--vp-c-brand-1);
}

h3 {
	margin: 20px 0 0;
	font-size: 18px;
	font-weight: 700;
	line-height: 26px;
	color: var(--vp-c-text-1);
}

p {
	flex-grow: 1;
	margin: 6px 0 0;
	font-size: 14px;
	line-height: 22px;
	color: var(--vp-c-text-2);
}

.action {
	margin-top: 20px;
	font-size: 14px;
	font-weight: 600;
	color: var(--vp-c-brand-1);
}
</style>
