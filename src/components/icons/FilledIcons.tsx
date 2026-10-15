import { useId, type ReactNode, type SVGProps } from "react";

// Solid counterparts of the lucide icons used in the chat composer's action
// row. Inner details are cut out through a mask instead of being drawn in a
// background color, so they stay transparent on any surface.

type IconProps = SVGProps<SVGSVGElement>;

const useMaskId = () => `fi${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

function FilledSvg({ children, ...props }: IconProps & { children: ReactNode }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			width={24}
			height={24}
			fill="currentColor"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			{...props}
		>
			{children}
		</svg>
	);
}

/** Mask that keeps everything except the black `cutouts`. */
function CutoutMask({ id, children }: { id: string; children: ReactNode }) {
	return (
		<mask id={id} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
			<rect x="-2" y="-2" width="28" height="28" fill="white" stroke="none" />
			<g fill="black" stroke="black">
				{children}
			</g>
		</mask>
	);
}

export function StickerFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M15 3v5a1 1 0 0 0 1 1h5" fill="none" />
				<circle cx="8.5" cy="13" r="1.1" stroke="none" />
				<circle cx="15.5" cy="13" r="1.1" stroke="none" />
				<path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1" fill="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"
			/>
		</FilledSvg>
	);
}

export function ImagePlusFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="19" cy="5" r="5.5" stroke="none" />
				<circle cx="9" cy="9" r="2" stroke="none" />
				<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" fill="none" />
			</CutoutMask>
			<rect mask={`url(#${id})`} x="3" y="3" width="18" height="18" rx="2" />
			<path d="M16 5h6M19 2v6" fill="none" />
		</FilledSvg>
	);
}

export function SquareStackFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg stroke="none" {...props}>
			<CutoutMask id={`${id}a`}>
				<rect x="5.5" y="5.5" width="13" height="13" rx="4.5" />
			</CutoutMask>
			<CutoutMask id={`${id}b`}>
				<rect x="11.5" y="11.5" width="13" height="13" rx="4.5" />
			</CutoutMask>
			<rect mask={`url(#${id}a)`} x="1" y="1" width="10" height="10" rx="3" />
			<rect mask={`url(#${id}b)`} x="7" y="7" width="10" height="10" rx="3" />
			<rect x="13" y="13" width="10" height="10" rx="3" />
		</FilledSvg>
	);
}

export function MapPinFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="12" cy="10" r="2.75" stroke="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
			/>
		</FilledSvg>
	);
}

export function MessageSquareQuoteFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="8.5" cy="9.5" r="1.75" stroke="none" />
				<path d="M10.25 9.5v.75a4 4 0 0 1-2.5 3.7" fill="none" strokeWidth={1.5} />
				<circle cx="14.5" cy="9.5" r="1.75" stroke="none" />
				<path d="M16.25 9.5v.75a4 4 0 0 1-2.5 3.7" fill="none" strokeWidth={1.5} />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
			/>
		</FilledSvg>
	);
}
