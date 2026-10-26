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
	/** Whether a timed ban's ban agreement has been accepted. */
	agreementCompleted: z.boolean().nullish(),
});
export type Restriction = z.infer<typeof restrictionSchema>;

// SmsCodeResponse of the /v4/sms/verification endpoints.
const smsCodeResultSchema = z.object({
	code: z.number().int().nullish(),
	message: z.string(),
});

export const methodSchemas = {
	login: {
		request: z.object({
			email: z.email(),
			password: z.string().min(1),
			captchaToken: z.string().min(1).optional(),
			keepDevice: z.boolean().optional(),
		}),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	sign_up_quota: {
		request: z.undefined(),
		response: z.object({
			used: z.number().int().nonnegative(),
			limit: z.number().int().nonnegative(),
		}),
	},
	create_account: {
		request: z.object({
			email: z.email(),
			password: z.string().min(1),
			birthday: z.number().int(),
			captchaToken: z.string().min(1),
			pushToken: z.string().min(1).nullable(),
		}),
		response: z.string().min(1),
	},
	forgot_password: {
		request: z.object({
			email: z.email(),
		}),
		response: z.undefined(),
	},
	send_sms_verification_code: {
		request: z.object({
			profileId: z.string().regex(/^\d+$/),
			countryCode: z.string().min(1),
			phoneNumber: z.string().min(1),
		}),
		response: smsCodeResultSchema,
	},
	verify_sms_verification_code: {
		request: z.object({
			profileId: z.string().regex(/^\d+$/),
			countryCode: z.string().min(1),
			phoneNumber: z.string().min(1),
			code: z.string().min(1),
		}),
		response: smsCodeResultSchema,
	},
	sms_debug_report: {
		request: z.undefined(),
		response: z.string().nullable(),
	},
	login_with_google: {
		request: z.object({
			token: z.string().min(1),
		}),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	login_with_google_window: {
		request: z.undefined(),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	login_with_facebook: {
		request: z.undefined(),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	recaptcha_first_party_enabled: {
		request: z.undefined(),
		response: z.boolean(),
	},
	auth_state: {
		request: z.undefined(),
		response: z.number().int().nonnegative().nullable(),
	},
	account_restriction: {
		request: z.undefined(),
		response: restrictionSchema.nullish(),
	},
	accept_ban_agreement: {
		request: z.undefined(),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
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
	sync_push_token_for_saved_accounts: {
		request: z.object({
			token: z.string().min(1),
		}),
		// Profile ids the token was registered for.
		response: z.array(z.string()),
	},
	logout: {
		request: z.undefined(),
		response: z.undefined(),
	},
	list_saved_accounts: {
		request: z.undefined(),
		// profileId stays a string here (unlike login/login_with_google's
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
			// Unregistered from Grindr for this account before removal.
			pushToken: z.string().nullish(),
		}),
		response: z.undefined(),
	},
	create_transfer_code: {
		request: z.undefined(),
		response: z.object({
			code: z.string(),
			/** The code as a QR code, an SVG document. */
			qrSvg: z.string(),
			/** Unix seconds. */
			expiresAt: z.number(),
		}),
	},
	sign_in_with_transfer_code: {
		request: z.object({
			code: z.string(),
		}),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
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
	| "VerificationRequired"
	| "Banned"
	| "RateLimited"
	| "RequestBlocked"
	| "NetworkBlocked"
	| "SessionCleared"
	| "NotInitialized"
	| "TokenExpired"
	| "SignUpLimitReached";

export interface AppError {
	kind: AppErrorKind;
	/** `profileId` and `body` (the whole response) only on VerificationRequired. */
	message?: string | { code: number; message: string; profileId?: string | null; body?: string } | BanInfo;
	prettyMessage: string;
}
