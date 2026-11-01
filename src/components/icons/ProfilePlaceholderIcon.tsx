import { useState, type SVGProps } from "react";
import {
	BatFilled,
	ChristmasTreeFilled,
	GhostFilled,
	GiftFilled,
	HeartArrowFilled,
	HeartFilled,
	LoveLetterFilled,
	PumpkinFilled,
	RingFilled,
	SkullFilled,
	SnowflakeFilled,
	SnowmanFilled,
	UserFilled,
} from "./FilledIcons";
import { useActiveSeason, type SeasonalOverlayId } from "../../hooks/useSeasonalOverlay";

const HALLOWEEN_ICONS = [GhostFilled, SkullFilled, BatFilled, PumpkinFilled];
const CHRISTMAS_ICONS = [SnowmanFilled, ChristmasTreeFilled, GiftFilled, SnowflakeFilled];
const VALENTINES_ICONS = [HeartFilled, HeartArrowFilled, RingFilled, LoveLetterFilled];
const SEASON_ICONS: Record<SeasonalOverlayId, typeof HALLOWEEN_ICONS> = {
	halloween: HALLOWEEN_ICONS,
	christmas: CHRISTMAS_ICONS,
	valentines: VALENTINES_ICONS,
};

/** Stand-in for a missing profile photo: a user icon, or during a seasonal theme a random themed one. */
export function ProfilePlaceholderIcon(props: SVGProps<SVGSVGElement>) {
	const activeSeason = useActiveSeason();
	// Every set has four icons, so one index serves any of them.
	const [index] = useState(() => Math.floor(Math.random() * HALLOWEEN_ICONS.length));
	const icons = activeSeason ? SEASON_ICONS[activeSeason] : null;
	if (!icons) {
		return <UserFilled {...props} />;
	}
	const Icon = icons[index];
	return <Icon {...props} />;
}
