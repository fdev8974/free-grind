/**
 * Page transitions for tab switches via the View Transitions API.
 *
 * BrowserRouter applies location changes inside React.startTransition, so
 * the usual `startViewTransition(() => flushSync(navigate))` doesn't work —
 * flushSync doesn't flush transition updates. Instead the update callback
 * waits until ProtectedLayout reports that the new route has committed
 * (notifyRouteCommitted, from a layout effect), so the browser snapshots the
 * finished new page. The animation itself lives in index.css.
 */

// A heavy page shouldn't keep the screen frozen on the old snapshot.
const COMMIT_TIMEOUT_MS = 400;

let resolvePendingCommit: (() => void) | null = null;

export function notifyRouteCommitted() {
	resolvePendingCommit?.();
}

export function startRouteTransition(update: () => void) {
	if (
		typeof document.startViewTransition !== "function" ||
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		update();
		return;
	}

	document.startViewTransition(
		() =>
			new Promise<void>((resolve) => {
				// A newer transition supersedes one still waiting for its commit.
				resolvePendingCommit?.();
				const done = () => {
					clearTimeout(timer);
					if (resolvePendingCommit === done) resolvePendingCommit = null;
					resolve();
				};
				const timer = setTimeout(done, COMMIT_TIMEOUT_MS);
				resolvePendingCommit = done;
				update();
			}),
	);
}
