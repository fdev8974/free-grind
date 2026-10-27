import {
	ArrowUpDown,
	BellRing,
	Calendar,
	Camera,
	Columns4,
	Database,
	DatabaseBackup,
	Download,
	EyeOff,
	Eye,
	FileArchive,
	Flag,
	FlaskConical,
	FolderHeart,
	Flame,
	Film,
	Ghost,
	Hand,
	Heart,
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
	Moon,
	NotebookPen,
	PanelBottom,
	Palette,
	Reply,
	Scale,
	ScrollText,
	Search,
	Share,
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
	UserSearch,
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
	/** Optional line under the fixed "What's new" title, e.g. a motto for the release. */
	tagline?: string;
	items: AnnouncementItem[];
}

// Add one entry per release that should show a "what's new" screen on launch.
// Only the entry whose `version` matches the running app version (VITE_APP_VERSION,
// i.e. package.json's "version") is ever shown to users.
export const VERSION_ANNOUNCEMENTS: VersionAnnouncement[] = [
	{
		version: "0.5.3",
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
		tagline: "THE NEXT BIG THING... in purple.",
		items: [
			{
				icon: UserPlus,
				title: "Create Accounts",
				description: "Sign up for a brand-new Grindr account right inside Free Grind with your email and password. Available on Android.",
			},
			{
				icon: Languages,
				title: "Chat Translation",
				description: "Translate messages into your app language with Google Translate, Gemini, ChatGPT or Claude. Translate single messages from the context menu or turn on auto-translate per chat.",
			},
			{
				icon: Download,
				title: "In-App Updates",
				description: "On Android, new versions are downloaded, verified and installed straight from the app — no more hunting for the latest APK.",
			},
			{
				icon: KeyRound,
				title: "Sign In with Google",
				description: "Accounts created with Google can now sign in right in Free Grind: with one tap through the Google app on Android, or in a Google sign-in window everywhere else.",
			},
			{
				icon: LogIn,
				title: "Sign In with Facebook",
				description: "Accounts linked to Facebook can now sign in on Android and desktop.",
			},
			{
				icon: BellRing,
				title: "Better Notifications",
				description: "Every message now shows up in the notification, grouped per chat, with buttons to jump straight into the chat or the profile. On Android, you can also reply right from the notification.",
			},
			{
				icon: Share,
				title: "Share to Free Grind",
				description: "On Android, share photos from any app straight to Free Grind and send them to one or several chats at once, with your most recent conversations at the top.",
			},
			{
				icon: FolderHeart,
				title: "Collections",
				description: "Group photos or videos from your chat drawer into collections and send them in one go — each item goes out as its own message, in the order you picked. Collections are stored on this device; manage them under Settings → Albums & Collections.",
			},
			{
				icon: Film,
				title: "Video Gallery",
				description: "Browse every video you've received in chats and albums in one place, right from the inbox.",
			},
			{
				icon: Hand,
				title: "Double Tap to Tap",
				description: "Double tap a profile in the grid to send a tap without opening it — complete with a little burst of fire. Pick which tap it sends, or turn it off, under Settings → Behavior.",
			},
			{
				icon: UserSearch,
				title: "Search the Grid by Name",
				description: "Tap the new search button on the grid to filter profiles by their display name.",
			},
			{
				icon: Images,
				title: "Redesigned Media Drawer",
				description: "A completely reworked drawer for photos, videos, albums and collections: switch between views, press and hold to preview before sending, edit photos, and create, edit or delete albums and collections without leaving the chat.",
			},
			{
				icon: MapPin,
				title: "Share Saved Locations",
				description: "Send your home or any saved location from the chat drawer in a single tap.",
			},
			{
				icon: PanelBottom,
				title: "Redesigned Navigation",
				description: "Settings is now its own tab in the navigation bar, showing your profile picture, with your account and the account switcher right at the top.",
			},
			{
				icon: Users,
				title: "Quick Account Switch",
				description: "Long press the Settings tab in the navigation bar to switch accounts instantly.",
			},
			{
				icon: Moon,
				title: "Pure Black Mode",
				description: "Use true black backgrounds in dark mode to save battery on OLED screens.",
			},
			{
				icon: Columns4,
				title: "4 Column Grid",
				description: "Fit even more profiles on screen with the new 4 column grid layout under Customizability.",
			},
			{
				icon: ShieldAlert,
				title: "Ban Details",
				description: "See exactly why and how long an account is restricted, including the ban type, reason and expiry date. Once a temporary ban ends, accept Grindr's agreement in the app to get back in. Device-related refusals now come with a hint on how to fix them.",
			},
			{
				icon: Smartphone,
				title: "SMS Verification",
				description: "If Grindr asks an account to verify a phone number, you can request and enter the SMS code right on the sign-in screen.",
			},
			{
				icon: ScrollText,
				title: "Updated Terms",
				description: "When Grindr updates its Terms of Service or Privacy Policy, you can read and accept them in Free Grind instead of getting locked out.",
			},
			{
				icon: Flag,
				title: "Report Profiles",
				description: "Report a profile to Grindr from its profile or the chat menu, with a reason and where it happened.",
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
				icon: DatabaseBackup,
				title: "Backup & Restore Fixed",
				description: "Backing up and restoring your data works reliably again, now with a progress bar so you can see how far along it is.",
			},
			{
				icon: Wrench,
				title: "Fixes & Polish",
				description: "A fresh glassy look with smoother animations, a redesigned sign-in and onboarding, Serbian (Cyrillic) translation, and lots of smaller fixes throughout.",
			},
			{
				icon: Heart,
				title: "Thank You, Open Grind",
				description: "Free Grind started as a fork of Open Grind and still builds on their work, like their Grindr API documentation.",
			},
		],
	},
];
