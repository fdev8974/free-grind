import z from "zod";
import { fetchExternal } from "./externalFetch";

/** The official app's gaymoji manifest; each image sits at `<manifest>/<id>`. */
export const GAYMOJI_MANIFEST_URL = "https://cdns.grindr.com/grindr/chat/gaymoji";

const IMAGE_HASH_PREFIX = "gaymoji/";

const gaymojiManifestSchema = z.object({
	gaymoji: z.array(z.unknown()).transform((entries) =>
		entries.flatMap((entry) => {
			const parsed = z
				.object({ name: z.string().min(1), id: z.string().regex(/^[\w,.-]+\.png$/), category: z.string().min(1) })
				.safeParse(entry);
			return parsed.success ? [parsed.data] : [];
		}),
	),
	category: z.array(z.unknown()).transform((entries) =>
		entries.flatMap((entry) => {
			const parsed = z.object({ name: z.string().min(1) }).safeParse(entry);
			return parsed.success ? [parsed.data] : [];
		}),
	),
});

export interface GaymojiItem {
	id: string;
	label: string;
	imageUrl: string;
	/** What a `Gaymoji` message carries in `body.imageHash`. */
	imageHash: string;
}

export interface GaymojiSection {
	key: string;
	items: GaymojiItem[];
}

const sortPrefix = /^(?:(?:\d+|[a-z]|man_[a-z])_)+/;

function gaymojiLabel(name: string): string {
	const spaced = (text: string) => text.replace(/_/g, " ").replace(/\s+/g, " ").trim();
	const label = spaced(name.replace(sortPrefix, "")).replace(/[\s,.]+$/, "");
	return label === "" ? spaced(name) : label;
}

function gaymojiItem({ id, name }: { id: string; name: string }): GaymojiItem {
	return {
		id,
		label: gaymojiLabel(name),
		imageUrl: `${GAYMOJI_MANIFEST_URL}/${encodeURIComponent(id)}`,
		imageHash: `${IMAGE_HASH_PREFIX}${id}`,
	};
}

const FEATURED_CATEGORY = "featured";

/** "featured" mostly repeats other categories; only these originals live nowhere else. */
const FEATURED_ORIGINAL_IDS = new Set([
	"Pinky_up.png",
	"2_6_Three_girls_sitting_at_table.png",
	"2_0_rainingMen2tiny.png",
	"1_6_2_WGbed.png",
	"1_6_2_WGgaysRule.png",
	"1_6_2_WGgrace.png",
]);

function toSections(manifest: z.infer<typeof gaymojiManifestSchema>): GaymojiSection[] {
	const groups = new Map<string, GaymojiItem[]>(manifest.category.map(({ name }) => [name, []]));
	for (const entry of manifest.gaymoji) {
		const items = groups.get(entry.category);
		if (items) items.push(gaymojiItem(entry));
		else groups.set(entry.category, [gaymojiItem(entry)]);
	}
	const featured = groups.get(FEATURED_CATEGORY)?.filter(({ id }) => FEATURED_ORIGINAL_IDS.has(id)) ?? [];
	groups.delete(FEATURED_CATEGORY);
	groups.set(FEATURED_CATEGORY, featured);

	return [...groups].filter(([, items]) => items.length > 0).map(([key, items]) => ({ key, items }));
}

let sectionsPromise: Promise<GaymojiSection[]> | null = null;

/** Fetched once per session, through Rust like the official app; a failure is retried next call. */
export function getGaymojiSections(): Promise<GaymojiSection[]> {
	sectionsPromise ??= (async () => {
		const { status, body } = await fetchExternal(GAYMOJI_MANIFEST_URL);
		if (status < 200 || status >= 300) throw new Error(`Gaymoji ${status}`);
		return toSections(gaymojiManifestSchema.parse(JSON.parse(new TextDecoder().decode(body))));
	})().catch((error: unknown) => {
		sectionsPromise = null;
		throw error;
	});
	return sectionsPromise;
}
