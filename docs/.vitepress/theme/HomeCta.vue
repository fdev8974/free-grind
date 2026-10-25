<script setup lang="ts">
import { withBase } from "vitepress";
import { VPButton } from "vitepress/theme";
</script>

<template>
	<section class="HomeCta">
		<div class="container">
			<h2>Grindr, the way it should be.</h2>
			<p>Free, open source and private. On every device you own.</p>
			<div class="actions">
				<VPButton
					:href="withBase('/guide/download')"
					text="Download Free Grind"
					size="big"
					icon='<span class="vp-icon i-download"></span>'
				/>
				<VPButton
					href="https://github.com/fdev8974/free-grind"
					text="Star on GitHub"
					size="big"
					theme="alt"
					icon='<span class="vp-icon i-github"></span>'
				/>
			</div>
		</div>
	</section>
</template>

<style scoped>
.HomeCta {
	padding: 0 24px 64px;
}

@media (min-width: 640px) {
	.HomeCta {
		padding: 0 48px 96px;
	}
}

@media (min-width: 960px) {
	.HomeCta {
		padding: 0 64px 96px;
	}
}

.container {
	position: relative;
	margin: 0 auto;
	max-width: 1152px;
	overflow: hidden;
	/* A crisp yellow-to-orange border: the fill is clipped to the padding box,
	   the gradient underneath only shows through the transparent border. */
	border: 1px solid transparent;
	border-radius: 28px;
	padding: 56px 24px;
	text-align: center;
	background:
		radial-gradient(ellipse 60% 80% at 20% 0%, rgba(255, 204, 1, 0.22), transparent 70%) padding-box,
		radial-gradient(ellipse 60% 80% at 80% 100%, rgba(249, 115, 22, 0.18), transparent 70%) padding-box,
		linear-gradient(var(--vp-c-bg-soft), var(--vp-c-bg-soft)) padding-box,
		linear-gradient(120deg, rgba(255, 204, 1, 0.8), rgba(249, 115, 22, 0.8)) border-box;
	box-shadow: 0 24px 64px -32px rgba(249, 115, 22, 0.5);
}

@media (min-width: 640px) {
	.container {
		padding: 72px 48px;
	}
}

h2 {
	margin: 0;
	font-size: 32px;
	font-weight: 800;
	line-height: 40px;
	letter-spacing: -0.02em;
	color: var(--vp-c-text-1);
}

@media (min-width: 640px) {
	h2 {
		font-size: 44px;
		line-height: 52px;
	}
}

p {
	margin: 16px auto 0;
	max-width: 520px;
	font-size: 18px;
	line-height: 28px;
	color: var(--vp-c-text-2);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 12px;
	margin-top: 32px;
}
</style>
