import { Bookmark } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { SavedLocation } from "../../../../services/savedLocations";
import { reverseGeocodeCityDistrictForGeohash } from "../geocoding";

/** Resolves a geohash to a label, or null while pending / when it can't be resolved. */
export function useGeohashLabel(geohash: string | null, resolve: (geohash: string) => Promise<string | null>, debounceMs = 0) {
	const [label, setLabel] = useState<{ geohash: string; value: string | null } | null>(null);
	useEffect(() => {
		if (!geohash) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			void resolve(geohash).then((value) => {
				if (!cancelled) setLabel({ geohash, value });
			});
		}, debounceMs);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [geohash, resolve, debounceMs]);
	// Stale result for a previous pin position counts as still resolving.
	return label && label.geohash === geohash ? { resolved: true, value: label.value } : { resolved: false, value: null };
}

interface LocationChipProps {
	icon: ReactNode;
	title: string;
	subtitle: string | null;
	isActive: boolean;
	onClick: () => void;
	disabled?: boolean;
	/** Highlight color for the active state — defaults to --accent (explore mode passes its own). */
	accentColor?: string;
	accentContrast?: string;
}

export function LocationChip({
	icon,
	title,
	subtitle,
	isActive,
	onClick,
	disabled,
	accentColor = "var(--accent)",
	accentContrast = "var(--accent-contrast)",
}: LocationChipProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			style={{ "--chip-accent": accentColor, "--chip-accent-contrast": accentContrast } as CSSProperties}
			// Frosted like the bottom nav bar and the page headers (surface at 80%
			// + 24px blur), since the chips float over the map sheets' map.
			className={`flex max-w-[14rem] shrink-0 items-center gap-2.5 rounded-2xl border py-2 pl-2 pr-3.5 text-left backdrop-blur-[24px] transition active:scale-95 disabled:opacity-60 ${
				isActive
					? "border-transparent bg-[color-mix(in_srgb,color-mix(in_srgb,var(--chip-accent)_16%,var(--surface))_80%,transparent)] ring-2 ring-inset ring-[var(--chip-accent)]"
					: "border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_80%,transparent)] hover:bg-[color-mix(in_srgb,var(--surface)_90%,transparent)]"
			}`}
		>
			<span
				className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
					isActive ? "bg-[var(--chip-accent)] text-[var(--chip-accent-contrast)]" : "bg-[var(--surface)] text-[var(--chip-accent)]"
				}`}
			>
				{icon}
			</span>
			<span className="min-w-0">
				<span className="block truncate text-sm font-semibold leading-tight text-[var(--text)]">{title}</span>
				{subtitle ? <span className="mt-0.5 block truncate text-[11px] leading-tight text-[var(--text-muted)]">{subtitle}</span> : null}
			</span>
		</button>
	);
}

export function SavedLocationChip({
	location,
	...chipProps
}: { location: SavedLocation } & Omit<LocationChipProps, "icon" | "title" | "subtitle">) {
	const { value } = useGeohashLabel(location.geohash, reverseGeocodeCityDistrictForGeohash);
	return (
		<LocationChip
			icon={<Bookmark className="h-4 w-4 fill-current" />}
			title={location.name}
			subtitle={value}
			{...chipProps}
		/>
	);
}
