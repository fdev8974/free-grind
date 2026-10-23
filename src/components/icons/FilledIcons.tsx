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

const MAP_PIN_PATH =
	"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0";

export function MapPinFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="12" cy="10" r="2.75" stroke="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d={MAP_PIN_PATH}
			/>
		</FilledSvg>
	);
}

// Solid folded map: three panels with clear gaps between them (drawing the
// outline path filled plus cut-out fold lines looked blobby at small sizes).
export function MapFilled(props: IconProps) {
	return (
		<FilledSvg strokeWidth={1} {...props}>
			<path d="M3 6.5 8 4.25v14.5L3 21Z" />
			<path d="M10 4.25 14 6.25v14.5l-4-2Z" />
			<path d="M16 6.25 21 4v14.5l-5 2.25Z" />
		</FilledSvg>
	);
}

export function MapPinOffFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="12" cy="10" r="2.75" stroke="none" />
				<path d="m2 2 20 20" fill="none" strokeWidth={5} />
			</CutoutMask>
			<path mask={`url(#${id})`} d={MAP_PIN_PATH} />
			<path d="m2 2 20 20" fill="none" />
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

export function UserFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			{/* lucide's body path is open at the bottom, which leaves a notch when filled. */}
			<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2z" />
			<circle cx="12" cy="7" r="4" />
		</FilledSvg>
	);
}

export function LayoutGridFilled(props: IconProps) {
	return (
		<FilledSvg stroke="none" {...props}>
			<rect x="2" y="2" width="8.5" height="8.5" rx="2.5" />
			<rect x="13.5" y="2" width="8.5" height="8.5" rx="2.5" />
			<rect x="2" y="13.5" width="8.5" height="8.5" rx="2.5" />
			<rect x="13.5" y="13.5" width="8.5" height="8.5" rx="2.5" />
		</FilledSvg>
	);
}

export function MailFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" fill="none" />
			</CutoutMask>
			<rect mask={`url(#${id})`} x="2" y="4" width="20" height="16" rx="2" />
		</FilledSvg>
	);
}

export function HomeFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<rect x="10" y="13" width="4" height="10" rx="1" stroke="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v10.25a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75z"
			/>
		</FilledSvg>
	);
}

export function UserSearchFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="17" cy="17" r="5.25" stroke="none" />
			</CutoutMask>
			<g mask={`url(#${id})`}>
				<circle cx="10" cy="7" r="4" />
				<path d="M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2z" />
			</g>
			<circle cx="17" cy="17" r="3" />
			<path d="m21 21-1.9-1.9" fill="none" />
		</FilledSvg>
	);
}

const EYE_PATH =
	"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0";

export function EyeFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="12" cy="12" r="4.25" stroke="none" />
			</CutoutMask>
			<path mask={`url(#${id})`} d={EYE_PATH} />
			<circle cx="12" cy="12" r="2.5" stroke="none" />
		</FilledSvg>
	);
}

export function EyeOffFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="12" cy="12" r="4.25" stroke="none" />
				<path d="m2 2 20 20" fill="none" strokeWidth={5} />
			</CutoutMask>
			<path mask={`url(#${id})`} d={EYE_PATH} />
			<CutoutMask id={`${id}p`}>
				<path d="m2 2 20 20" fill="none" strokeWidth={5} />
			</CutoutMask>
			<circle mask={`url(#${id}p)`} cx="12" cy="12" r="2.5" stroke="none" />
			<path d="m2 2 20 20" fill="none" />
		</FilledSvg>
	);
}

const MESSAGE_CIRCLE_PATH =
	"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719z";

export function MessageCircleXFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m15 9-6 6M9 9l6 6" fill="none" />
			</CutoutMask>
			<path mask={`url(#${id})`} d={MESSAGE_CIRCLE_PATH} />
		</FilledSvg>
	);
}

export function VideoOffFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m2 2 20 20" fill="none" strokeWidth={5} />
			</CutoutMask>
			<g mask={`url(#${id})`}>
				<rect x="2" y="6" width="14" height="12" rx="2" />
				<path d="m16 10.5 5.248-3.062A.5.5 0 0 1 22 7.87v8.26a.5.5 0 0 1-.777.416L16 13.5z" />
			</g>
			<path d="m2 2 20 20" fill="none" />
		</FilledSvg>
	);
}

export function PencilLineFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m15 5 4 4" fill="none" strokeWidth={1.5} />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
			/>
			<path d="M13 21h8" fill="none" />
		</FilledSvg>
	);
}

export function ShieldCheckFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m9 12 2 2 4-4" fill="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
			/>
		</FilledSvg>
	);
}

export function ImagesFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16" fill="none" />
				<circle cx="13" cy="7" r="1.5" stroke="none" />
			</CutoutMask>
			<rect mask={`url(#${id})`} x="8" y="2" width="14" height="14" rx="2" />
			<path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" fill="none" />
		</FilledSvg>
	);
}

export function BananaFilled(props: IconProps) {
	const id = useMaskId();
	const peel = "M4 13c3.5-2 8-2 10 2a5.5 5.5 0 0 1 8 5";
	return (
		<FilledSvg {...props}>
			{/* The peel line sits on the fruit, separated from it by a small gap. */}
			<CutoutMask id={id}>
				<path d={peel} fill="none" strokeWidth={4.5} />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M5.15 17.89c5.52-1.52 8.65-6.89 7-12C11.55 4 11.5 2 13 2c3.22 0 5 5.5 5 8 0 6.5-4.2 12-10.49 12C5.11 22 2 22 2 20c0-1.5 1.14-1.55 3.15-2.11Z"
			/>
			<path d={peel} fill="none" />
		</FilledSvg>
	);
}

export function MicFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<rect x="9" y="2" width="6" height="13" rx="3" />
			<path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" fill="none" />
		</FilledSvg>
	);
}

export function FlameFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4z" />
		</FilledSvg>
	);
}

export function SendFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m21.854 2.147-10.94 10.939" fill="none" strokeWidth={1.75} />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"
			/>
		</FilledSvg>
	);
}

export function SendHorizontalFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M6 12h16" fill="none" strokeWidth={1.75} />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"
			/>
		</FilledSvg>
	);
}

export function LockFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<rect x="3" y="11" width="18" height="11" rx="2" />
			<path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" />
		</FilledSvg>
	);
}

export function BellOffFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m2 2 20 20" fill="none" strokeWidth={5} />
			</CutoutMask>
			<g mask={`url(#${id})`}>
				<path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326z" />
				<path d="M10.268 21a2 2 0 0 0 3.464 0" fill="none" />
			</g>
			<path d="m2 2 20 20" fill="none" />
		</FilledSvg>
	);
}

export function Trash2Filled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M10 11v6M14 11v6" fill="none" />
			</CutoutMask>
			<path mask={`url(#${id})`} d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6z" />
			<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" fill="none" />
		</FilledSvg>
	);
}

export function ClockFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M12 6v6l4 2" fill="none" />
			</CutoutMask>
			<circle mask={`url(#${id})`} cx="12" cy="12" r="10" />
		</FilledSvg>
	);
}

export function InfoFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M12 16v-4" fill="none" />
				<circle cx="12" cy="8" r="1.25" stroke="none" />
			</CutoutMask>
			<circle mask={`url(#${id})`} cx="12" cy="12" r="10" />
		</FilledSvg>
	);
}

export function PaletteFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="13.5" cy="6.5" r="1.4" stroke="none" />
				<circle cx="17.5" cy="10.5" r="1.4" stroke="none" />
				<circle cx="6.5" cy="12.5" r="1.4" stroke="none" />
				<circle cx="8.5" cy="7.5" r="1.4" stroke="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"
			/>
		</FilledSvg>
	);
}

export function MegaphoneFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M8 6v8" fill="none" strokeWidth={1.5} />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
			/>
			<path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14z" />
		</FilledSvg>
	);
}

function UserBase() {
	return (
		<>
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2z" />
			<circle cx="9" cy="7" r="4" />
		</>
	);
}

export function UserPlusFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<UserBase />
			<path d="M19 8v6M22 11h-6" fill="none" />
		</FilledSvg>
	);
}

export function UserXFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<UserBase />
			<path d="m17 8 5 5M22 8l-5 5" fill="none" />
		</FilledSvg>
	);
}

export function ClipboardListFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<rect x="6.5" y="0.5" width="11" height="7" rx="2" stroke="none" />
				<path d="M12 11h4M12 16h4" fill="none" />
				<circle cx="8" cy="11" r="1.1" stroke="none" />
				<circle cx="8" cy="16" r="1.1" stroke="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2z"
			/>
			<rect x="8" y="2" width="8" height="4" rx="1" />
		</FilledSvg>
	);
}

export function FlaskConicalFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M6.453 15h11.094" fill="none" strokeWidth={1.5} />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2z"
			/>
			<path d="M8.5 2h7" fill="none" />
		</FilledSvg>
	);
}

export function FileUpFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M14 2v5a1 1 0 0 0 1 1h5M12 12v6m3-3-3-3-3 3" fill="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
			/>
		</FilledSvg>
	);
}

export function HeartPulseFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" fill="none" strokeWidth={1.75} />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5z"
			/>
		</FilledSvg>
	);
}

export function BotFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M15 13v2M9 13v2" fill="none" />
			</CutoutMask>
			<rect mask={`url(#${id})`} x="4" y="8" width="16" height="12" rx="2" />
			<path d="M12 8V4H8M2 14h2M20 14h2" fill="none" />
		</FilledSvg>
	);
}

export function TagFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="7.5" cy="7.5" r="1.5" stroke="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
			/>
		</FilledSvg>
	);
}

export function BugFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M12 20v-9" fill="none" strokeWidth={1.5} />
			</CutoutMask>
			<path mask={`url(#${id})`} d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
			<path d="M9 7V6a3 3 0 1 1 6 0v1z" />
			<path
				d="M14.12 3.88 16 2M21 21a4 4 0 0 0-3.81-4M21 5a4 4 0 0 1-3.55 3.97M22 13h-4M3 21a4 4 0 0 1 3.81-4M3 5a4 4 0 0 0 3.55 3.97M6 13H2m6-11 1.88 1.88"
				fill="none"
			/>
		</FilledSvg>
	);
}

export function ArchiveRestoreFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				{/* Gap below the lid, and the restore arrow. */}
				<path d="M1 9.25h22" fill="none" strokeWidth={1.5} />
				<path d="m9 15 3-3 3 3M12 12v10" fill="none" />
			</CutoutMask>
			<rect x="2" y="3" width="20" height="5" rx="1" />
			<path mask={`url(#${id})`} d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
		</FilledSvg>
	);
}

export function CameraPlusFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="12" cy="13" r="4.25" stroke="none" />
				{/* Room for the plus badge in the top-right corner. */}
				<circle cx="19" cy="5" r="5.5" stroke="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"
			/>
			<circle cx="12" cy="13" r="2.5" stroke="none" />
			<path d="M16 5h6M19 2v6" fill="none" />
		</FilledSvg>
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

export function LocateFixedFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M2 12h3M19 12h3M12 2v3M12 19v3" fill="none" />
			<circle cx="12" cy="12" r="7" fill="none" />
			<circle cx="12" cy="12" r="3.5" stroke="none" />
		</FilledSvg>
	);
}

export function StickyNoteFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M15 3v5a1 1 0 0 0 1 1h5" fill="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"
			/>
		</FilledSvg>
	);
}

export function CameraFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="12" cy="13" r="4.25" stroke="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"
			/>
			<circle cx="12" cy="13" r="2.5" stroke="none" />
		</FilledSvg>
	);
}

export function PillFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m8.5 8.5 7 7" fill="none" strokeWidth={1.75} />
			</CutoutMask>
			<path mask={`url(#${id})`} d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
		</FilledSvg>
	);
}

/** Companion to ImagesFilled: same stacked cards, with a play mark instead of the landscape. */
export function VideosFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M13 6.4v5.2a.55.55 0 0 0 .83.47l4.3-2.6a.55.55 0 0 0 0-.94l-4.3-2.6A.55.55 0 0 0 13 6.4z" stroke="none" />
			</CutoutMask>
			<rect mask={`url(#${id})`} x="8" y="2" width="14" height="14" rx="2" />
			<path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" fill="none" />
		</FilledSvg>
	);
}

// ── Settings-row icons ──────────────────────────────────────────────────────

export function BellFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326z" />
			<path d="M10.268 21a2 2 0 0 0 3.464 0" fill="none" />
		</FilledSvg>
	);
}

export function SunFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" fill="none" />
		</FilledSvg>
	);
}

export function MoonFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401z" />
		</FilledSvg>
	);
}

const SHIELD_PATH =
	"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

export function ShieldFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d={SHIELD_PATH} />
		</FilledSvg>
	);
}

export function ShieldAlertFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M12 8v3.5" fill="none" />
				<circle cx="12" cy="15.5" r="1.25" stroke="none" />
			</CutoutMask>
			<path mask={`url(#${id})`} d={SHIELD_PATH} />
		</FilledSvg>
	);
}

export function HeartFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5z" />
		</FilledSvg>
	);
}

export function ZapFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
		</FilledSvg>
	);
}

export function SparklesFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
			<path d="M20 2v4M22 4h-4" fill="none" />
			<circle cx="4" cy="20" r="2" />
		</FilledSvg>
	);
}

export function GhostFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="9" cy="10" r="1.4" stroke="none" />
				<circle cx="15" cy="10" r="1.4" stroke="none" />
			</CutoutMask>
			<path mask={`url(#${id})`} d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
		</FilledSvg>
	);
}

export function PuzzleFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />
		</FilledSvg>
	);
}

export function MessageCircleFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719z" />
		</FilledSvg>
	);
}

export function SmartphoneFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="12" cy="18" r="1.25" stroke="none" />
			</CutoutMask>
			<rect mask={`url(#${id})`} width="14" height="20" x="5" y="2" rx="2" ry="2" />
		</FilledSvg>
	);
}

export function MonitorFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<rect width="20" height="14" x="2" y="3" rx="2" />
			<path d="M8 21h8M12 17v4" fill="none" />
		</FilledSvg>
	);
}

export function TriangleAlertFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M12 9v4" fill="none" />
				<circle cx="12" cy="17" r="1.25" stroke="none" />
			</CutoutMask>
			<path mask={`url(#${id})`} d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z" />
		</FilledSvg>
	);
}

export function KeyRoundFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<circle cx="16.5" cy="7.5" r="1.5" stroke="none" />
			</CutoutMask>
			<path
				mask={`url(#${id})`}
				d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
			/>
		</FilledSvg>
	);
}

export function TimerFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="m12 14 3-3" fill="none" />
			</CutoutMask>
			<circle mask={`url(#${id})`} cx="12" cy="14" r="8" />
			<path d="M10 2h4" fill="none" />
		</FilledSvg>
	);
}

export function CalendarDaysFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M3 10h18" fill="none" strokeWidth={1.5} />
				{[8, 12, 16].flatMap((x) => [14, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" stroke="none" />))}
			</CutoutMask>
			<rect mask={`url(#${id})`} width="18" height="18" x="3" y="4" rx="2" />
			<path d="M8 2v4M16 2v4" fill="none" />
		</FilledSvg>
	);
}

export function CalculatorFilled(props: IconProps) {
	const id = useMaskId();
	return (
		<FilledSvg {...props}>
			<CutoutMask id={id}>
				<path d="M8 6h8M16 14v4" fill="none" />
				{[
					[8, 10],
					[12, 10],
					[16, 10],
					[8, 14],
					[12, 14],
					[8, 18],
					[12, 18],
				].map(([x, y]) => (
					<circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" stroke="none" />
				))}
			</CutoutMask>
			<rect mask={`url(#${id})`} width="16" height="20" x="4" y="2" rx="2" />
		</FilledSvg>
	);
}

export function CloudSunFilled(props: IconProps) {
	return (
		<FilledSvg {...props}>
			<path d="M12 2v2m-7.07.93 1.41 1.41M20 12h2m-2.93-7.07-1.41 1.41M15.947 12.65a4 4 0 0 0-5.925-4.128" fill="none" />
			<path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
		</FilledSvg>
	);
}
