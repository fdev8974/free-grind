import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldOff, UserX } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { PullToRefreshContainer } from "./components/PullToRefreshContainer";
import { useApiFunctions } from "../../hooks/useApiFunctions";
import { useBlockedProfileIds, useUnblockProfile } from "../../hooks/queries/useProfileQueries";
import { applySelfBlockAction } from "../../services/conversationArchive";
import { getThumbImageUrl, validateMediaHash } from "../../utils/media";
import { ProfileImage } from "../../components/ui/profile-image";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { ErrorState } from "../../components/ui/states";
import { DrawerEmptyState } from "./chat/drawerUi";

type BlockedProfileListItem = {
	profileId: string;
	displayName: string;
	avatarUrl: string | null;
};

export function SettingsBlockedPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const apiFunctions = useApiFunctions();
	const { data: blockedIdsData, isLoading: isLoadingIds, refetch: refetchIds } = useBlockedProfileIds();
	const { mutateAsync: unblockProfileMutation, isPending: isUnblocking } = useUnblockProfile();

	const [blockedProfiles, setBlockedProfiles] = useState<BlockedProfileListItem[]>([]);
	const [isLoadingDetails, setIsLoadingDetails] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [mutatingProfileId, setMutatingProfileId] = useState<string | null>(null);
	const [isUnblockingAll, setIsUnblockingAll] = useState(false);
	const [confirmUnblockAll, setConfirmUnblockAll] = useState(false);

	const loadBlockedProfileDetails = useCallback(
		async (blockedIds: string[]) => {
			setIsLoadingDetails(true);
			setError(null);

			try {
				if (blockedIds.length === 0) {
					setBlockedProfiles([]);
					return;
				}

				// Batch-fetch details via the cascade endpoint in chunks of 50,
				// rather than one GET /v7/profiles per id. The single-profile
				// endpoint returns restricted data for blocked users (so names and
				// avatars come back empty); POST /v3/profiles returns them.
				const CHUNK_SIZE = 50;
				const chunks: string[][] = [];
				for (let i = 0; i < blockedIds.length; i += CHUNK_SIZE) {
					chunks.push(blockedIds.slice(i, i + CHUNK_SIZE));
				}

				const detailsById = new Map<string, { displayName: string; avatarUrl: string | null }>();
				await Promise.all(
					chunks.map(async (chunk) => {
						try {
							const raw = await apiFunctions.getProfilesByIds(chunk);
							const profiles =
								raw && typeof raw === "object" && Array.isArray((raw as { profiles?: unknown }).profiles)
									? (raw as { profiles: unknown[] }).profiles
									: [];
							for (const p of profiles) {
								if (!p || typeof p !== "object") continue;
								const idRaw = (p as { profileId?: unknown }).profileId;
								if (idRaw == null) continue;
								const profileId = String(idRaw);
								const nameRaw = (p as { displayName?: unknown }).displayName;
								const displayName =
									typeof nameRaw === "string" && nameRaw.trim().length > 0
										? nameRaw.trim()
										: t("settings_blocked.name_fallback", { defaultValue: "Someone" });
								const hashRaw = (p as { profileImageMediaHash?: unknown }).profileImageMediaHash;
								const avatarUrl =
									typeof hashRaw === "string" && validateMediaHash(hashRaw)
										? getThumbImageUrl(hashRaw, "75x75")
										: null;
								detailsById.set(profileId, { displayName, avatarUrl });
							}
						} catch {
							// Chunk failed — its ids fall back to id-only below.
						}
					}),
				);

				setBlockedProfiles(
					blockedIds.map((profileId) => {
						const meta = detailsById.get(profileId);
						return {
							profileId,
							displayName: meta?.displayName ?? t("settings_blocked.name_fallback", { defaultValue: "Someone" }),
							avatarUrl: meta?.avatarUrl ?? null,
						} satisfies BlockedProfileListItem;
					}),
				);
			} catch (loadError) {
				setBlockedProfiles([]);
				setError(loadError instanceof Error ? loadError.message : t("settings_blocked.error_load"));
			} finally {
				setIsLoadingDetails(false);
			}
		},
		[apiFunctions, t],
	);

	useEffect(() => {
		if (blockedIdsData) {
			void loadBlockedProfileDetails(blockedIdsData);
		}
	}, [blockedIdsData, loadBlockedProfileDetails]);

	const isLoading = isLoadingIds || isLoadingDetails;

	const handleUnblock = async (profileId: string) => {
		if (isUnblocking) return;

		setMutatingProfileId(profileId);
		try {
			await unblockProfileMutation(profileId);
			toast.success(t("profile_details.unblock_success"));
		} catch (unblockError) {
			toast.error(
				unblockError instanceof Error ? unblockError.message : t("profile_details.unblock_failed"),
			);
		} finally {
			setMutatingProfileId(null);
		}
	};

	const handleUnblockPress = (profileId: string) => {
		if (mutatingProfileId) return;
		void handleUnblock(profileId);
	};

	const handleUnblockAll = async () => {
		setIsUnblockingAll(true);
		try {
			const unblockedIds = blockedIdsData ?? [];
			await apiFunctions.unblockAllProfiles();
			toast.success(t("settings_blocked.unblock_all_success", { defaultValue: "All users unblocked." }));
			void refetchIds();
			// Doesn't go through useUnblockProfile, so take any archived
			// conversations with these profiles out of archive here too.
			void Promise.all(unblockedIds.map((profileId) => applySelfBlockAction(profileId, "unblock")));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t("settings_blocked.unblock_all_failed", { defaultValue: "Failed to unblock all profiles." }));
		} finally {
			setIsUnblockingAll(false);
			setConfirmUnblockAll(false);
		}
	};

	return (
		<PullToRefreshContainer
			className="app-screen flex flex-col"
			contentClassName="flex flex-1 flex-col"
			onRefresh={() => refetchIds()}
			isDisabled={isLoading}
			refreshingLabel={t("settings_blocked.refreshing")}
		>
			<PageHeader
				backTo="/settings"
				title={t("settings_blocked.title")}
				subtitle={t("settings_blocked.subtitle")}
			/>

			{/* Fills the rest of the screen so the empty state can sit centered in it. */}
			<div className={`grid flex-1 gap-6 ${!isLoading && !error && blockedProfiles.length === 0 ? "content-center" : "content-start"}`}>
				{isLoading ? (
					<div>
						<div className="mb-2 flex items-center gap-2 px-1">
							<div className="h-3 w-16 animate-pulse rounded-full ink-tint-10" />
							{!isLoadingIds && blockedIdsData && blockedIdsData.length > 0 && (
								<div className="h-3.5 w-5 animate-pulse rounded-full ink-tint-10" />
							)}
						</div>
						<div className="native-card divide-y divide-[color-mix(in_srgb,var(--text)_8%,transparent)] overflow-hidden">
							{Array.from({ length: isLoadingIds ? 4 : (blockedIdsData?.length ?? 4) }).map((_, i) => (
								<div key={i} className="flex items-center gap-3 px-4 py-3">
									<div className="h-11 w-11 shrink-0 animate-pulse rounded-full overflow-hidden ink-tint-10" />
									<div className="min-w-0 flex-1 space-y-1.5">
										<div className="h-3.5 w-28 animate-pulse rounded-full ink-tint-10" />
										<div className="h-3 w-16 animate-pulse rounded-full ink-tint-10" />
									</div>
									<div className="h-8 w-24 animate-pulse rounded-full ink-tint-10" />
								</div>
							))}
						</div>
					</div>
				) : error ? (
					<ErrorState
						title={t("settings_blocked.error_load")}
						description={error}
						onRetry={() => void refetchIds()}
					/>
				) : blockedProfiles.length === 0 ? (
					<DrawerEmptyState
						icon={<ShieldCheck />}
						fanned={false}
						title={t("settings_blocked.empty")}
						hint={t("settings_blocked.empty_desc", { defaultValue: "Accounts you block won't be able to see you or message you." })}
					/>
				) : (
					<div>
						<div className="mb-2 flex items-center gap-2 px-1">
							<p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
								{t("settings_blocked.section_label", { defaultValue: "Blocked" })}
							</p>
							<span className="rounded-full ink-tint-10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
								{blockedProfiles.length}
							</span>
						</div>
						<div className="native-card divide-y divide-[color-mix(in_srgb,var(--text)_8%,transparent)] overflow-hidden">
							{blockedProfiles.map((profile) => {
								const isMutating = mutatingProfileId === profile.profileId;
								return (
									<div key={profile.profileId} className="flex items-center gap-3 px-4 py-3">
										<button
											type="button"
											className="flex min-w-0 flex-1 items-center gap-3 text-left"
											onClick={() => navigate(`/profile/${profile.profileId}`, { state: { returnTo: location.pathname } })}
										>
											<div className="h-11 w-11 shrink-0 rounded-full overflow-hidden bg-[var(--surface-2)] drop-shadow-sm">
												<ProfileImage
													className="bg-slate-500/15 text-slate-400"
													src={profile.avatarUrl}
													alt={t("profile_details.photo_alt", { name: profile.displayName })}
												/>
											</div>
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-semibold">
													{profile.displayName}
												</p>
												<p className="text-xs text-[var(--text-muted)]">
													{t("settings_blocked.profile_id", { id: profile.profileId })}
												</p>
											</div>
										</button>
										<button
											type="button"
											onClick={() => handleUnblockPress(profile.profileId)}
											onPointerUp={(event) => {
												if (event.pointerType === "mouse") return;
												event.preventDefault();
												handleUnblockPress(profile.profileId);
											}}
											disabled={isMutating}
											className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full ink-tint-10 px-3 text-xs font-semibold text-[var(--text)] transition-[transform,background-color,color] duration-150 hover:bg-red-500/12 hover:text-red-500 active:scale-[0.96] disabled:opacity-50"
										>
											{isMutating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
											{isMutating
												? t("profile_details.unblock_in_progress")
												: t("profile_details.unblock")}
										</button>
									</div>
								);
							})}
						</div>
					</div>
				)}
				{/* Unblock all: a destructive action row of its own, like in the
				    native settings apps, with its explanation as a footnote. */}
				{!isLoading && !error && blockedProfiles.length > 0 && (
					<div>
						<div className="native-card overflow-hidden">
							<button
								type="button"
								onClick={() => setConfirmUnblockAll(true)}
								disabled={isUnblockingAll}
								className="flex w-full items-center justify-center gap-2 px-4 py-3.5 text-sm font-semibold text-red-500 transition-colors hover:bg-red-500/8 active:bg-red-500/12 disabled:opacity-60"
							>
								{isUnblockingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
								{isUnblockingAll
									? t("settings_blocked.unblocking_all", { defaultValue: "Unblocking…" })
									: t("settings_blocked.unblock_all_title", { defaultValue: "Unblock All" })}
							</button>
						</div>
						<p className="mt-2 px-4 text-xs leading-relaxed text-[var(--text-muted)]">
							{t("settings_blocked.unblock_all_desc", { defaultValue: "Remove all blocked accounts at once. This cannot be undone." })}
						</p>
					</div>
				)}
			</div>

			<ConfirmDialog
				isOpen={confirmUnblockAll}
				title={t("settings_blocked.unblock_all_title", { defaultValue: "Unblock All" })}
				message={t("settings_blocked.unblock_all_confirm", { defaultValue: "This will unblock all blocked accounts. Are you sure?" })}
				confirmLabel={isUnblockingAll ? t("settings_blocked.unblocking_all", { defaultValue: "Unblocking…" }) : t("settings_blocked.unblock_all_title", { defaultValue: "Unblock All" })}
				cancelLabel={t("settings_blocked.cancel", { defaultValue: "Cancel" })}
				onConfirm={() => void handleUnblockAll()}
				onCancel={() => setConfirmUnblockAll(false)}
				isProcessing={isUnblockingAll}
				confirmTone="danger"
			/>
		</PullToRefreshContainer>
	);
}
