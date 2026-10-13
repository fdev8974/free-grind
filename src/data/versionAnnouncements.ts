import {
	ArrowUpDown,
	Calendar,
	Camera,
	Database,
	DatabaseBackup,
	Download,
	EyeOff,
	Eye,
	FileArchive,
	Flag,
	FlaskConical,
	Film,
	Ghost,
	History,
	Images,
	Inbox,
	KeyRound,
	Languages,
	LayoutGrid,
	Link2,
	LogIn,
	MapPin,
	Merge,
	MonitorSmartphone,
	NotebookPen,
	Palette,
	Reply,
	Scale,
	ScrollText,
	Search,
	Share2,
	ShieldAlert,
	SlidersHorizontal,
	Smartphone,
	Sticker,
	Terminal,
	Timer,
	Unlock,
	Upload,
	UserPen,
	UserPlus,
	Users,
	UserX,
	Video,
	Wrench,
	Zap,
	type LucideIcon,
} from "lucide-react";

export interface AnnouncementItem {
	icon: LucideIcon;
	title: string;
	description: string;
}

export interface VersionAnnouncement {
	version: string;
	headline: string;
	items: AnnouncementItem[];
}

// Add one entry per release that should show a "what's new" screen on launch.
// Only the entry whose `version` matches the running app version (VITE_APP_VERSION,
// i.e. package.json's "version") is ever shown to users.
export const VERSION_ANNOUNCEMENTS: VersionAnnouncement[] = [
	{
		version: "0.5.3",
		headline: "What's new in Free Grind",
		items: [
			{
				icon: Database,
				title: "Local Chat Database",
				description: "Your conversations are now stored locally and can be searched easily.",
			},
			{
				icon: Terminal,
				title: "Chat Commands",
				description: "Type / in a conversation to trigger quick actions.",
			},
			{
				icon: History,
				title: "Block Activity",
				description: "See who's blocked or unblocked you, and when, from a dedicated Settings page and withing the conversation.",
			},
			{
				icon: Zap,
				title: "Automation Rules",
				description: "Build custom chat automation rules that react to messages, taps, and more.",
			},
			{
				icon: EyeOff,
				title: "Hide Conversations",
				description: "Hide individual chats from your inbox without archiving or deleting them.",
			},
			{
				icon: Reply,
				title: "Reply to Media",
				description: "Reply directly to someone's profile photo from their profile or photos and videos shared in albums.",
			},
            {
				icon: Sticker,
				title: "Send Gifs",
				description: "Search and send GIFs straight from the chat composer.",
			},
			{
				icon: Video,
				title: "Video Calls",
				description: "Start a video call directly from any conversation.",
			},
			{
				icon: Share2,
				title: "Album Share Management",
				description: "Manage who you've shared albums with, and revoke access anytime.",
			},
			{
				icon: ArrowUpDown,
				title: "Reorder Profile Pics",
				description: "Drag and drop to reorder your profile photos.",
			},
			{
				icon: NotebookPen,
				title: "Profile Notes",
				description: "Jot down private notes on any profile, visible only to you.",
			},
			{
				icon: Eye,
				title: "Profile Views",
				description: "Let people know you've viewed their profile — toggle it off anytime, just like read receipts.",
			},
			{
				icon: DatabaseBackup,
				title: "Backup & Restore",
				description: "Export your data for safekeeping, or import it on a new device.",
			},
			{
				icon: LayoutGrid,
				title: "Explore",
				description: "Browse profiles in another location without changing where you're seen.",
			},
			{
				icon: Users,
				title: "Profile Switcher",
				description: "Quickly switch between your saved accounts.",
			},
			{
				icon: MapPin,
				title: "Saved Locations",
				description: "Save your favorite locations for quick access when browsing.",
			},
			{
				icon: MapPin,
				title: "Sexual Health",
				description: "Track PrEP doses, encounters, tests and appointments.",
			},
		],
	},
	{
		version: "0.5.4",
		headline: "What's new in Free Grind",
		items: [
			{
				icon: Ghost,
				title: "Incognito Mode",
				description: "Stop the grid from loading, hide your read receipts, and stop reporting profile views — browse without leaving a trace.",
			},
			{
				icon: UserX,
				title: "Hide Profiles from the Grid",
				description: "Filter individual profiles out of your grid without blocking them — they can still message and see you, and you can unhide them anytime.",
			},
			{
				icon: Merge,
				title: "Merge Conversations",
				description: "Move an archived chat's full message history into a current conversation instead of juggling duplicates.",
			},
			{
				icon: Calendar,
				title: "Sexual Health Calendar Export",
				description: "Export your tracked encounters as an .ics file to import into any calendar app.",
			},
			{
				icon: Images,
				title: "Profile Picture Drawer",
				description: "Manage and reorder your profile pictures from a dedicated drawer in the profile editor.",
			},
			{
				icon: Timer,
				title: "Default Disappearing Media",
				description: "Set photos and albums you share to automatically use a disappearing timer, without picking it every time.",
			},
			{
				icon: Upload,
				title: "Easier Attachment Sharing",
				description: "Drag files straight onto a conversation on desktop to attach them.",
			},
			{
				icon: Unlock,
				title: "Paid Feature Bypass",
				description: "When Grindr asks for a subscription for expiring photos past the daily limit, unsending messages, or album sharing, Free Grind offers to unlock it for you. This violates Grindr's terms of service and can get your account banned — use at your own risk.",
			},
		],
	},
	{
		version: "1.0.0",
		headline: "THE NEXT BIG THING... in purple.",
		items: [
			{
				icon: UserPlus,
				title: "Create Accounts",
				description: "Sign up for a brand-new Grindr account right inside Free Grind with your email and password. Available on Android with the Free Grind reCAPTCHA helper.",
			},
			{
				icon: Languages,
				title: "Chat Translation",
				description: "Translate messages into your app language with Google Translate, Gemini, ChatGPT or Claude. Translate single messages from the context menu or turn on auto-translate per chat.",
			},
			{
				icon: KeyRound,
				title: "Sign In with Google",
				description: "Accounts created with Google can now sign in. On Android, tap \"Sign in with the Google app\" for a one-tap login, or paste a token from the browser extension (made by Open-Grind).",
			},
			{
				icon: Download,
				title: "In-App Updates",
				description: "On Android, new versions are downloaded, verified and installed straight from the app — no more hunting for the latest APK.",
			},
			{
				icon: Film,
				title: "Video Gallery",
				description: "Browse every video you've received in chats and albums in one place, right from the inbox.",
			},
			{
				icon: Smartphone,
				title: "SMS Verification",
				description: "If Grindr asks an account to verify a phone number, you can request and enter the SMS code right on the sign-in screen.",
			},
			{
				icon: Flag,
				title: "Report Profiles",
				description: "Report a profile to Grindr from its profile or the chat menu, with a reason and where it happened.",
			},
			{
				icon: ShieldAlert,
				title: "Ban Details",
				description: "See exactly why and how long an account is restricted, including the ban type, reason and expiry date. Once a temporary ban ends, accept Grindr's agreement in the app to get back in. Device-related refusals now come with a hint on how to fix them.",
			},
			{
				icon: ScrollText,
				title: "Updated Terms",
				description: "When Grindr updates its Terms of Service or Privacy Policy, you can read and accept them in Free Grind instead of getting locked out.",
			},
			{
				icon: SlidersHorizontal,
				title: "Optional Features",
				description: "Turn the Video Gallery, Sexual Health and Locate on or off under Customizability → Optional Features to keep the app as simple as you like.",
			},
			{
				icon: FlaskConical,
				title: "Assignments & Feature Flags",
				description: "Curious what Grindr is testing? Inspect the server-side flags and A/B experiments assigned to your account from the developer section in Settings.",
			},
			{
				icon: Wrench,
				title: "Fixes & Polish",
				description: "Smoother swipe to reply, more reliable connection handling, hidden profiles staying in place when sorting by distance, no more distracting scrollbars on mobile, logging out now removes the account from the switcher, and a redesigned sign-in, restore and onboarding experience.",
			},
		],
	},
];
