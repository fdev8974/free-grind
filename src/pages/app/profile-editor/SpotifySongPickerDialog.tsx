import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Check, Loader2, Music } from "lucide-react";
import { BottomSheet, SheetClose, SheetCloseButton, SHEET_FOOTER_CLASS, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { SheetSearchInput } from "../../../components/ui/sheet-section";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";
import { useSpotifyTrackSearch } from "../../../hooks/queries/useProfileQueries";
import type { SpotifyTrack } from "../../../services/spotify";
import { MAX_SPOTIFY_FAVORITES } from "./profileEditorUtils";

interface SpotifySongPickerDialogProps {
	selected: SpotifyTrack[];
	/** Called with the picked songs from the Apply button; closing otherwise discards them. */
	onApply: (tracks: SpotifyTrack[]) => void;
	onClose: () => void;
}

export function SpotifySongPickerDialog({ selected, onApply, onClose }: SpotifySongPickerDialogProps) {
	const { t } = useTranslation();
	const isDesktop = useDesktopBreakpoint();
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [picked, setPicked] = useState(selected);

	// Debounce so we don't hammer Spotify's search on every keystroke.
	useEffect(() => {
		const handle = setTimeout(() => setDebouncedQuery(query), 300);
		return () => clearTimeout(handle);
	}, [query]);

	const { data: results, isFetching } = useSpotifyTrackSearch(debouncedQuery);
	const pickedIds = new Set(picked.map((track) => track.id));

	const handleToggle = (track: SpotifyTrack) => {
		if (pickedIds.has(track.id)) {
			setPicked((current) => current.filter((item) => item.id !== track.id));
			return;
		}
		if (picked.length >= MAX_SPOTIFY_FAVORITES) {
			toast.error(t("profile_editor.spotify.max_reached", { max: MAX_SPOTIFY_FAVORITES }));
			return;
		}
		setPicked((current) => [...current, track]);
	};

	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} panelClassName="max-h-[82dvh] px-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<p className="text-sm font-semibold text-[var(--text)]">
					{t("profile_editor.spotify.picker_title", { count: picked.length, max: MAX_SPOTIFY_FAVORITES })}
				</p>
				<SheetCloseButton />
			</div>
			<div className="mb-4">
				<SheetSearchInput
					value={query}
					onChange={setQuery}
					placeholder={t("profile_editor.spotify.search_placeholder")}
				/>
			</div>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
				{isFetching ? (
					<div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
						<Loader2 className="h-5 w-5 animate-spin" />
					</div>
				) : (results?.length ?? 0) > 0 ? (
					<div className="grid min-w-0 gap-1.5">
						{results!.map((track) => {
							const active = pickedIds.has(track.id);
							const subtitle = [track.artists.join(", "), track.albumName]
								.filter((part) => part && part.trim().length > 0)
								.join(" · ");
							return (
								<button
									key={track.id}
									type="button"
									onClick={() => handleToggle(track)}
									className={`flex min-h-12 w-full min-w-0 items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-[transform,background-color] duration-150 active:scale-[0.99] ${
										active ? "accent-tint-15" : "ink-tint-6 hover:ink-tint-10"
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
										<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md ink-tint-10">
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
										className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
											active
												? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
												: "border-[color-mix(in_srgb,var(--text)_25%,transparent)] text-transparent"
										}`}
									>
										<Check className="h-3.5 w-3.5" strokeWidth={3} />
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
			<div className={SHEET_FOOTER_CLASS}>
				<SheetClose onClick={() => onApply(picked)} className={sheetButtonClass()}>
					{t("profile_editor.spotify.apply", { defaultValue: "Apply" })}
				</SheetClose>
			</div>
		</BottomSheet>
	);
}
