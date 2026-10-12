import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Check, Loader2, Music, Search, X } from "lucide-react";
import { BottomSheet, SheetClose } from "../../../components/ui/bottom-sheet";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { useSpotifyTrackSearch } from "../../../hooks/queries/useProfileQueries";
import type { SpotifyTrack } from "../../../services/spotify";
import { MAX_SPOTIFY_FAVORITES } from "./profileEditorUtils";

interface SpotifySongPickerDialogProps {
	selected: SpotifyTrack[];
	onToggle: (track: SpotifyTrack) => void;
	onClose: () => void;
}

export function SpotifySongPickerDialog({ selected, onToggle, onClose }: SpotifySongPickerDialogProps) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");

	// Debounce so we don't hammer Spotify's search on every keystroke.
	useEffect(() => {
		const handle = setTimeout(() => setDebouncedQuery(query), 300);
		return () => clearTimeout(handle);
	}, [query]);

	const { data: results, isFetching } = useSpotifyTrackSearch(debouncedQuery);
	const selectedIds = new Set(selected.map((track) => track.id));

	const handleToggle = (track: SpotifyTrack) => {
		if (!selectedIds.has(track.id) && selected.length >= MAX_SPOTIFY_FAVORITES) {
			toast.error(t("profile_editor.spotify.max_reached", { max: MAX_SPOTIFY_FAVORITES }));
			return;
		}
		onToggle(track);
	};

	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} panelClassName="max-h-[82dvh]">
			<div className="flex items-center justify-between px-4 pb-3">
				<p className="text-sm font-semibold text-[var(--text)]">
					{t("profile_editor.spotify.picker_title", { count: selected.length, max: MAX_SPOTIFY_FAVORITES })}
				</p>
				<SheetClose className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
					<X className="h-4 w-4" />
				</SheetClose>
			</div>
			<div className="px-4 pb-4">
				<label className="relative block">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
					<input
						type="text"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("profile_editor.spotify.search_placeholder")}
						className="input-field pl-9 pr-9"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-[var(--text-muted)] transition hover:text-[var(--text)]"
						>
							<X className="h-4 w-4" />
						</button>
					)}
				</label>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3" data-lenis-prevent>
				{isFetching ? (
					<div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
						<Loader2 className="h-5 w-5 animate-spin" />
					</div>
				) : (results?.length ?? 0) > 0 ? (
					<div className="grid gap-1.5">
						{results!.map((track) => {
							const active = selectedIds.has(track.id);
							const subtitle = [track.artists.join(", "), track.albumName]
								.filter((part) => part && part.trim().length > 0)
								.join(" · ");
							return (
								<button
									key={track.id}
									type="button"
									onClick={() => handleToggle(track)}
									className={`flex min-h-12 items-center gap-3 rounded-xl border px-2 py-1.5 text-left transition ${
										active
											? "border-[var(--accent)] bg-[var(--accent)]/10"
											: "border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--text-muted)]"
									}`}
								>
									{track.albumImageUrl ? (
										<img
											src={track.albumImageUrl}
											alt=""
											loading="lazy"
											className="h-10 w-10 shrink-0 rounded-md object-cover"
										/>
									) : (
										<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-3)]">
											<Music className="h-4 w-4 text-[var(--text-muted)]" />
										</span>
									)}
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium text-[var(--text)]">{track.name}</span>
										{subtitle && (
											<span className="block truncate text-xs text-[var(--text-muted)]">{subtitle}</span>
										)}
									</span>
									<span
										className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
											active
												? "border-[var(--accent)] bg-[var(--accent)] text-white"
												: "border-[var(--border)] text-transparent"
										}`}
									>
										<Check className="h-3.5 w-3.5" />
									</span>
								</button>
							);
						})}
					</div>
				) : (
					<p className="py-8 text-center text-sm text-[var(--text-muted)]">
						{debouncedQuery.trim()
							? t("profile_editor.spotify.no_matches")
							: t("profile_editor.spotify.search_hint")}
					</p>
				)}
			</div>
		</BottomSheet>
	);
}
