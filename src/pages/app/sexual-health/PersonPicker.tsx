import { useEffect, useMemo, useState } from "react";
import { Loader2, SearchX, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SHEET_FOOTER_CLASS, sheetButtonClass } from "../../../components/ui/bottom-sheet";
import { ProfileImage } from "../../../components/ui/profile-image";
import { SheetSearchInput, SheetSection, SheetTextInput } from "../../../components/ui/sheet-section";
import { DrawerEmptyState } from "../chat/drawerUi";
import { listConversations } from "../../../services/chatDb";
import { getLocalNicknamesForProfiles } from "../../../services/chatContactIndex";
import { resolveAvatarSrc } from "../../../services/avatarStore";
import { getParticipantAvatarUrl } from "../chat/chatUtils";

export interface PickedPerson {
	profileId: string | null;
	conversationId: string | null;
	displayName: string;
	avatarSrc: string | null;
}

interface PickerRow {
	conversationId: string;
	profileId: string;
	name: string;
	avatarSrc: string | null;
}

interface PersonPickerProps {
	onPick: (person: PickedPerson) => void;
}

export function PersonPicker({ onPick }: PersonPickerProps) {
	const { t } = useTranslation();
	const [rows, setRows] = useState<PickerRow[] | null>(null);
	const [query, setQuery] = useState("");
	const [freeTextMode, setFreeTextMode] = useState(false);
	const [freeTextName, setFreeTextName] = useState("");

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const conversations = await listConversations();
			const eligible = conversations.filter(
				(conversation) => !conversation.hidden && conversation.blockState == null && conversation.otherProfileId,
			);
			const profileIds = eligible.map((conversation) => conversation.otherProfileId as string);
			const nicknames = await getLocalNicknamesForProfiles(profileIds);
			if (cancelled) return;

			const mapped: PickerRow[] = eligible.map((conversation) => {
				const otherProfileId = conversation.otherProfileId as string;
				const participant = conversation.entry.data.participants.find(
					(p) => String(p.profileId) === otherProfileId,
				);
				const avatarSrc = resolveAvatarSrc(
					participant?.primaryMediaHash,
					getParticipantAvatarUrl(participant?.primaryMediaHash),
				);
				const name =
					nicknames[otherProfileId] ||
					conversation.entry.data.name ||
					t("common.unknown_display_name", { defaultValue: "Someone" });
				return { conversationId: conversation.conversationId, profileId: otherProfileId, name, avatarSrc };
			});
			setRows(mapped);
		})();
		return () => {
			cancelled = true;
		};
	}, [t]);

	const filtered = useMemo(() => {
		if (!rows) return [];
		const q = query.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter((row) => row.name.toLowerCase().includes(q));
	}, [rows, query]);

	// Free text: just a name, in the sheet's usual field and footer.
	if (freeTextMode) {
		return (
			<>
				<div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2" data-lenis-prevent>
					<SheetSection title={t("sexualHealth.encounter.someone_not_listed", { defaultValue: "Someone not listed" })}>
						<SheetTextInput
							value={freeTextName}
							onChange={setFreeTextName}
							placeholder={t("sexualHealth.encounter.name_placeholder", { defaultValue: "Their name…" })}
							autoFocus
						/>
					</SheetSection>
				</div>
				<div className={SHEET_FOOTER_CLASS}>
					<button type="button" onClick={() => setFreeTextMode(false)} className={sheetButtonClass("secondary")}>
						{t("sexualHealth.encounter.back", { defaultValue: "Back" })}
					</button>
					<button
						type="button"
						disabled={!freeTextName.trim()}
						onClick={() =>
							onPick({
								profileId: null,
								conversationId: null,
								displayName: freeTextName.trim(),
								avatarSrc: null,
							})
						}
						className={sheetButtonClass()}
					>
						{t("sexualHealth.encounter.continue", { defaultValue: "Continue" })}
					</button>
				</div>
			</>
		);
	}

	// Floating search over the conversation list, like the other picker sheets.
	return (
		<>
			<SheetSearchInput
				floating
				value={query}
				onChange={setQuery}
				placeholder={t("sexualHealth.encounter.search_placeholder", { defaultValue: "Search conversations…" })}
			/>
			<div className="-mx-4 min-h-0 flex-1 overflow-y-auto pb-2" data-lenis-prevent>
				{rows === null ? (
					<div className="flex justify-center py-8 text-[var(--text-muted)]">
						<Loader2 className="h-5 w-5 animate-spin" />
					</div>
				) : filtered.length === 0 && query.trim() ? (
					<div className="px-4">
						<DrawerEmptyState
							icon={<SearchX />}
							fanned={false}
							title={t("sexualHealth.encounter.no_matches", { defaultValue: "No matches." })}
							hint={t("sexualHealth.encounter.no_matches_hint", { defaultValue: "Not in your chats? Add them by name below." })}
						/>
					</div>
				) : (
					filtered.map((row) => (
						<button
							key={row.conversationId}
							type="button"
							onClick={() =>
								onPick({
									profileId: row.profileId,
									conversationId: row.conversationId,
									displayName: row.name,
									avatarSrc: row.avatarSrc,
								})
							}
							className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:ink-tint-6 active:ink-tint-10"
						>
							<div className="h-11 w-11 shrink-0 squircle bg-[var(--surface-2)] drop-shadow-sm">
								<ProfileImage src={row.avatarSrc} alt={row.name} />
							</div>
							<span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">{row.name}</span>
						</button>
					))
				)}
				<button
					type="button"
					onClick={() => setFreeTextMode(true)}
					className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-[var(--accent)] transition-colors hover:ink-tint-6 active:ink-tint-10"
				>
					<span className="flex h-11 w-11 shrink-0 items-center justify-center squircle accent-tint-14">
						<UserPlus className="h-5 w-5" />
					</span>
					{t("sexualHealth.encounter.someone_not_listed", { defaultValue: "Someone not listed" })}
				</button>
			</div>
		</>
	);
}
