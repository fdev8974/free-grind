import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Loader2, Music, Plus, X } from "lucide-react";
import { CategoryHeader } from "./ProfileEditorComponents";
import { SpotifySongPickerDialog } from "./SpotifySongPickerDialog";
import {
	useProfileSpotifyFavorites,
	useUpdateSpotifyFavorites,
} from "../../../hooks/queries/useProfileQueries";
import type { SpotifyTrack } from "../../../services/spotify";
import { MAX_SPOTIFY_FAVORITES } from "./profileEditorUtils";

type SpotifyFavoritesSectionProps = {
	profileId?: string | number | null;
};

const sameIds = (a: SpotifyTrack[], b: SpotifyTrack[]) =>
	a.length === b.length && a.every((track, i) => track.id === b[i]?.id);

export function SpotifyFavoritesSection({ profileId }: SpotifyFavoritesSectionProps) {
	const { t } = useTranslation();
	const stringProfileId = profileId != null ? String(profileId) : null;
	const { data: savedFavorites, isLoading } = useProfileSpotifyFavorites(stringProfileId);
	const updateFavorites = useUpdateSpotifyFavorites(stringProfileId);

	const [selected, setSelected] = useState<SpotifyTrack[]>([]);
	const [pickerOpen, setPickerOpen] = useState(false);
	// Re-seed local state from the server only until the user starts editing.
	const hasEditedRef = useRef(false);

	useEffect(() => {
		if (!hasEditedRef.current && savedFavorites) {
			setSelected(savedFavorites);
		}
	}, [savedFavorites]);

	const baseline = savedFavorites ?? [];
	const isDirty = !sameIds(selected, baseline);

	const toggleTrack = (track: SpotifyTrack) => {
		hasEditedRef.current = true;
		setSelected((current) =>
			current.some((item) => item.id === track.id)
				? current.filter((item) => item.id !== track.id)
				: [...current, track],
		);
	};

	const removeTrack = (id: string) => {
		hasEditedRef.current = true;
		setSelected((current) => current.filter((track) => track.id !== id));
	};

	const handleSave = () => {
		updateFavorites.mutate(
			selected.map((track) => track.id),
			{
				onSuccess: () => {
					hasEditedRef.current = false;
					toast.success(t("profile_editor.spotify.saved"));
				},
				onError: () => {
					toast.error(t("profile_details.spotify.save_failed"));
				},
			},
		);
	};

	return (
		<div className="surface-card p-4 sm:p-5">
			<CategoryHeader
				title={t("profile_editor.spotify.title")}
				description={t("profile_editor.spotify.description")}
				icon={Music}
				action={
					<button
						type="button"
						onClick={() => setPickerOpen(true)}
						disabled={stringProfileId == null || selected.length >= MAX_SPOTIFY_FAVORITES}
						title={
							selected.length >= MAX_SPOTIFY_FAVORITES
								? t("profile_editor.spotify.max_reached", { max: MAX_SPOTIFY_FAVORITES })
								: undefined
						}
						className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-medium transition-colors hover:border-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-40"
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
			) : selected.length === 0 ? (
				<button
					type="button"
					onClick={() => setPickerOpen(true)}
					disabled={stringProfileId == null}
					className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border)] py-8 text-center transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
				>
					<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)]">
						<Music className="h-4 w-4" />
					</div>
					<p className="text-sm text-[var(--text-muted)]">{t("profile_editor.spotify.empty")}</p>
				</button>
			) : (
				<div className="overflow-hidden rounded-2xl border border-[var(--border)]">
					{selected.map((track, i) => {
						const subtitle = [track.artists.join(", "), track.albumName]
							.filter((part) => part && part.trim().length > 0)
							.join(" · ");
						return (
							<div
								key={track.id}
								className={`flex items-center gap-3 bg-[var(--surface-2)] px-3 py-2.5 ${i > 0 ? "border-t border-[var(--border)]" : ""}`}
							>
								{track.albumImageUrl ? (
									<img
										src={track.albumImageUrl}
										alt=""
										loading="lazy"
										className="h-10 w-10 shrink-0 rounded-md object-cover"
									/>
								) : (
									<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface)]">
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
									className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface)] hover:text-[var(--text)]"
								>
									<X className="h-4 w-4" />
								</button>
							</div>
						);
					})}
				</div>
			)}

			{isDirty && (
				<button
					type="button"
					onClick={handleSave}
					disabled={updateFavorites.isPending}
					className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
				>
					{updateFavorites.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
					{t("profile_editor.spotify.save")}
				</button>
			)}

			{pickerOpen && (
				<SpotifySongPickerDialog
					selected={selected}
					onToggle={toggleTrack}
					onClose={() => setPickerOpen(false)}
				/>
			)}
		</div>
	);
}
