<script setup lang="ts">
import { withBase } from "vitepress";
import { onMounted, ref } from "vue";
import { latestRelease } from "./releases";

defineProps<{ screenMenu?: boolean }>();

const version = ref<string>();

onMounted(async () => {
	const release = await latestRelease();
	// Release names look like "Free Grind v1.0.0-beta.18 (d70eecd)".
	version.value = release?.name
		.replace(/^Free Grind\s+/i, "")
		.replace(/\s*\([0-9a-f]+\)$/i, "");
});
</script>

<template>
	<a
		v-if="version"
		:class="screenMenu ? 'NavVersion screen' : 'NavVersion'"
		:href="withBase('/guide/download')"
		title="Download the latest version"
	>
		<span class="vp-icon i-download"></span>
		{{ version }}
	</a>
</template>

<style scoped>
.NavVersion {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: auto 8px;
	border-radius: 999px;
	padding: 0 10px;
	line-height: 26px;
	font-size: 13px;
	font-weight: 600;
	color: var(--vp-c-brand-1);
	background-color: color-mix(in srgb, var(--vp-button-brand-bg) 18%, transparent);
	transition: background-color 0.25s;
}

.NavVersion:hover {
	background-color: color-mix(in srgb, var(--vp-button-brand-bg) 30%, transparent);
}

.NavVersion.screen {
	display: flex;
	margin: 12px 0;
	width: fit-content;
}
</style>
