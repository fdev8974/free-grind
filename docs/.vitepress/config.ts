import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";
import { loadContext } from "../scripts/generator/context";
import type { StaticSidebarPages } from "../scripts/generator/sidebar";
import { buildSidebar } from "../scripts/generator/sidebar";
import { icons } from "./icons";

// GitHub Pages serves project sites under /<repo>/; the deploy workflow passes
// the actual base path (empty with a custom domain) via DOCS_BASE.
const base = `${process.env.DOCS_BASE ?? ""}/`;

// Grindr API reference is generated from lib/openapi.json (taken from Open Grind)
// by `bun run generate`; these handwritten pages are spliced around it.
const staticPages: StaticSidebarPages = {
	before: [
		{ text: "Getting started", link: "/grindr-api/getting-started" },
		{ text: "Security headers", link: "/grindr-api/security-headers" },
		{ text: "API Authorization", link: "/grindr-api/api-authorization" },
	],
	after: [
		{ text: "Rate limits", link: "/grindr-api/rate-limits" },
		{
			text: "WebSocket",
			link: "/grindr-api/websocket/",
			collapsed: true,
			items: [
				{ text: "Events", link: "/grindr-api/websocket/events" },
				{
					text: "Notification Event",
					link: "/grindr-api/websocket/notification-event",
				},
				{ text: "Commands", link: "/grindr-api/websocket/commands" },
			],
		},
		{ text: "Push Notifications", link: "/grindr-api/push-notifications" },
		{ text: "Appendix", link: "/grindr-api/appendix" },
		{ text: "Shared types", link: "/grindr-api/shared-types" },
	],
};

const grindrApiReference = buildSidebar(
	loadContext(fileURLToPath(new URL("../lib/openapi.json", import.meta.url))),
	staticPages,
);

// https://vitepress.dev/reference/site-config
export default defineConfig({
	srcDir: "content",
	base,

	vite: {
		plugins: [icons()],
		esbuild: { legalComments: "inline" },
	},

	cleanUrls: true,

	rewrites: { "generated/:path*": ":path*" },

	title: "Free Grind",
	description: "Free Grind project documentation and Grindr API reference",
	head: [
		[
			"link",
			{
				rel: "icon",
				type: "image/png",
				href: `${base}favicon-96x96.png`,
				sizes: "96x96",
			},
		],
		["link", { rel: "shortcut icon", href: `${base}favicon.ico` }],
		[
			"link",
			{
				rel: "apple-touch-icon",
				sizes: "180x180",
				href: `${base}apple-touch-icon.png`,
			},
		],
	],
	themeConfig: {
		// https://vitepress.dev/reference/default-theme-config
		logo: "/logo.webp",

		nav: [
			{ text: "Home", link: "/" },
			{ text: "FAQ", link: "/guide/faq" },
			{ text: "Guides", link: "/guide/download" },
			{ text: "Grindr API", link: "/grindr-api" },
			{ component: "NavVersion" },
		],

		search: {
			provider: "local",
		},

		sidebar: {
			"/guide/": [
				{
					text: "User guides",
					items: [
						{ text: "Download", link: "/guide/download" },
						{ text: "Sign in", link: "/guide/login" },
						{ text: "Notifications", link: "/guide/notifications" },
						{ text: "Video codecs on Linux", link: "/guide/codecs" },
						{
							text: "Blocking and hiding",
							link: "/guide/blocking-and-hiding-profiles",
						},
						{ text: "FAQ", link: "/guide/faq" },
					],
				},
				{
					text: "Features",
					items: [
						{ text: "Unlocked grid", link: "/guide/features/unlocked-grid" },
						{
							text: "Location spoofing",
							link: "/guide/features/location-spoofing",
						},
						{ text: "Views and taps", link: "/guide/features/interest" },
						{ text: "Local chat history", link: "/guide/features/chat-history" },
						{
							text: "Paid feature bypass",
							link: "/guide/features/paid-features",
						},
						{ text: "Chat translation", link: "/guide/features/translation" },
						{ text: "Automation", link: "/guide/features/automation" },
						{ text: "Privacy", link: "/guide/features/privacy" },
						{ text: "Sexual health", link: "/guide/features/sexual-health" },
						{
							text: "Multiple accounts",
							link: "/guide/features/multiple-accounts",
						},
						{ text: "No ads", link: "/guide/features/no-ads" },
					],
				},
			],
			"/grindr-api/": [
				{
					text: "Grindr API",
					link: "/grindr-api/",
					items: grindrApiReference,
				},
			],
		},

		socialLinks: [
			{ icon: "github", link: "https://github.com/fdev8974/free-grind" },
			{ icon: "discord", link: "https://discord.gg/cJqTaWPMFF" },
			{
				icon: {
					svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
				},
				link: "https://t.me/freegrind",
			},
		],

		footer: {
			message: "Free Grind is not affiliated with Grindr in any way.",
			copyright:
				'Licensed under the <a href="https://github.com/fdev8974/free-grind/blob/main/LICENSE">MIT License</a>.',
		},
	},
});
