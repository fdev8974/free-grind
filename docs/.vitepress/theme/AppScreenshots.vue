<script setup lang="ts">
// Every image in content/screenshots/ shows up here, sorted by file name
// ("1-grid.webp", "2-chat.webp", …); the name minus the number is the alt text.
// Phone screenshots are cropped to their top 9:16, like on opengrind.org.
const files = import.meta.glob<string>(
	"../../content/screenshots/*.{png,jpg,jpeg,webp,avif}",
	{ eager: true, query: "?url", import: "default" },
);

const shots = Object.entries(files)
	.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
	.map(([path, src]) => ({
		src,
		alt: path
			.split("/")
			.pop()!
			.replace(/\.[^.]+$/, "")
			.replace(/^\d+[-_ ]*/, "")
			.replace(/[-_]+/g, " "),
	}));
</script>

<template>
	<div v-if="shots.length" class="AppScreenshots">
		<div class="container">
			<div class="grid">
				<img
					v-for="shot in shots"
					:key="shot.src"
					:src="shot.src"
					:alt="`Free Grind: ${shot.alt}`"
					loading="lazy"
				/>
			</div>
		</div>
	</div>
</template>

<style scoped>
/* Same width and gutters as the feature boxes above (VPFeatures). */
.AppScreenshots {
	padding: 16px 24px 48px;
}

.container {
	container-type: inline-size;
	margin: 0 auto;
	max-width: 1152px;
}

@media (min-width: 640px) {
	.AppScreenshots {
		padding: 16px 48px 64px;
	}
}

@media (min-width: 960px) {
	.AppScreenshots {
		padding: 16px 64px 64px;
	}
}

/*
 * Open Grind's strip is 540×960 phones with 48px gaps, as 2×3, 3×2 or 1×6.
 * The gap is 48/540 of a phone's width in every layout, so derive it from
 * the container width: columns × phone + (columns − 1) × gap.
 */
.grid {
	--columns: 2;
	--gap: calc(100cqw * 48 / (540 * var(--columns) + 48 * (var(--columns) - 1)));
	display: grid;
	grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
	gap: var(--gap);
}

@media (min-width: 600px) {
	.grid {
		--columns: 3;
	}
}

@media (min-width: 1024px) {
	.grid {
		--columns: 6;
	}
}

img {
	display: block;
	box-sizing: border-box;
	width: 100%;
	aspect-ratio: 9 / 16;
	object-fit: cover;
	object-position: top;
	border: 1px solid #484848;
	border-radius: 7.4% / 4.2%;
	background-color: #0a0a0a;
}
</style>
