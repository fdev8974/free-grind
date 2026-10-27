// Loaded from index.html before the bundle. Kept out of the page so the
// CSP can stay at script-src 'self' (no inline hashes that an OTA bundle
// would have to match).
// Tailwind v4 needs Chrome 111 / Safari 16.4: without color-mix and
// registered custom properties the app renders broken or blank, so
// this runs before the bundle and covers it with a plain notice.
(function () {
	try {
		if (
			window.CSS &&
			CSS.supports &&
			CSS.supports("color", "color-mix(in srgb, red, blue)") &&
			typeof CSS.registerProperty === "function"
		)
			return;
	} catch (e) {}
	document.documentElement.className += " webview-unsupported";
})();
