<script setup lang="ts">
import { withBase } from "vitepress";
</script>

<template>
	<footer class="HomeFooter">
		<div class="container">
			<a :href="withBase('/')" class="name">
				<img :src="withBase('/logo.webp')" alt="" width="24" height="24" />
				Free Grind
			</a>
			<p>
				Not affiliated with Grindr in any way. Licensed under the
				<a href="https://github.com/fdev8974/free-grind/blob/development/LICENSE" target="_blank" rel="noreferrer">MIT License</a>.
			</p>
		</div>
	</footer>
</template>

<style scoped>
.HomeFooter {
	border-top: 1px solid var(--vp-c-divider);
	padding: 32px 24px;
}

@media (min-width: 640px) {
	.HomeFooter {
		padding: 32px 48px;
	}
}

@media (min-width: 960px) {
	.HomeFooter {
		padding: 32px 64px;
	}
}

.container {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
	margin: 0 auto;
	max-width: 1152px;
	text-align: center;
}

@media (min-width: 768px) {
	.container {
		flex-direction: row;
		justify-content: space-between;
		text-align: left;
	}
}

.name {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	font-size: 15px;
	font-weight: 700;
	color: var(--vp-c-text-1);
}

p {
	margin: 0;
	font-size: 13px;
	color: var(--vp-c-text-3);
}

p a {
	color: var(--vp-c-text-2);
	text-decoration: underline;
	transition: color 0.25s;
}

p a:hover {
	color: var(--vp-c-brand-1);
}
</style>
