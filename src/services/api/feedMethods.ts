import type { RestFetcher } from "../../types/chat-service";
import { appLog } from "../../utils/logger";
import { assertSuccess, parseJsonSafe } from "../apiHelpers";
import { awaitEntitlementGrant } from "../entitlementBypass";
import { coarsenGeohash } from "../../utils/geohash";
import { getIncognitoMode } from "../../utils/privacy";
import {
	type RightNowCreatePostRequest,
	type RightNowCreatePostResponse,
	type RightNowFeed,
	type RightNowFeedEntry,
	type RightNowFeedSort,
	type RightNowFeedVersion,
	type RightNowUploadMediaResponse,
	type RightNowUpdatePostRequest,
	type RightNowEntitlements,
	type RightNowReceivedRequest,
	type RightNowSentRequest,
	type RightNowSharedField,
	freeRightNowPostsLeft,
	rightNowReceivedRequestSchema,
	rightNowSentRequestSchema,
	rightNowCreatePostRequestSchema,
	rightNowCreatePostResponseSchema,
	rightNowFeedEntrySchema,
	rightNowUploadMediaResponseSchema,
	rightNowUpdatePostRequestSchema,
	rightNowEntitlementsSchema,
} from "../../types/right-now";

/** No free Right Now posts are left in this area (count 0, or the post came back AWAITING_PAYMENT). */
export class NoFreeRightNowPostsError extends Error {
	constructor() {
		super("No free Right Now posts are left in this area");
		this.name = "NoFreeRightNowPostsError";
	}
}

/** POST /v3/rightnow/posts answers 400 urn:gr:err:client_action while a post is already running. */
export class RightNowPostAlreadyRunningError extends Error {
	constructor() {
		super("A Right Now post is already running");
		this.name = "RightNowPostAlreadyRunningError";
	}
}

/** Editing or hiding a post whose session has already ended. */
export class RightNowSessionEndedError extends Error {
	constructor() {
		super("The Right Now session has ended");
		this.name = "RightNowSessionEndedError";
	}
}

/**
 * A discreet post was created (hidden) but couldn't be made discreet or
 * shown. It counts as the running session and can be fixed by editing it.
 */
export class RightNowDiscreetSetupError extends Error {
	readonly created: RightNowCreatePostResponse;
	/** What failed while making it discreet or showing it. */
	readonly reason: unknown;
	constructor(created: RightNowCreatePostResponse, cause: unknown) {
		super("The Right Now post was created hidden but couldn't be made discreet");
		this.name = "RightNowDiscreetSetupError";
		this.created = created;
		this.reason = cause;
	}
}

const SESSION_ENDED_URNS = new Set(["urn:gr:err:client_action", "urn:gr:err:resource_not_found"]);

function errorUrn(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") return null;
	const type = (payload as { type?: unknown }).type;
	return typeof type === "string" ? type : null;
}

/** Parses every entry it can and drops the rest. */
function parseEach<T>(raw: unknown, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }): T[] {
	if (!Array.isArray(raw)) return [];
	const parsed: T[] = [];
	for (const entry of raw) {
		const result = schema.safeParse(entry);
		if (result.success) parsed.push(result.data);
	}
	return parsed;
}

function toFeedEntry(raw: unknown): RightNowFeedEntry | null {
	const result = rightNowFeedEntrySchema.safeParse(raw);
	if (!result.success) return null;
	const entry = result.data;
	switch (entry.type) {
		case "right_now_post_v3":
		case "locked_post_v1": {
			const r = entry.data;
			return {
				kind: "post",
				id: r.id ?? null,
				profileId: r.profileId,
				displayName: r.displayName ?? null,
				profileImageMediaHash: r.mediaHash ?? null,
				media: r.media ?? [],
				text: r.text ?? null,
				hosting: r.hosting,
				postedAt: r.posted ?? null,
				expiresAt: r.expiration ?? null,
				distanceMeters: r.distance ?? null,
				lat: r.lat ?? null,
				lon: r.lon ?? null,
				onlineUntil: r.onlineUntil ?? null,
				isFavorite: r.favorite,
				recentlyChatted: r.recentlyChatted,
				mpuScore: r.mpuScore,
				premiumType: entry.type === "locked_post_v1" ? (r.type ?? "locked") : null,
				isOnPrep: r.isOnPrep ?? null,
			};
		}
		case "discreet_right_now_post_v1":
		case "discreet_locked_post_v1": {
			const r = entry.data;
			return {
				kind: "discreet",
				id: r.id,
				media: r.media ?? [],
				text: r.text ?? null,
				hosting: r.hosting,
				postedAt: r.posted ?? null,
				expiresAt: r.expiration ?? null,
				distanceMeters: r.distance ?? null,
				onlineUntil: r.onlineUntil ?? null,
				premiumType: entry.type === "discreet_locked_post_v1" ? (r.type ?? "locked") : null,
				profileFields: {
					age: r.profileFields?.age ?? null,
					height: r.profileFields?.height ?? null,
					weight: r.profileFields?.weight ?? null,
					position: r.profileFields?.position ?? null,
				},
			};
		}
		// Tutorial cards and upsell inserts aren't shown.
		default:
			return null;
	}
}

export function createFeedMethods(fetchRest: RestFetcher, t: (key: string, defaultValue?: string) => string) {
	async function patchRunningPost(path: string, body: unknown, fallbackMessage: string): Promise<void> {
		const response = await fetchRest(path, { method: "PATCH", body });
		if (response.status === 400) {
			const urn = errorUrn(await parseJsonSafe(response));
			if (urn !== null && SESSION_ENDED_URNS.has(urn)) throw new RightNowSessionEndedError();
		}
		await assertSuccess(response, fallbackMessage);
	}

	async function getEntitlements(): Promise<RightNowEntitlements> {
		const response = await fetchRest("/v1/rightnow/entitlements/posts");
		await assertSuccess(response, t("api.errors.load_right_now"));
		const payload = await parseJsonSafe(response);
		return rightNowEntitlementsSchema.parse(payload);
	}

	return {
		getEntitlements,

		/**
		 * POST /v2/media/upload: keeps the whole image, with `thumbnail` (in
		 * the image's pixels) as the thumbnail — its centered square without one.
		 */
		async uploadRightNowMedia(params: {
			body: Uint8Array;
			contentType: string;
			width: number;
			height: number;
			thumbnail?: { left: number; top: number; right: number; bottom: number };
		}): Promise<RightNowUploadMediaResponse> {
			const { width, height } = params;
			const side = Math.min(width, height);
			const centered = {
				left: Math.floor((width - side) / 2),
				top: Math.floor((height - side) / 2),
				right: Math.floor((width - side) / 2) + side,
				bottom: Math.floor((height - side) / 2) + side,
			};
			const clamp = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));
			const thumb = params.thumbnail
				? {
						left: clamp(params.thumbnail.left, width),
						top: clamp(params.thumbnail.top, height),
						right: clamp(params.thumbnail.right, width),
						bottom: clamp(params.thumbnail.bottom, height),
					}
				: centered;
			const { left, top } = thumb;
			const query = new URLSearchParams({
				crop_top: "0",
				crop_bottom: String(height),
				crop_left: "0",
				crop_right: String(width),
				img_1_top: String(top),
				img_1_bottom: String(thumb.bottom),
				img_1_left: String(left),
				img_1_right: String(thumb.right),
				rotate: "0",
				flip_vertical: "false",
			});
			const url = `/v2/media/upload?${query.toString()}`;
			appLog.info("POST /v2/media/upload REQUEST:", {
				width,
				height,
				contentType: params.contentType,
				bodyLength: params.body.length,
			});
			const response = await fetchRest(url, {
				method: "POST",
				rawBody: params.body,
				contentType: params.contentType,
			});
			await assertSuccess(response, t("api.errors.upload_image"));
			const payload = await parseJsonSafe(response);
			appLog.info("POST /v2/media/upload RESPONSE:", payload);
			return rightNowUploadMediaResponseSchema.parse(payload);
		},

		/**
		 * The feed takes no location: the server answers for the last stored
		 * one. So the browse location is stored right before each request
		 * (best-effort, like open-grind), or a location change would keep
		 * showing the old area's posts.
		 */
		async getRightNowFeed(params: {
			version: RightNowFeedVersion;
			geohash?: string | null;
			sort?: RightNowFeedSort;
			hosting?: boolean;
			ageMin?: number;
			ageMax?: number;
			sexualPositions?: string;
		}): Promise<RightNowFeed> {
			const queryParams = new URLSearchParams();
			if (params.sort) queryParams.set("sort", params.sort);
			if (params.hosting != null) queryParams.set("hosting", String(params.hosting));
			if (typeof params.ageMin === "number") queryParams.set("ageMin", String(params.ageMin));
			if (typeof params.ageMax === "number") queryParams.set("ageMax", String(params.ageMax));
			if (params.sexualPositions) queryParams.set("sexualPositions", params.sexualPositions);

			// Never report a location while the bypass has it parked in Honduras.
			await awaitEntitlementGrant();
			// Incognito never reports a location: storing one updates the account's
			// server-side location and marks it online (see AssignmentsBridge).
			if (params.geohash && !getIncognitoMode()) {
				try {
					const response = await fetchRest("/v4/location", {
						method: "PUT",
						body: { geohash: coarsenGeohash(params.geohash) },
					});
					if (response.status < 200 || response.status >= 300) appLog.warn(`PUT /v4/location failed with ${response.status}`);
				} catch (error) {
					appLog.warn("PUT /v4/location failed", error);
				}
			}

			const url = `/${params.version}/rightnow/feed?${queryParams.toString()}`;
			const response = await fetchRest(url);
			await assertSuccess(response, t("api.errors.load_right_now"));
			const raw = (await parseJsonSafe(response)) as Record<string, unknown> | null;
			const rawItems = Array.isArray(raw?.items) ? (raw.items as unknown[]) : [];

			return {
				items: rawItems
					.map(toFeedEntry)
					.filter((item): item is RightNowFeedEntry => item !== null),
				viewerCount: typeof raw?.viewerCount === "number" ? raw.viewerCount : null,
			};
		},

		/**
		 * Checks the post entitlement first: with none left the server still
		 * accepts the post, but parks it as AWAITING_PAYMENT where nobody sees it.
		 *
		 * A discreet post can't be created as such: the create routes have no
		 * isDiscreet. It is created with POST /v4 (which starts HIDDEN), made
		 * discreet with PATCH /v5, and only then shown — so a failure on the way
		 * never leaves it public with the profile attached.
		 */
		async createRightNowPost(
			params: RightNowCreatePostRequest,
			options?: { discreet?: { sharedFields: RightNowSharedField[] } },
		): Promise<RightNowCreatePostResponse> {
			const entitlements = await getEntitlements();
			if (freeRightNowPostsLeft(entitlements) === 0) throw new NoFreeRightNowPostsError();

			const validated = rightNowCreatePostRequestSchema.parse(params);
			// Left out instead of null: the create routes take them as optional.
			const body = Object.fromEntries(Object.entries(validated).filter(([, value]) => value !== null && value !== undefined));
			const discreet = options?.discreet;
			const path = discreet ? "/v4/rightnow/posts" : "/v3/rightnow/posts";
			appLog.info(`POST ${path} REQUEST:`, body);
			const response = await fetchRest(path, {
				method: "POST",
				body,
			});
			if (response.status === 400 && errorUrn(await parseJsonSafe(response)) === "urn:gr:err:client_action") {
				throw new RightNowPostAlreadyRunningError();
			}
			await assertSuccess(response, t("api.errors.session_right_now"));
			const payload = await parseJsonSafe(response);
			appLog.info(`POST ${path} RESPONSE:`, payload);
			const created = rightNowCreatePostResponseSchema.parse(payload);
			if (created.post.postStatus === "AWAITING_PAYMENT") throw new NoFreeRightNowPostsError();
			if (!discreet) return created;

			const postId = created.post.id;
			const fallback = t("api.errors.session_right_now");
			try {
				await patchRunningPost(`/v5/rightnow/posts/${postId}`, { isDiscreet: true, sharedFields: discreet.sharedFields }, fallback);
				await patchRunningPost(`/v1/rightnow/posts/${postId}/settings`, { hidden: false }, fallback);
			} catch (error) {
				// The post exists but stays hidden; the caller keeps it as the running session.
				throw new RightNowDiscreetSetupError(created, error);
			}
			return {
				post: {
					...created.post,
					postStatus: "ACTIVE",
					isDiscreet: "TRUE",
					sharedFields: discreet.sharedFields,
				},
			};
		},

		async getActiveRightNowPost(): Promise<RightNowCreatePostResponse> {
			const url = "/v3/rightnow/active-post";
			const response = await fetchRest(url);
			await assertSuccess(response, t("api.errors.load_right_now"));
			const payload = await parseJsonSafe(response);
			appLog.info("GET /v3/rightnow/active-post RESPONSE:", payload);
			return rightNowCreatePostResponseSchema.parse(payload);
		},

		/**
		 * PATCH /{v4,v5}/rightnow/posts/{id}: partial edit, keeps the post's
		 * identity and expiration. v5 also applies isDiscreet and sharedFields;
		 * v4 ignores them (and turns an undecided isDiscreet into FALSE).
		 */
		async updateRightNowPost(
			postId: number,
			params: RightNowUpdatePostRequest,
			version: "v4" | "v5" = "v4",
		): Promise<{ ok: true }> {
			const validated = rightNowUpdatePostRequestSchema.parse(params);
			appLog.info(`PATCH /${version}/rightnow/posts/${postId} REQUEST:`, validated);
			await patchRunningPost(
				`/${version}/rightnow/posts/${postId}`,
				validated,
				t("api.errors.update_right_now", "Failed to update post"),
			);
			return { ok: true };
		},

		/** GET /v1/rightnow/requests/outbox: requests we sent to discreet posts. */
		async getSentRightNowRequests(): Promise<RightNowSentRequest[]> {
			const response = await fetchRest("/v1/rightnow/requests/outbox");
			await assertSuccess(response, t("api.errors.load_right_now"));
			const raw = (await parseJsonSafe(response)) as { requests?: unknown } | null;
			return parseEach(raw?.requests, rightNowSentRequestSchema);
		},

		/** GET /v1/rightnow/requests/inbox: requests others sent to our post. */
		async getReceivedRightNowRequests(): Promise<RightNowReceivedRequest[]> {
			const response = await fetchRest("/v1/rightnow/requests/inbox");
			await assertSuccess(response, t("api.errors.load_right_now"));
			const raw = (await parseJsonSafe(response)) as { requests?: unknown } | null;
			return parseEach(raw?.requests, rightNowReceivedRequestSchema);
		},

		/**
		 * POST /v1/rightnow/requests: asks a discreet post's author to connect.
		 * Once they accept, the server opens a chat between us.
		 */
		async sendRightNowRequest(postId: number): Promise<{ ok: true }> {
			appLog.info("POST /v1/rightnow/requests REQUEST:", { postId });
			const response = await fetchRest("/v1/rightnow/requests", { method: "POST", body: { postId } });
			await assertSuccess(response, t("api.errors.send_right_now_request", "Failed to send request"));
			appLog.info("POST /v1/rightnow/requests RESPONSE:", await parseJsonSafe(response));
			return { ok: true };
		},

		/** PUT /v1/rightnow/requests/{id}: the post's author accepts or rejects a request. */
		async respondToRightNowRequest(requestId: number, status: "ACCEPTED" | "REJECTED"): Promise<{ ok: true }> {
			appLog.info(`PUT /v1/rightnow/requests/${requestId} REQUEST:`, { status });
			const response = await fetchRest(`/v1/rightnow/requests/${requestId}`, { method: "PUT", body: { status } });
			await assertSuccess(response, t("api.errors.update_right_now_request", "Failed to answer request"));
			return { ok: true };
		},

		/** PATCH /v1/rightnow/posts/{id}/settings: hides or unhides a running post. */
		async setRightNowPostHidden(postId: number, hidden: boolean): Promise<{ ok: true }> {
			appLog.info(`PATCH /v1/rightnow/posts/${postId}/settings REQUEST:`, { hidden });
			await patchRunningPost(
				`/v1/rightnow/posts/${postId}/settings`,
				{ hidden },
				t("api.errors.update_right_now", "Failed to update post"),
			);
			return { ok: true };
		},
	};
}
