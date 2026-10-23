import { Check, FlaskConical, GitBranch, Plus, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheet, SheetClose, SheetCloseButton } from "../../components/ui/bottom-sheet";
import { NATIVE_SHEET_BG, afterSheetClose } from "../../components/ui/action-sheet";
import {
	getContributorHandle,
	getHotswapChannelLabel,
	isContributorChannel,
	type HotswapChannel,
} from "../../services/hotswap";
import { cn } from "../../utils/cn";

const CHANNEL_ICONS: Record<string, { icon: typeof Check; iconClass: string }> = {
	main: { icon: ShieldCheck, iconClass: "bg-green-500/15 text-green-400" },
	development: { icon: FlaskConical, iconClass: "bg-amber-500/15 text-amber-400" },
};

function ChannelRow({
	icon: Icon,
	iconClass,
	label,
	description,
	selected,
	disabled,
	onSelect,
}: {
	icon: typeof Check;
	iconClass: string;
	label: string;
	description?: string;
	selected: boolean;
	disabled?: boolean;
	onSelect: () => void;
}) {
	return (
		<SheetClose
			onClick={onSelect}
			disabled={disabled}
			className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)] disabled:opacity-50"
		>
			<div className={cn("shrink-0 rounded-2xl p-2.5", iconClass)}>
				<Icon className="h-5 w-5" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold leading-snug">{label}</p>
				{description && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>}
			</div>
			{selected && <Check className="h-5 w-5 shrink-0 text-[var(--accent)]" strokeWidth={2.5} />}
		</SheetClose>
	);
}

/**
 * Picks the OTA release track. Switching reloads the app, so it only starts
 * once the sheet has closed and popped its history entry.
 */
export function UpdateChannelSheet({
	channels,
	current,
	canAddContributor,
	disabled,
	isDesktop,
	onSelect,
	onAddContributor,
	onClose,
}: {
	channels: readonly HotswapChannel[];
	current: HotswapChannel;
	/** Developer mode: offers adding a contributor channel. */
	canAddContributor: boolean;
	disabled: boolean;
	isDesktop: boolean;
	onSelect: (channel: HotswapChannel) => void;
	onAddContributor: () => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const descriptions: Record<string, string> = {
		main: t("settings.update_channel_main_desc", { defaultValue: "Tested releases. Recommended." }),
		development: t("settings.update_channel_development_desc", {
			defaultValue: "The newest changes as soon as they're built. May be unstable.",
		}),
	};
	const select = (channel: HotswapChannel) => {
		if (channel !== current) afterSheetClose(() => onSelect(channel));
	};

	return (
		<BottomSheet onClose={onClose} isDesktop={isDesktop} bg={NATIVE_SHEET_BG} panelClassName="px-4">
			<div className="mb-1 flex items-center justify-between gap-3">
				<h3 className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">
					{t("settings.update_channel", { defaultValue: "Update Channel" })}
				</h3>
				<SheetCloseButton />
			</div>
			<p className="mb-2 text-xs leading-snug text-[var(--text-muted)]">
				{t("settings.update_channel_desc", { defaultValue: "Which release track this app gets updates from." })}
			</p>
			<div className="-mx-1 pb-2">
				{channels.map((channel) => (
					<ChannelRow
						key={channel}
						icon={CHANNEL_ICONS[channel]?.icon ?? GitBranch}
						iconClass={CHANNEL_ICONS[channel]?.iconClass ?? "bg-[var(--surface-2)] text-[var(--text-muted)]"}
						label={getHotswapChannelLabel(channel)}
						description={descriptions[channel]}
						selected={channel === current}
						disabled={disabled}
						onSelect={() => select(channel)}
					/>
				))}
				{isContributorChannel(current) ? (
					<ChannelRow
						icon={GitBranch}
						iconClass="bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]"
						label={getContributorHandle(current) ?? current}
						description={t("settings.update_channel_contributor_desc", { defaultValue: "Contributor channel" })}
						selected
						onSelect={() => {}}
					/>
				) : canAddContributor ? (
					<ChannelRow
						icon={Plus}
						iconClass="bg-[var(--surface-2)] text-[var(--text-muted)]"
						label="Add Contributor Channel"
						description="Get updates from a contributor's builds."
						selected={false}
						disabled={disabled}
						onSelect={() => afterSheetClose(onAddContributor)}
					/>
				) : null}
			</div>
		</BottomSheet>
	);
}
