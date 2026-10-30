import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Hourglass, Loader2, Search, Star, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeaderBackButton } from "./HeaderBackButton";
import { PageHeaderBackground } from "./ui/PageHeaderBackground";
import { ProfileImage } from "./ui/profile-image";
import * as chatDb from "../services/chatDb";
import { sendChatMediaBatch, UNLIMITED_VIEWS, type BatchSendResult } from "../services/chatMediaSend";
import { useApiFunctions } from "../hooks/useApiFunctions";
import { usePreferences } from "../contexts/PreferencesContext";
import { getLocalNicknamesForProfiles } from "../services/chatContactIndex";
import { getNicknameRename } from "../hooks/useNicknameNameChange";
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
import { sheetButtonClass } from "./ui/bottom-sheet";

const PREVIEW_COUNT = 6;

type PickerChat = {
	conversationId: string;
	profileId: number | string;
	name: string;
	/** Their own display name when `name` is a nickname; also searchable. */
	realName: string | null;
	mediaHash: string | null;
	entry: ConversationEntry;
	favorite: boolean;
};

function Avatar({ chat, selected, small }: { chat: PickerChat; selected: boolean; small?: boolean }) {
	return (
		<div className="relative shrink-0">
			<div className={`${small ? "h-11 w-11" : "h-15 w-15"} rounded-full overflow-hidden bg-[var(--surface-2)] drop-shadow-sm`}>
				<ProfileImage
					src={resolveAvatarSrc(chat.mediaHash, getParticipantAvatarUrl(chat.mediaHash))}
					alt={chat.name}
				/>
			</div>
			{selected ? (
				<span className="absolute circle-badge-br flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--bg)] bg-[var(--accent)] text-[var(--accent-contrast)]">
					<Check className="h-3 w-3" strokeWidth={3} />
				</span>
			) : null}
		</div>
	);
}

/**
 * "Send to…" chooser for images shared in from Android's share sheet without
 * a Direct Share target (see ShareTargetBridge): the shared images (each can
 * be dropped again) and a list of chats, most recently active first. Any
 * number of chats can be selected; Send uploads each image once and sends
 * all of them to every selected chat (see chatMediaSend), with one shared
 * "View once" choice instead of the per-image attachment dialog.
 * Laid out like a settings subpage: back arrow to cancel, search toggle in
 * the header; only the chat list scrolls.
 */
export function ShareChatPicker({
	files,
	userId,
	onSent,
	onChangeFiles,
	onCancel,
}: {
	files: File[];
	userId: number;
	/** After a send, successful or not; the picker has done nothing else yet. */
	onSent: (conversationIds: string[], result: BatchSendResult) => void;
	onChangeFiles: (files: File[]) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	useAvatarCache();
	const [chats, setChats] = useState<PickerChat[] | null>(null);
	const [query, setQuery] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [favoritesOnly, setFavoritesOnly] = useState(false);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const { defaultExpiringPhotos } = usePreferences();
	const [viewOnce, setViewOnce] = useState(Boolean(defaultExpiringPhotos));
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const api = useApiFunctions();
	const isSending = progress !== null;
	// The glass send bar floats over the list; the list reserves its height.
	const sendBarRef = useRef<HTMLDivElement>(null);
	const [sendBarHeight, setSendBarHeight] = useState(0);

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
					conversations.flatMap((c, index) => {
						const other = others[index];
						// No one to send to (e.g. a stub row without participants).
						if (other?.profileId == null) return [];
						const nickname = nicknames[String(other.profileId)];
						return {
							conversationId: c.conversationId,
							profileId: other.profileId,
							name: nickname || c.entry.data.name || t("common.unknown_display_name"),
							realName: getNicknameRename(nickname, c.entry.data.name, null).realName,
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
			if (event.key !== "Escape" || isSending) return;
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
	}, [isSearchOpen, isSending, onCancel]);

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
				(!needle ||
					chat.name.toLowerCase().includes(needle) ||
					Boolean(chat.realName?.toLowerCase().includes(needle))) &&
				(!favoritesOnly || chat.favorite),
		);
	}, [chats, query, favoritesOnly]);

	const selectedChats = useMemo(
		() => selectedIds.flatMap((id) => chats?.find((chat) => chat.conversationId === id) ?? []),
		[chats, selectedIds],
	);

	const hasSelection = selectedChats.length > 0;
	useEffect(() => {
		const bar = sendBarRef.current;
		if (!bar) {
			setSendBarHeight(0);
			return;
		}
		const observer = new ResizeObserver(() => setSendBarHeight(bar.offsetHeight));
		observer.observe(bar);
		return () => observer.disconnect();
	}, [hasSelection]);

	const toggleSelected = (conversationId: string) => {
		setSelectedIds((previous) =>
			previous.includes(conversationId)
				? previous.filter((id) => id !== conversationId)
				: [...previous, conversationId],
		);
	};

	const send = async () => {
		if (isSending || selectedChats.length === 0) return;
		setProgress({ done: 0, total: files.length * selectedChats.length });
		const result = await sendChatMediaBatch(
			api,
			files,
			selectedChats.map((chat) => chat.profileId),
			{ maxViews: viewOnce ? 1 : UNLIMITED_VIEWS },
			(done, total) => setProgress({ done, total }),
		);
		setProgress(null);
		onSent(
			selectedChats.map((chat) => chat.conversationId),
			result,
		);
	};

	const removeFile = (file: File) => {
		const remaining = files.filter((candidate) => candidate !== file);
		if (remaining.length === 0) onCancel();
		else onChangeFiles(remaining);
	};

	return (
		<div className="fixed inset-0 z-[110] flex flex-col overflow-hidden bg-[var(--bg)] no-touch-callout">
			<section className="app-screen relative flex h-dvh w-full flex-col overflow-x-hidden !px-0 !pb-0">
				{/* Same header as SettingsPage (accent glow, search toggle), with a back arrow like its subpages. */}
				<header className="relative z-20 flex shrink-0 flex-col gap-3 pb-3 pointer-events-none">
					<PageHeaderBackground color="var(--accent)" />
					<div className="pointer-events-auto mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-3 px-[var(--app-px)]">
						<div className="flex h-[var(--header-row-h)] items-center gap-2">
							<HeaderBackButton onClick={() => !isSending && onCancel()} label={t("common.cancel")} />
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
										className="shrink-0 rounded-full p-1 text-[var(--text-muted)] transition hover-fill hover:text-[var(--text)]"
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
					style={{
						paddingBottom: hasSelection ? sendBarHeight : "env(safe-area-inset-bottom, 0px)",
					}}
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
									onClick={() => toggleSelected(chat.conversationId)}
									disabled={isSending}
									aria-pressed={selectedIds.includes(chat.conversationId)}
									className="flex w-full items-center gap-4 border-b border-[var(--surface-2)] py-3 pl-4 pr-4 text-left transition hover-fill"
								>
									<Avatar chat={chat} selected={selectedIds.includes(chat.conversationId)} />
									<div className="min-w-0 flex-1">
										<div className="flex items-center justify-between gap-2">
											<div className="flex min-w-0 items-center gap-1.5">
												<p
													className="truncate text-sm font-semibold text-[var(--text)]"
													title={chat.realName ? t("chat.nicknames.real_name", { name: chat.realName }) : undefined}
												>
													{chat.name}
												</p>
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

				{hasSelection ? (
					<div
						ref={sendBarRef}
						className="absolute inset-x-0 bottom-0 z-20 border-t border-[var(--border)]"
						// Same frosted glass as the bottom NavBar.
						style={{
							background: "color-mix(in srgb, var(--surface) 90%, transparent)",
							backdropFilter: "blur(16px)",
							WebkitBackdropFilter: "blur(16px)",
							paddingBottom: "max(12px, calc(env(safe-area-inset-bottom) + 8px))",
						}}
					>
						<div className="mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-2.5 pt-3">
							{/* Selected chats, WhatsApp-style: avatar + name, tap to deselect. */}
							<div className="flex gap-3 overflow-x-auto px-4" data-lenis-prevent>
								{selectedChats.map((chat) => (
									<button
										key={chat.conversationId}
										type="button"
										onClick={() => toggleSelected(chat.conversationId)}
										disabled={isSending}
										aria-label={chat.name}
										className="flex w-14 shrink-0 flex-col items-center gap-1 disabled:opacity-60"
									>
										<div className="relative">
											<Avatar chat={chat} selected={false} small />
											<span className="absolute circle-badge-tr flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--surface-2)] text-[var(--text-muted)]">
												<X className="h-3 w-3" strokeWidth={3} />
											</span>
										</div>
										<span className="w-full truncate text-center text-[11px] text-[var(--text-muted)]">
											{chat.name}
										</span>
									</button>
								))}
							</div>
							{/* Same footer as the chat's attachment dialog (BottomDrawer): expiry box + Send. */}
							<div className="flex gap-2 px-3">
								<button
									type="button"
									onClick={() => setViewOnce((value) => !value)}
									disabled={isSending}
									aria-pressed={viewOnce}
									title={t("chat.attachments.view_once_description")}
									className={`inline-flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-50 ${viewOnce ? "accent-tint-15 text-[var(--accent)]" : "ink-tint-10 text-[var(--text)] hover:ink-tint-14"}`}
								>
									<Hourglass className={`h-4 w-4 shrink-0 ${viewOnce ? "" : "text-[var(--text-muted)]"}`} />
									{viewOnce
										? t("chat_drawer.expiry.ten_seconds", { defaultValue: "10s" })
										: t("chat_drawer.expiry.unlimited", { defaultValue: "Unlimited" })}
								</button>
								<button
									type="button"
									onClick={() => void send()}
									disabled={isSending}
									className={sheetButtonClass()}
								>
									{isSending ? (
										<>
											<Loader2 className="h-4 w-4 animate-spin" />
											{t("chat.share_target.sending", {
												defaultValue: "Sending {{done}}/{{total}}",
												done: progress.done,
												total: progress.total,
											})}
										</>
									) : viewOnce ? (
										t("chat.attachments.send_expiring")
									) : (
										t("chat.attachments.send")
									)}
								</button>
							</div>
						</div>
					</div>
				) : null}
			</section>
		</div>
	);
}
