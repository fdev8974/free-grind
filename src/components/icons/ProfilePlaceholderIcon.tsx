import { useState, type SVGProps } from "react";
import { BatFilled, GhostFilled, PumpkinFilled, SkullFilled, UserFilled } from "./FilledIcons";
import { useIsHalloween } from "../../hooks/useIsHalloween";

const HALLOWEEN_ICONS = [GhostFilled, SkullFilled, BatFilled, PumpkinFilled];

/** Stand-in for a missing profile photo: a user icon, or on Halloween a random spooky one. */
export function ProfilePlaceholderIcon(props: SVGProps<SVGSVGElement>) {
	const isHalloween = useIsHalloween();
	const [index] = useState(() => Math.floor(Math.random() * HALLOWEEN_ICONS.length));
	if (!isHalloween) {
		return <UserFilled {...props} />;
	}
	const Icon = HALLOWEEN_ICONS[index];
	return <Icon {...props} />;
}
