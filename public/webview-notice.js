// Shows the "WebView too old" notice flagged by webview-check.js. A
// separate file for the same reason as webview-check.js.
(function () {
	var root = document.documentElement;
	if (!/(^| )webview-unsupported( |$)/.test(root.className)) return;

	var ua = navigator.userAgent;
	var platform = /Android/.test(ua)
		? "android"
		: /iPhone|iPad|iPod/.test(ua)
			? "ios"
			: /Windows/.test(ua)
				? "windows"
				: /Macintosh/.test(ua)
					? "macos"
					: "linux";
	var hints = document.querySelectorAll("#webview-too-old .wv-plat");
	for (var i = 0; i < hints.length; i++) {
		if (hints[i].getAttribute("data-platform") === platform) hints[i].style.display = "block";
	}

	var found = document.getElementById("wv-found");
	function showFound(version) {
		found.textContent = "Found: " + version;
	}
	var chrome = /Chrome\/(\d+(\.\d+)*)/.exec(ua);
	var safari = /Version\/(\d+(\.\d+)*)/.exec(ua);
	if (chrome) showFound("Chromium " + chrome[1]);
	else if (safari) showFound("WebKit (Safari " + safari[1] + ")");

	// The exact engine build from Rust (WebKitGTK 2.40.5, WebView2
	// 109.0.1518.78, ...); the user agent only approximates it.
	try {
		var tauri = window.__TAURI_INTERNALS__;
		if (tauri && tauri.invoke) {
			tauri.invoke("webview_version").then(function (version) {
				if (!version) return;
				var engine =
					platform === "linux"
						? "WebKitGTK "
						: platform === "windows"
							? "WebView2 "
							: platform === "android"
								? "Android System WebView "
								: "WebKit ";
				showFound(engine + version);
			}, function () {});
		}
	} catch (e) {}

	document.getElementById("wv-continue").onclick = function () {
		root.className = root.className.replace(/(^| )webview-unsupported/, "");
	};
})();
