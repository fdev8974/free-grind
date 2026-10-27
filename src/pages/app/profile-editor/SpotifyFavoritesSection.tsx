import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Music, Plus, X } from "lucide-react";
import { CategoryHeader } from "./ProfileEditorComponents";
import { SpotifySongPickerDialog } from "./SpotifySongPickerDialog";
import type { SpotifyTrack } from "../../../services/spotify";
import { MAX_SPOTIFY_FAVORITES } from "./profileEditorUtils";

type SpotifyFavoritesSectionProps = {
	/** The editor's draft; saved with the rest of the profile from its save bar. */
	tracks: SpotifyTrack[];
	isLoading: boolean;
	disabled: boolean;
	onChange: (tracks: SpotifyTrack[]) => void;
};

export const sameTrackIds = (a: SpotifyTrack[], b: SpotifyTrack[]) =>
	a.length === b.length && a.every((track, i) => track.id === b[i]?.id);

export function SpotifyFavoritesSection({ tracks, isLoading, disabled, onChange }: SpotifyFavoritesSectionProps) {
	const { t } = useTranslation();
	const [pickerOpen, setPickerOpen] = useState(false);

	const removeTrack = (id: string) => {
		onChange(tracks.filter((track) => track.id !== id));
	};

	return (
		<div className="native-card min-w-0 p-4 sm:p-5">
			<CategoryHeader
				title={t("profile_editor.spotify.title")}
				description={t("profile_editor.spotify.description")}
				icon={Music}
				action={
					<button
						type="button"
						onClick={() => setPickerOpen(true)}
						disabled={disabled || tracks.length >= MAX_SPOTIFY_FAVORITES}
						title={
							tracks.length >= MAX_SPOTIFY_FAVORITES
								? t("profile_editor.spotify.max_reached", { max: MAX_SPOTIFY_FAVORITES })
								: undefined
						}
						className="inline-flex h-9 items-center gap-1.5 rounded-full ink-tint-10 px-3.5 text-sm font-semibold transition-[transform,background-color] duration-150 hover:ink-tint-14 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Plus className="h-4 w-4" />
						{t("profile_editor.spotify.add")}
					</button>
				}
			/>

			{isLoading ? (
				<div className="flex items-center justify-center py-6 text-[var(--text-muted)]">
					<Loader2 className="h-5 w-5 animate-spin" />
				</div>
			) : tracks.length === 0 ? (
				<button
					type="button"
					onClick={() => setPickerOpen(true)}
					disabled={disabled}
					className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl ink-tint-6 py-8 text-center transition hover:ink-tint-10 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<div className="flex h-9 w-9 items-center justify-center rounded-xl ink-tint-8 text-[var(--text-muted)]">
						<Music className="h-4 w-4" />
					</div>
					<p className="text-sm text-[var(--text-muted)]">{t("profile_editor.spotify.empty")}</p>
				</button>
			) : (
				<div className="overflow-hidden rounded-2xl ink-tint-6 divide-y divide-[color-mix(in_srgb,var(--text)_8%,transparent)]">
					{tracks.map((track) => {
						const subtitle = [track.artists.join(", "), track.albumName]
							.filter((part) => part && part.trim().length > 0)
							.join(" · ");
						return (
							<div
								key={track.id}
								className="flex items-center gap-3 px-3 py-2.5"
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
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium text-[var(--text)]">{track.name}</p>
									{subtitle && <p className="truncate text-xs text-[var(--text-muted)]">{subtitle}</p>}
								</div>
								<button
									type="button"
									onClick={() => removeTrack(track.id)}
									aria-label={t("profile_editor.spotify.remove")}
									className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:ink-tint-10 hover:text-[var(--text)] active:scale-90"
								>
									<X className="h-4 w-4" />
								</button>
							</div>
						);
					})}
				</div>
			)}

			{pickerOpen && (
				<SpotifySongPickerDialog
					selected={tracks}
					onApply={onChange}
					onClose={() => setPickerOpen(false)}
				/>
			)}
		</div>
	);
}
