import z from "zod";

export const banInfoSchema = z.object({
	kind: z.string(),
	code: z.number(),
	message: z.string(),
	reason: z.string().nullish(),
	subReason: z.string().nullish(),
	automated: z.boolean().nullish(),
});
export type BanInfo = z.infer<typeof banInfoSchema>;

// Mirrors error.rs's Restriction — the session itself is still valid, this
// just says the account can't be used until the user resolves it (age
// verification, a timed ban, ...). Distinct from a Banned AppError, which is
// a hard login/refresh rejection.
export const restrictionSchema = z.object({
	kind: z.enum(["ageVerification", "timedBan", "trustVendorRejected", "other"]),
	region: z.string().nullish(),
	reason: z.string().nullish(),
	/** Unix seconds a timed ban ends at. */
	expiresAt: z.number().nullish(),
	/** A timed ban's sub-category. */
	subReason: z.string().nullish(),
	/** Whether a timed ban was issued automatically. */
	automated: z.boolean().nullish(),
});
export type Restriction = z.infer<typeof restrictionSchema>;

export const methodSchemas = {
	login: {
		request: z.object({
			email: z.email(),
			password: z.string().min(1),
		}),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	login_with_jwt: {
		request: z.object({
			token: z.string().min(1),
		}),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	auth_state: {
		request: z.undefined(),
		response: z.number().int().nonnegative().nullable(),
	},
	account_restriction: {
		request: z.undefined(),
		response: restrictionSchema.nullish(),
	},
	websocket_token: {
		request: z.undefined(),
		response: z.string().min(1).nullable(),
	},
	sync_push_token: {
		request: z.object({
			token: z.string().min(1),
		}),
		response: z.undefined(),
	},
	logout: {
		request: z.undefined(),
		response: z.undefined(),
	},
	list_saved_accounts: {
		request: z.undefined(),
		// profileId stays a string here (unlike login/login_with_jwt's
		// coerced number) since it round-trips straight back into
		// switch_account/remove_saved_account's profile_id: String param —
		// keeping it a string end to end avoids a number<->string mismatch
		// at that call site (callMethod does no runtime parsing, so nothing
		// would coerce it back anyway).
		response: z.array(
			z.object({
				profileId: z.string(),
				email: z.string(),
				lastUsedAt: z.coerce.number().int().nonnegative(),
			}),
		),
	},
	switch_account: {
		request: z.object({
			profileId: z.string(),
		}),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	remove_saved_account: {
		request: z.object({
			profileId: z.string(),
		}),
		response: z.undefined(),
	},
} as const satisfies Record<
	string,
	{ request: z.ZodType; response: z.ZodType }
>;

export type MethodName = keyof typeof methodSchemas;

export type AppErrorKind =
	| "Http"
	| "Connect"
	| "Auth"
	| "NotSignedIn"
	| "SessionStale"
	| "Api"
	| "Unauthorized"
	| "Banned"
	| "RateLimited"
	| "RequestBlocked"
	| "NetworkBlocked"
	| "SessionCleared"
	| "NotInitialized"
	| "TokenExpired";

export interface AppError {
	kind: AppErrorKind;
	message?: string | { code: number; message: string } | BanInfo;
	prettyMessage: string;
}
