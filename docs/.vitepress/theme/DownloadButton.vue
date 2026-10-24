<script setup lang="ts">
import { VPButton } from "vitepress/theme";
import { onMounted, ref } from "vue";
import { latestRelease, RELEASES_URL } from "./releases";

const props = defineProps<{
	/** Regular expression matched against the release's asset file names. */
	asset: string;
	text: string;
	theme?: "brand" | "alt";
}>();

// Until the release list arrives (or if GitHub is unreachable) the button
// opens the releases page, so it always leads somewhere useful.
const href = ref(RELEASES_URL);

onMounted(async () => {
	const release = await latestRelease();
	const pattern = new RegExp(props.asset);
	const match = release?.assets.find((a) => pattern.test(a.name));
	if (match) href.value = match.url;
});
</script>

<template>
	<VPButton
		:href="href"
		:text="text"
		:theme="theme ?? 'brand'"
		size="medium"
		icon='<span class="vp-icon i-download"></span>'
	/>
</template>
