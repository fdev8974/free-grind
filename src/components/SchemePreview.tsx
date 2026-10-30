import type { ColorScheme } from "../contexts/PreferencesContext";
import { cn } from "../utils/cn";

/* Fixed palettes (index.css light / dark / AMOLED values) so every preview
   shows its scheme regardless of the one currently active. */
const SCHEME_PREVIEW_COLORS = {
	light: { bg: "#e9ecf1", card: "#ffffff", line: "#d7dce3" },
	dark: { bg: "#0f131a", card: "#161d27", line: "#2b3646" },
	amoled: { bg: "#000000", card: "#111418", line: "#1e232b" },
};

function SchemeMockup({ colors }: { colors: (typeof SCHEME_PREVIEW_COLORS)["light"] }) {
	return (
		<div className="flex h-full flex-col gap-1 p-2" style={{ background: colors.bg }}>
			<div className="h-1.5 w-1/2 rounded-full" style={{ background: "var(--accent)" }} />
			{[0, 1].map((i) => (
				<div key={i} className="flex flex-1 flex-col justify-center gap-1 rounded-md px-1.5" style={{ background: colors.card }}>
					<div className="h-1 w-3/4 rounded-full" style={{ background: colors.line }} />
					<div className="h-1 w-1/2 rounded-full" style={{ background: colors.line }} />
				</div>
			))}
		</div>
	);
}

/** Mini app preview for a color scheme; "system" splits light and dark
 * diagonally. A hairline edge keeps the black AMOLED one visible on black. */
export function SchemePreview({ scheme, amoled, className }: { scheme: ColorScheme; amoled: boolean; className?: string }) {
	const dark = amoled ? SCHEME_PREVIEW_COLORS.amoled : SCHEME_PREVIEW_COLORS.dark;
	return (
		<div className={cn("relative aspect-[4/3] w-full overflow-hidden rounded-xl", className)}>
			<SchemeMockup colors={scheme === "dark" ? dark : SCHEME_PREVIEW_COLORS.light} />
			{scheme === "system" && (
				<div className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
					<SchemeMockup colors={dark} />
				</div>
			)}
			<span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-[var(--border)]" />
		</div>
	);
}
