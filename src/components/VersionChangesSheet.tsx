import { ChevronRight, ExternalLink, GitCommitHorizontal, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, SheetCloseButton } from "./ui/bottom-sheet";
import { useDesktopBreakpoint } from "../hooks/useDesktopBreakpoint";
import { REPO_URL } from "../config/links-config";
import { githubCompareUrl, openExternalUrl } from "../utils/githubIssues";
import { formatRelativeTime } from "../utils/relativeTime";

type Commit = { sha: string; title: string; author: string | null; date: number | null };
type CompareResult = { commits: Commit[]; total: number };

type GitHubCompare = {
	total_commits: number;
	commits: {
		sha: string;
		parents: unknown[];
		author: { login: string } | null;
		commit: { message: string; author: { name: string; date: string } | null };
	}[];
};

const API_REPO_URL = REPO_URL.replace("https://github.com/", "https://api.github.com/repos/");

// Unauthenticated GitHub API calls are limited to 60 an hour, so reopening the
// sheet reuses the first answer instead of asking again.
const compareCache = new Map<string, Promise<CompareResult>>();

function fetchCompare(from: string, to: string): Promise<CompareResult> {
	const key = `${from}...${to}`;
	let pending = compareCache.get(key);
	if (!pending) {
		pending = fetch(`${API_REPO_URL}/compare/${key}?per_page=250`, { headers: { Accept: "application/vnd.github+json" } })
			.then(async (response) => {
				if (!response.ok) throw new Error(`GitHub compare failed (${response.status})`);
				const data = (await response.json()) as GitHubCompare;
				const commits = data.commits
					// Merge commits only repeat what the merged ones already say.
					.filter((commit) => commit.parents.length < 2)
					.map((commit) => ({
						sha: commit.sha,
						title: commit.commit.message.split("\n")[0].trim(),
						author: commit.author?.login ?? commit.commit.author?.name ?? null,
						date: commit.commit.author ? Date.parse(commit.commit.author.date) || null : null,
					}))
					// The API lists oldest first; newest on top reads like a changelog.
					.reverse();
				return { commits, total: data.total_commits };
			})
			.catch((error: unknown) => {
				compareCache.delete(key);
				throw error;
			});
		compareCache.set(key, pending);
	}
	return pending;
}

function CommitList({ from, to, url }: { from: string; to: string; url: string }) {
	const { t } = useTranslation();
	const [state, setState] = useState<{ phase: "loading" } | { phase: "error" } | ({ phase: "done" } & CompareResult)>({ phase: "loading" });

	useEffect(() => {
		let cancelled = false;
		fetchCompare(from, to).then(
			(result) => !cancelled && setState({ phase: "done", ...result }),
			() => !cancelled && setState({ phase: "error" }),
		);
		return () => {
			cancelled = true;
		};
	}, [from, to]);

	if (state.phase === "loading") {
		return (
			<div className="flex justify-center py-10 text-[var(--text-muted)]">
				<Loader2 className="h-5 w-5 animate-spin" />
			</div>
		);
	}

	if (state.phase === "error" || state.commits.length === 0) {
		return (
			<p className="py-8 text-center text-sm leading-relaxed text-[var(--text-muted)]">
				{state.phase === "error"
					? t("update_prompt.changes_failed", { defaultValue: "The changes couldn't be loaded. You can still see them on GitHub." })
					: t("update_prompt.changes_empty", { defaultValue: "No new commits between these builds." })}
			</p>
		);
	}

	// The compare API stops listing after 250 commits; the rest is only on GitHub.
	const hidden = state.total > 250 ? state.total - 250 : 0;
	return (
		<>
			<div className="native-group text-left">
				{state.commits.map((commit) => (
					<button
						key={commit.sha}
						type="button"
						onClick={() => void openExternalUrl(`${REPO_URL}/commit/${commit.sha}`)}
						className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:ink-tint-6"
					>
						<GitCommitHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium leading-snug text-[var(--text)] [overflow-wrap:anywhere]">{commit.title}</p>
							<p className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">
								<span className="font-mono">{commit.sha.slice(0, 7)}</span>
								{commit.author && ` · ${commit.author}`}
								{commit.date && ` · ${formatRelativeTime(commit.date)}`}
							</p>
						</div>
					</button>
				))}
			</div>
			{hidden > 0 && (
				<p className="mt-3 text-center text-xs text-[var(--text-muted)]">
					{t("update_prompt.changes_more", { defaultValue: "{{count}} more on GitHub", count: hidden })}
				</p>
			)}
			<button
				type="button"
				onClick={() => void openExternalUrl(url)}
				className="mx-auto mt-3 flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
			>
				{t("update_prompt.open_github", { defaultValue: "Open on GitHub" })}
				<ExternalLink className="h-3 w-3" />
			</button>
		</>
	);
}

/**
 * "See what's changed" under the update prompts' version comparison: opens the
 * commits between the installed build and the new one in a sheet instead of
 * sending the user to GitHub. Renders nothing when the range is unknown.
 */
export function VersionChangesLink({ from, to }: { from: string | null | undefined; to: string | null | undefined }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const isDesktop = useDesktopBreakpoint();
	const url = githubCompareUrl(from, to);
	if (!url || !from || !to) return null;

	return (
		<>
			<div className="mt-3 flex justify-center">
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
				>
					{t("update_prompt.view_changes", { defaultValue: "See what's changed" })}
					<ChevronRight className="h-3 w-3" />
				</button>
			</div>
			{open && (
				<BottomSheet onClose={() => setOpen(false)} isDesktop={isDesktop} expandable panelClassName="max-h-[85dvh]" zIndex="z-[150]">
					<div className="flex items-start justify-between gap-3 px-4 pb-3">
						<p className="min-w-0 pt-1 text-base font-semibold leading-snug text-[var(--text)]">
							{t("update_prompt.changes_title", { defaultValue: "What's changed" })}
						</p>
						<SheetCloseButton />
					</div>
					<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6" data-lenis-prevent>
						<CommitList from={from} to={to} url={url} />
					</div>
				</BottomSheet>
			)}
		</>
	);
}
