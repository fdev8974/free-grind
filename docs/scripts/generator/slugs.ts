import type { Context } from "./context";
import { SHARED_PAGE } from "./context";

const ACRONYMS = new Set([
	"cdn",
	"sms",
	"api",
	"vip",
	"id",
	"url",
	"wip",
	"ai",
]);

const TAG_TITLE_OVERRIDES: Record<string, string> = {
	"right-now": "Right Now",
	"top-picks": "Top Picks",
	storeapirest: "StoreApiRest",
	grindrstore: "GrindrStore",
	gifs: "GIFs",
};

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function lastSegment(pathLike: string): string {
	const parts = pathLike.split("/");
	return parts[parts.length - 1] ?? pathLike;
}

export function tagTitle(tagName: string): string {
	const last = lastSegment(tagName);
	const override = TAG_TITLE_OVERRIDES[last];
	if (override) return override;
	return last
		.split("-")
		.map((w, i) => {
			if (ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
			return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
		})
		.join(" ");
}

export function isSectionSharedPage(pageName: string): boolean {
	return pageName.endsWith(`/${SHARED_PAGE}`);
}

export function pageTitle(pageName: string): string {
	if (pageName === SHARED_PAGE) return "Shared types";
	if (isSectionSharedPage(pageName)) {
		const section = pageName.split("/")[0] ?? pageName;
		return `${tagTitle(section)} — shared types`;
	}
	return tagTitle(pageName);
}

export function withWipSuffix(title: string, wip: boolean): string {
	if (!wip) return title;
	if (/,\s*WIP$/i.test(title)) return title;
	return `${title}, WIP`;
}

export function tagFilePath(outDir: string, pageName: string): string {
	return `${outDir}/${pageName}.md`;
}

export function tagUrl(pageName: string): string {
	return `/grindr-api/${pageName}`;
}

export function schemaDisplay(ctx: Context, name: string): string {
	return ctx.doc.components.schemas[name]?.["x-display-name"] ?? name;
}

export function urlForSchema(ctx: Context, name: string): string {
	return `${tagUrl(ctx.pageForSchema(name))}#${slugify(schemaDisplay(ctx, name))}`;
}

export function urlForParamGroup(ctx: Context, groupName: string): string {
	const tag = ctx.paramGroups.get(groupName)?.["x-render-on-tag"] ?? "";
	return `${tagUrl(tag)}#${slugify(groupName)}`;
}
