import tailwindcss from "@tailwindcss/postcss";
import postcssNesting from "postcss-nesting";
import cascadeLayers from "@csstools/postcss-cascade-layers";

export default {
	// Nesting before cascadeLayers: in dev Tailwind doesn't optimize, so its
	// color-mix() @supports blocks stay nested inside rules, and cascadeLayers
	// drops those, leaving only the solid fallback color (e.g. fully filled
	// active chips).
	plugins: [tailwindcss(), postcssNesting(), cascadeLayers()],
};
