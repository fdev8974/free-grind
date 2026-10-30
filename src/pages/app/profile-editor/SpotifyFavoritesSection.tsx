import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Loader2, Music, Plus, X } from "lucide-react";
import { FIELD_ROW_HOVER_CLASS, FieldSection, FieldSectionAction } from "./ProfileFieldRows";
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

	const isFull = tracks.length >= MAX_SPOTIFY_FAVORITES;

	return (
		<FieldSection
			title={t("profile_details.spotify.title")}
			action={tracks.length > 0 ? (
				<FieldSectionAction
					onClick={() => setPickerOpen(true)}
					disabled={disabled || isFull}
					title={isFull ? t("profile_editor.spotify.max_reached", { max: MAX_SPOTIFY_FAVORITES }) : undefined}
				>
					<Plus className="h-3.5 w-3.5" />
					{t("profile_editor.spotify.add")}
					<span className="tabular-nums text-[var(--text-muted)]">
						{tracks.length}/{MAX_SPOTIFY_FAVORITES}
					</span>
				</FieldSectionAction>
			) : undefined}
		>
			{isLoading ? (
				<div className="flex min-h-14 items-center justify-center text-[var(--text-muted)]">
					<Loader2 className="h-5 w-5 animate-spin" />
				</div>
			) : tracks.length === 0 ? (
				<button
					type="button"
					onClick={() => setPickerOpen(true)}
					disabled={disabled}
					className={`flex w-full items-center gap-3 p-3 pr-4 text-left transition ${FIELD_ROW_HOVER_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
				>
					<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ink-tint-8 text-[var(--text-muted)]">
						<Plus className="h-4 w-4" />
					</span>
					<span className="text-sm text-[var(--text-muted)]">{t("profile_editor.spotify.empty")}</span>
				</button>
			) : (
				tracks.map((track) => {
					const subtitle = [track.artists.join(", "), track.albumName]
						.filter((part) => part && part.trim().length > 0)
						.join(" · ");
					return (
						<div key={track.id} className="flex items-center gap-3 p-3 pr-2">
							{track.albumImageUrl ? (
								<img
									src={track.albumImageUrl}
									alt=""
									loading="lazy"
									className="h-9 w-9 shrink-0 rounded-xl object-cover"
								/>
							) : (
								<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ink-tint-10">
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
				})
			)}

			{/* Portaled out of the divided card, like the other row pickers. */}
			{pickerOpen && createPortal(
				<SpotifySongPickerDialog
					selected={tracks}
					onApply={onChange}
					onClose={() => setPickerOpen(false)}
				/>,
				document.body,
			)}
		</FieldSection>
	);
}
