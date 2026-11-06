import { z } from "zod";

/**
 * Clean internal model for a Right Now post used throughout the app.
 * Uses descriptive names consistent with the rest of the project.
 */
const rightNowFeedMediaSchema = z.array(z.object({
	type: z.string().optional(),
	data: z.object({
		mediaId: z.number().optional().nullable(),
		thumbnailUrl: z.string().optional().nullable(),
		fullImageUrl: z.string().optional().nullable(),
		shouldBlur: z.boolean().optional().nullable(),
		isNsfw: z.boolean().optional().nullable(),
	}).optional().nullable(),
})).optional().nullable();

/**
 * Clean internal model for a Right Now post used throughout the app.
 * Uses descriptive names consistent with the rest of the project.
 */
export const rightNowFeedItemSchema = z.object({
	kind: z.literal("post"),
	id: z.number().nullable(),
	profileId: z.string(),
	displayName: z.string().nullable(),
	/** Server: mediaHash */
	profileImageMediaHash: z.string().nullable(),
	/** Server: media */
	media: rightNowFeedMediaSchema,
	text: z.string().nullable(),
	hosting: z.boolean(),
	/** Server: posted */
	postedAt: z.number().nullable(),
	/** Server: expiration */
	expiresAt: z.number().nullable(),
	/** Server: distance */
	distanceMeters: z.number().nullable(),
	lat: z.number().nullable(),
	lon: z.number().nullable(),
	onlineUntil: z.number().nullable(),
	/** Server: favorite */
	isFavorite: z.boolean().default(false),
	recentlyChatted: z.boolean().default(false),
	/** Server: mpuScore */
	mpuScore: z.number().nullable().optional(),
	/** Derived from locked_post_v1.type (xtra_post_v1, unlimited_post_v1) */
	premiumType: z.string().nullable().optional(),
	isOnPrep: z.boolean().nullable().optional(),
});

export type RightNowFeedItem = z.infer<typeof rightNowFeedItemSchema>;

/**
 * A discreet post (discreet_right_now_post_v1 / discreet_locked_post_v1):
 * the server leaves out the author (no profileId, name or photo) and sends a
 * few profile fields instead, so it can't be opened or messaged.
 */
export type RightNowDiscreetFeedItem = {
	kind: "discreet";
	id: number;
	media: RightNowFeedItem["media"];
	text: string | null;
	hosting: boolean;
	postedAt: number | null;
	expiresAt: number | null;
	distanceMeters: number | null;
	onlineUntil: number | null;
	premiumType: string | null;
	profileFields: {
		age: number | null;
		/** Centimeters */
		height: number | null;
		/** Grams */
		weight: number | null;
		/** Sexual position id */
		position: number | null;
	};
};

export type RightNowFeedEntry = RightNowFeedItem | RightNowDiscreetFeedItem;

export type RightNowFeedSort = "DISTANCE" | "NEWEST";

/**
 * GET /{v4,v5,v6}/rightnow/feed return the same items; the official client
 * picks the version from the right-now-explicit-images (v6) and
 * right-now-discreet (v5) assignments, and so do we.
 */
export type RightNowFeedVersion = "v4" | "v5" | "v6";

const standardPostDataSchema = z.object({
	id: z.number().optional().nullable(),
	profileId: z.union([z.string(), z.number()]).transform((val) => String(val)),
	displayName: z.string().optional().nullable(),
	mediaHash: z.string().optional().nullable(),
	media: rightNowFeedMediaSchema,
	text: z.string().optional().nullable(),
	hosting: z.boolean().optional().default(false),
	posted: z.number().optional().nullable(),
	expiration: z.number().optional().nullable(),
	distance: z.number().optional().nullable(),
	lat: z.number().optional().nullable(),
	lon: z.number().optional().nullable(),
	favorite: z.boolean().optional().default(false),
	recentlyChatted: z.boolean().optional().default(false),
	onlineUntil: z.number().optional().nullable(),
	mpuScore: z.number().optional().nullable(),
	isOnPrep: z.boolean().optional().nullable(),
	type: z.string().optional().nullable(), // locked kind: xtra_post_v1, unlimited_post_v1
});

const discreetPostDataSchema = z.object({
	id: z.number(),
	media: rightNowFeedMediaSchema,
	text: z.string().optional().nullable(),
	hosting: z.boolean().optional().default(false),
	posted: z.number().optional().nullable(),
	expiration: z.number().optional().nullable(),
	distance: z.number().optional().nullable(),
	onlineUntil: z.number().optional().nullable(),
	type: z.string().optional().nullable(),
	profileFields: z.object({
		age: z.number().nullable().optional(),
		height: z.number().nullable().optional(),
		weight: z.number().nullable().optional(),
		position: z.number().nullable().optional(),
	}).optional().nullable(),
});

/**
 * One item of the feed's `items` array as it arrives from the API. Curated
 * (tutorial) cards and upsell inserts are recognized but not shown.
 */
export const rightNowFeedEntrySchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("right_now_post_v3"), data: standardPostDataSchema }),
	z.object({ type: z.literal("locked_post_v1"), data: standardPostDataSchema }),
	z.object({ type: z.literal("discreet_right_now_post_v1"), data: discreetPostDataSchema }),
	z.object({ type: z.literal("discreet_locked_post_v1"), data: discreetPostDataSchema }),
	z.object({ type: z.literal("curated_post_v1"), data: z.unknown().optional() }),
	z.object({ type: z.literal("upsell_insert_v1"), data: z.unknown().optional() }),
]);

export type RightNowFeedEntryRaw = z.infer<typeof rightNowFeedEntrySchema>;

export type RightNowFeed = {
	items: RightNowFeedEntry[];
	viewerCount: number | null;
};

/**
 * Request schema for creating a post
 */
export const rightNowCreatePostMediaSchema = z.object({
	type: z.enum(["image_v1", "album_v1"]),
	data: z.object({
		id: z.number().int(),
	}),
});

export type RightNowCreatePostMedia = z.infer<typeof rightNowCreatePostMediaSchema>;

export const rightNowShareLocationSchema = z.enum(["DISTANCE_AND_MAP", "DISTANCE_ONLY", "NONE"]);
export type RightNowShareLocation = z.infer<typeof rightNowShareLocationSchema>;

/** Profile fields a discreet post shares in the feed instead of the profile. */
export const RIGHT_NOW_SHARED_FIELDS = ["AGE", "HEIGHT", "WEIGHT", "POSITION"] as const;
export type RightNowSharedField = (typeof RIGHT_NOW_SHARED_FIELDS)[number];

/**
 * locationRadius is a precision value from 0 (most precise) to 100 (least),
 * not meters. Only meaningful with DISTANCE_AND_MAP.
 */
export const RIGHT_NOW_LOCATION_RADIUS_MAX = 100;

/** Rough on-map radius for a locationRadius, as open-grind shows it. */
export function approximateRightNowRadiusMeters(locationRadius: number): number {
	return 100 + 19 * locationRadius;
}

/** POST /v3 and /v4 rightnow/posts. Null values are left out of the request. */
export const rightNowCreatePostRequestSchema = z.object({
	text: z.string().max(140).nullable(),
	shareLocation: rightNowShareLocationSchema,
	lat: z.number().nullable().optional(),
	lon: z.number().nullable().optional(),
	locationRadius: z.number().int().min(0).max(RIGHT_NOW_LOCATION_RADIUS_MAX).nullable().optional(),
	media: z.array(rightNowCreatePostMediaSchema),
	hosting: z.boolean(),
});

export type RightNowCreatePostRequest = z.infer<typeof rightNowCreatePostRequestSchema>;

export const rightNowUploadMediaResponseSchema = z.object({
	mediaId: z.number(),
	url: z.string(),
	thumbnailUrl: z.string(),
});

export type RightNowUploadMediaResponse = z.infer<typeof rightNowUploadMediaResponseSchema>;

export const rightNowCreatePostResponseSchema = z.object({
	post: z.object({
		id: z.number(),
		media: z.array(z.any()).optional().nullable(),
		profileId: z.coerce.string(),
		activeText: z.string().optional().nullable(),
		moderatedText: z.any().optional().nullable(),
		lat: z.number().optional().nullable(),
		lon: z.number().optional().nullable(),
		locationRadius: z.number().optional().nullable(),
		postStatus: z.string().optional().nullable().default("ACTIVE"),
		hosting: z.boolean().optional().default(false),
		posted: z.number().optional().nullable(),
		expiration: z.number().optional().nullable(),
		shareLocation: z.string().optional().nullable().default("NONE"),
		boostUpsellOfferAvailableUntil: z.number().optional().nullable(),
		isDiscreet: z.any().optional().nullable(),
		sharedFields: z.array(z.any()).optional().nullable(),
	}),
});

export type RightNowCreatePostResponse = z.infer<typeof rightNowCreatePostResponseSchema>;

/**
 * PATCH /{v4,v5}/rightnow/posts/{id}: send only the fields being changed.
 * A new locationRadius also moves the post's shown position, so it is only
 * sent when it changed. isDiscreet and sharedFields are applied on v5 only,
 * and isDiscreet can't go back to false once a post is discreet.
 */
export const rightNowUpdatePostRequestSchema = z.object({
	text: z.string().max(140).nullable().optional(),
	hosting: z.boolean().nullable().optional(),
	media: z.array(rightNowCreatePostMediaSchema).nullable().optional(),
	shareLocation: rightNowShareLocationSchema.nullable().optional(),
	locationRadius: z.number().int().min(0).max(RIGHT_NOW_LOCATION_RADIUS_MAX).nullable().optional(),
	isDiscreet: z.boolean().optional(),
	sharedFields: z.array(z.enum(RIGHT_NOW_SHARED_FIELDS)).optional(),
});

export type RightNowUpdatePostRequest = z.infer<typeof rightNowUpdatePostRequestSchema>;

/** GET /v1/rightnow/entitlements/posts */
export const rightNowEntitlementsSchema = z.object({
	type: z.string(),
	/** Remaining posts when type is GRANTED */
	count: z.number().int().optional().nullable(),
});

export type RightNowEntitlements = z.infer<typeof rightNowEntitlementsSchema>;

/** Free posts left: a number, "unlimited", or null for an unknown entitlement type. */
export function freeRightNowPostsLeft(entitlements: RightNowEntitlements): number | "unlimited" | null {
	if (entitlements.type === "UNLIMITED") return "unlimited";
	if (entitlements.type !== "GRANTED") return null;
	return Math.max(0, entitlements.count ?? 0);
}

// --- Right Now requests: asking the author of a discreet post to connect ---

export const rightNowRequestStatusSchema = z.string();
export type RightNowRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED" | (string & {});

/** GET /v1/rightnow/requests/outbox item. recipientProfileId is only set once the request is ACCEPTED. */
export const rightNowSentRequestSchema = z.object({
	recipientProfileId: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
	status: rightNowRequestStatusSchema,
	postId: z.number(),
	createdAt: z.number().nullable().optional(),
	updatedAt: z.number().nullable().optional(),
});
export type RightNowSentRequest = z.infer<typeof rightNowSentRequestSchema>;

/** GET /v1/rightnow/requests/inbox item: someone asking to connect about our post. */
export const rightNowReceivedRequestSchema = z.object({
	id: z.number(),
	profileId: z.union([z.string(), z.number()]).transform(String),
	status: rightNowRequestStatusSchema,
	postId: z.number(),
	createdAt: z.number().nullable().optional(),
	updatedAt: z.number().nullable().optional(),
	displayName: z.string().nullable().optional(),
	primaryMediaHash: z.string().nullable().optional(),
	distance: z.number().nullable().optional(),
	onlineUntil: z.number().nullable().optional(),
	favorite: z.boolean().nullable().optional(),
});
export type RightNowReceivedRequest = z.infer<typeof rightNowReceivedRequestSchema>;
