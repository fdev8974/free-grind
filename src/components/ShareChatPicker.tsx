import { useEffect, useMemo, useState } from "react";
import { Search, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FullscreenPrompt, fullscreenSecondaryButtonClass } from "./FullscreenPrompt";
import { ProfileImage } from "./ui/profile-image";
import * as chatDb from "../services/chatDb";
import { getLocalNicknamesForProfiles } from "../services/chatContactIndex";
import { resolveAvatarSrc } from "../services/avatarStore";
import { useAvatarCache } from "../hooks/useAvatarCache";
import { getOtherParticipant, getParticipantAvatarUrl } from "../pages/app/chat/chatUtils";
import { appLog } from "../utils/logger";

type PickerChat = {
	conversationId: string;
	name: string;
	mediaHash: string | null;
};

/**
 * "Send to…" chooser for images shared in from Android's share sheet without
 * a Direct Share target (see ShareTargetBridge): a compact, searchable list
 * of chats, most recently active first.
 */
export function ShareChatPicker({
	files,
	userId,
	onSelect,
	onCancel,
}: {
	files: File[];
	userId: number;
	onSelect: (conversationId: string) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	useAvatarCache();
	const [chats, setChats] = useState<PickerChat[] | null>(null);
	const [query, setQuery] = useState("");

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

	const previews = useMemo(() => files.slice(0, 4).map((file) => URL.createObjectURL(file)), [files]);
	useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

	const visibleChats = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!chats || !needle) return chats;
		return chats.filter((chat) => chat.name.toLowerCase().includes(needle));
	}, [chats, query]);

	return (
		<FullscreenPrompt
			overlay
			icon={Send}
			title={t("chat.share_target.title", { defaultValue: "Send to…" })}
			description={t("chat.share_target.description", {
				count: files.length,
				defaultValue_one: "Choose a chat to send the image to",
				defaultValue_other: "Choose a chat to send {{count}} images to",
			})}
			footer={
				<button type="button" onClick={onCancel} className={fullscreenSecondaryButtonClass}>
					{t("common.cancel")}
				</button>
			}
		>
			<div className="flex flex-col gap-3 text-left">
				<div className="flex justify-center gap-2">
					{previews.map((url) => (
						<img key={url} src={url} alt="" className="h-14 w-14 rounded-xl object-cover" />
					))}
					{files.length > previews.length ? (
						<div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--surface-2)] text-sm font-semibold text-[var(--text-muted)]">
							+{files.length - previews.length}
						</div>
					) : null}
				</div>

				<label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
					<Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("chat.share_target.search", { defaultValue: "Search chats" })}
						className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
					/>
				</label>

				<div
					className="surface-card max-h-[45dvh] min-h-0 divide-y divide-[var(--border)] overflow-y-auto"
					data-lenis-prevent
				>
					{visibleChats === null ? (
						<p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
							{t("chat.loading_inbox")}
						</p>
					) : visibleChats.length === 0 ? (
						<p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
							{t("chat.share_target.no_chats", { defaultValue: "No chats found" })}
						</p>
					) : (
						visibleChats.map((chat) => (
							<button
								key={chat.conversationId}
								type="button"
								onClick={() => onSelect(chat.conversationId)}
								className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]"
							>
								<div className="h-10 w-10 shrink-0 squircle bg-[var(--surface-2)]">
									<ProfileImage
										src={resolveAvatarSrc(chat.mediaHash, getParticipantAvatarUrl(chat.mediaHash))}
										alt={chat.name}
									/>
								</div>
								<span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">
									{chat.name}
								</span>
							</button>
						))
					)}
				</div>
			</div>
		</FullscreenPrompt>
	);
}
