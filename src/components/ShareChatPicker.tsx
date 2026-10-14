import { useEffect, useMemo, useState } from "react";
import { Search, Star, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeaderBackButton } from "./HeaderBackButton";
import { PageHeaderBackground } from "./ui/PageHeaderBackground";
import { ProfileImage } from "./ui/profile-image";
import * as chatDb from "../services/chatDb";
import { getLocalNicknamesForProfiles } from "../services/chatContactIndex";
import { resolveAvatarSrc } from "../services/avatarStore";
import { useAvatarCache } from "../hooks/useAvatarCache";
import {
	formatConversationTime,
	getOtherParticipant,
	getParticipantAvatarUrl,
	getPreviewText,
} from "../pages/app/chat/chatUtils";
import type { ConversationEntry } from "../types/messages";
import { appLog } from "../utils/logger";

const PREVIEW_COUNT = 6;

type PickerChat = {
	conversationId: string;
	name: string;
	mediaHash: string | null;
	entry: ConversationEntry;
	favorite: boolean;
};

function Avatar({ chat }: { chat: PickerChat }) {
	return (
		<div className="h-15 w-15 shrink-0 squircle bg-[var(--surface-2)] drop-shadow-sm">
			<ProfileImage
				src={resolveAvatarSrc(chat.mediaHash, getParticipantAvatarUrl(chat.mediaHash))}
				alt={chat.name}
			/>
		</div>
	);
}

/**
 * "Send to…" chooser for images shared in from Android's share sheet without
 * a Direct Share target (see ShareTargetBridge): the shared images (each can
 * be dropped again) and a list of chats, most recently active first.
 * Laid out like a settings subpage: back arrow to cancel, search toggle in
 * the header; only the chat list scrolls.
 */
export function ShareChatPicker({
	files,
	userId,
	onSelect,
	onChangeFiles,
	onCancel,
}: {
	files: File[];
	userId: number;
	onSelect: (conversationId: string) => void;
	onChangeFiles: (files: File[]) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	useAvatarCache();
	const [chats, setChats] = useState<PickerChat[] | null>(null);
	const [query, setQuery] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [favoritesOnly, setFavoritesOnly] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const conversations = (await chatDb.listConversations())
					.filter((c) => !c.hidden && !c.blockState)
					// listConversations puts pinned chats first; recency matters here.
					.sort(
						(a, b) =>
							(b.entry.data.lastActivityTimestamp ?? 0) - (a.entry.data.lastActivityTimestamp ?? 0),
					);
				const others = conversations.map((c) => getOtherParticipant(c.entry, userId));
				const nicknames = await getLocalNicknamesForProfiles(
					others.flatMap((other) => (other?.profileId != null ? [String(other.profileId)] : [])),
				).catch(() => ({}) as Record<string, string>);
				if (cancelled) return;
				setChats(
					conversations.map((c, index) => {
						const other = others[index];
						const nickname = other?.profileId != null ? nicknames[String(other.profileId)] : undefined;
						return {
							conversationId: c.conversationId,
							name: nickname || c.entry.data.name || t("common.unknown_display_name"),
							mediaHash: other?.primaryMediaHash ?? null,
							entry: c.entry,
							favorite: Boolean(c.entry.data.favorite),
						};
					}),
				);
			} catch (error) {
				appLog.warn("[share] Failed to load chats for the share picker", error);
				if (!cancelled) setChats([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [t, userId]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// Escape first closes an open search, then the picker.
			if (isSearchOpen) {
				setQuery("");
				setIsSearchOpen(false);
			} else {
				onCancel();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isSearchOpen, onCancel]);

	const previews = useMemo(
		() => files.slice(0, PREVIEW_COUNT).map((file) => ({ file, url: URL.createObjectURL(file) })),
		[files],
	);
	useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

	const visibleChats = useMemo(() => {
		if (!chats) return null;
		const needle = query.trim().toLowerCase();
		return chats.filter(
			(chat) =>
				(!needle || chat.name.toLowerCase().includes(needle)) &&
				(!favoritesOnly || chat.favorite),
		);
	}, [chats, query, favoritesOnly]);

	const removeFile = (file: File) => {
		const remaining = files.filter((candidate) => candidate !== file);
		if (remaining.length === 0) onCancel();
		else onChangeFiles(remaining);
	};

	return (
		<div className="fixed inset-0 z-[110] flex flex-col overflow-hidden bg-[var(--bg)] no-touch-callout">
			<section className="app-screen flex h-dvh w-full flex-col overflow-x-hidden !px-0 !pb-0">
				{/* Same header as SettingsPage (accent glow, search toggle), with a back arrow like its subpages. */}
				<header className="relative z-20 flex shrink-0 flex-col gap-3 pb-3 pointer-events-none">
					<PageHeaderBackground color="var(--accent)" />
					<div className="pointer-events-auto mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-3 px-[var(--app-px)]">
						<div className="flex h-[var(--header-row-h)] items-center gap-2">
							<HeaderBackButton onClick={onCancel} label={t("common.cancel")} />
							<h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
								{t("chat.share_target.title", { defaultValue: "Send to…" })}
							</h1>
							<div className="-my-2 flex shrink-0 items-center gap-0.5">
								<button
									type="button"
									onClick={() => setFavoritesOnly((value) => !value)}
									className={`header-icon-btn rounded-xl p-2 transition hover:text-[var(--text)] ${favoritesOnly ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
									aria-label={t("browse_filters.options.favorites")}
									aria-pressed={favoritesOnly}
									title={t("browse_filters.options.favorites")}
								>
									<Star className={`h-5 w-5 ${favoritesOnly ? "fill-current" : ""}`} />
								</button>
								<button
									type="button"
									onClick={() => {
										if (isSearchOpen) setQuery("");
										setIsSearchOpen(!isSearchOpen);
									}}
									className="header-icon-btn rounded-xl p-2 text-[var(--text-muted)] transition hover:text-[var(--text)]"
									aria-label={
										isSearchOpen
											? t("common.close", { defaultValue: "Close" })
											: t("chat.share_target.search", { defaultValue: "Search chats" })
									}
								>
									{isSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
								</button>
							</div>
						</div>

						{isSearchOpen ? (
							<div className="settings-search-bar flex items-center gap-2.5 px-4 py-0.5">
								<Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
								<input
									type="search"
									autoFocus
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder={t("chat.share_target.search", { defaultValue: "Search chats" })}
									className="h-11 flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
								/>
								{query ? (
									<button
										type="button"
										onClick={() => setQuery("")}
										className="shrink-0 rounded-full p-1 text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
										aria-label={t("common.clear", { defaultValue: "Clear" })}
									>
										<X className="h-4 w-4" />
									</button>
								) : null}
							</div>
						) : null}

						<p className="text-sm text-[var(--text-muted)]">
							{t("chat.share_target.description", {
								count: files.length,
								defaultValue_one: "Choose a chat to send the image to",
								defaultValue_other: "Choose a chat to send {{count}} images to",
							})}
						</p>

						<div className="flex gap-2 overflow-x-auto" data-lenis-prevent>
							{previews.map(({ file, url }) => (
								<div key={url} className="relative shrink-0">
									<img src={url} alt="" className="h-16 w-16 rounded-xl object-cover" />
									<button
										type="button"
										onClick={() => removeFile(file)}
										aria-label={t("chat.share_target.remove_image", { defaultValue: "Remove image" })}
										className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
									>
										<X className="h-3.5 w-3.5" />
									</button>
								</div>
							))}
							{files.length > previews.length ? (
								<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] text-sm font-semibold text-[var(--text-muted)]">
									+{files.length - previews.length}
								</div>
							) : null}
						</div>
					</div>
				</header>

				{/* Rows styled and spaced exactly like the inbox (ChatInboxPanel), no card
				    around them; only this list scrolls, ending at the page bottom. */}
				<div
					className="min-h-0 flex-1 overflow-y-auto"
					style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
					data-lenis-prevent
				>
					<div className="mx-auto w-full max-w-[var(--content-max)]">
						{visibleChats === null ? (
							<p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">{t("chat.loading_inbox")}</p>
						) : visibleChats.length === 0 ? (
							<p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
								{t("chat.share_target.no_chats", { defaultValue: "No chats found" })}
							</p>
						) : (
							visibleChats.map((chat) => (
								<button
									key={chat.conversationId}
									type="button"
									onClick={() => onSelect(chat.conversationId)}
									className="flex w-full items-center gap-4 border-b border-[var(--surface-2)] py-3 pl-4 pr-4 text-left transition hover:bg-[var(--surface-2)]"
								>
									<Avatar chat={chat} />
									<div className="min-w-0 flex-1">
										<div className="flex items-center justify-between gap-2">
											<div className="flex min-w-0 items-center gap-1.5">
												<p className="truncate text-sm font-semibold text-[var(--text)]">{chat.name}</p>
												{chat.favorite ? (
													<Star className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--accent)]" />
												) : null}
											</div>
											<span className="shrink-0 text-xs text-[var(--text-muted)]">
												{formatConversationTime(chat.entry.data.lastActivityTimestamp)}
											</span>
										</div>
										<p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
											{getPreviewText(chat.entry, t)}
										</p>
									</div>
								</button>
							))
						)}
					</div>
				</div>
			</section>
		</div>
	);
}
