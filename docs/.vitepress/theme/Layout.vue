<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import AppScreenshots from "./AppScreenshots.vue";
import HeroPhone from "./HeroPhone.vue";
import HomeBackdrop from "./HomeBackdrop.vue";
import HomeCommunity from "./HomeCommunity.vue";
import HomeCta from "./HomeCta.vue";
import HomeFooter from "./HomeFooter.vue";
</script>

<template>
	<DefaultTheme.Layout>
		<template #home-hero-before>
			<HomeBackdrop />
		</template>
		<template #home-hero-image>
			<HeroPhone />
		</template>
		<template #home-features-after>
			<AppScreenshots />
			<HomeCommunity />
			<HomeCta />
			<HomeFooter />
		</template>
	</DefaultTheme.Layout>
</template>
