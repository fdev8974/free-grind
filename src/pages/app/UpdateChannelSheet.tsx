import { FlaskConical, GitBranch, Plus, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { afterSheetClose } from "../../components/ui/action-sheet";
import { SelectSheet, type SelectSheetOption } from "../../components/ui/select-sheet";
import {
	getContributorHandle,
	getHotswapChannelLabel,
	isContributorChannel,
	type HotswapChannel,
} from "../../services/hotswap";

const ADD_CONTRIBUTOR = "add-contributor";

const CHANNEL_ICONS: Record<string, Pick<SelectSheetOption<string>, "icon" | "iconClassName">> = {
	main: { icon: ShieldCheck, iconClassName: "bg-green-500/15 text-green-400" },
	development: { icon: FlaskConical, iconClassName: "bg-amber-500/15 text-amber-400" },
};

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

	const options: SelectSheetOption<string>[] = channels.map((channel) => ({
		value: channel,
		label: getHotswapChannelLabel(channel),
		description: descriptions[channel],
		icon: CHANNEL_ICONS[channel]?.icon ?? GitBranch,
		iconClassName: CHANNEL_ICONS[channel]?.iconClassName,
	}));
	if (isContributorChannel(current)) {
		options.push({
			value: current,
			label: getContributorHandle(current) ?? current,
			description: t("settings.update_channel_contributor_desc", { defaultValue: "Contributor channel" }),
			icon: GitBranch,
			iconClassName: "accent-tint-15 text-[var(--accent)]",
		});
	} else if (canAddContributor) {
		options.push({
			value: ADD_CONTRIBUTOR,
			label: "Add Contributor Channel",
			description: "Get updates from a contributor's builds.",
			icon: Plus,
		});
	}

	return (
		<SelectSheet
			title={t("settings.update_channel", { defaultValue: "Update Channel" })}
			description={t("settings.update_channel_desc", { defaultValue: "Which release track this app gets updates from." })}
			value={current}
			options={options}
			disabled={disabled}
			onSelect={(value) => {
				if (value === ADD_CONTRIBUTOR) afterSheetClose(onAddContributor);
				else afterSheetClose(() => onSelect(value as HotswapChannel));
			}}
			onClose={onClose}
			isDesktop={isDesktop}
		/>
	);
}
