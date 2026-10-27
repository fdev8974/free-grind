export const RELEASES_URL = "https://github.com/fdev8974/free-grind/releases";

export interface Release {
	name: string;
	tagName: string;
	htmlUrl: string;
	publishedAt: string;
	assets: { name: string; url: string }[];
}

interface GitHubRelease {
	name: string | null;
	tag_name: string;
	html_url: string;
	published_at: string;
	draft: boolean;
	assets: { name: string; browser_download_url: string }[];
}

let latest: Promise<Release | null> | undefined;

/**
 * Newest published release, pre-releases included. GitHub's `releases/latest`
 * skips pre-releases, and every 1.0 beta is one, so walk the list instead.
 * Shared by all buttons on a page; null when GitHub can't be reached.
 */
export function latestRelease(): Promise<Release | null> {
	latest ??= fetch(
		"https://api.github.com/repos/fdev8974/free-grind/releases?per_page=10",
	)
		.then((response) => (response.ok ? response.json() : []))
		.then((releases: GitHubRelease[]) => {
			const release = releases.find((r) => !r.draft && r.assets.length > 0);
			if (!release) return null;
			return {
				name: release.name ?? release.tag_name,
				tagName: release.tag_name,
				htmlUrl: release.html_url,
				publishedAt: release.published_at,
				assets: release.assets.map((a) => ({
					name: a.name,
					url: a.browser_download_url,
				})),
			};
		})
		.catch(() => null);
	return latest;
}
