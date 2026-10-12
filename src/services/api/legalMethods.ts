import { z } from "zod";
import type { RestFetcher } from "../../types/chat-service";
import { assertSuccess, parseJsonSafe } from "../apiHelpers";

const versionSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

const legalAgreementsInfoSchema = z.object({
	legalAgreements: z.object({
		termsOfServiceUrl: z.string(),
		latestTermsOfServiceVersion: versionSchema,
		privacyPolicyUrl: z.string(),
		latestPrivacyPolicyVersion: versionSchema,
	}),
});

const acceptedLegalAgreementsSchema = z.object({
	termsOfServiceVersion: versionSchema.nullish(),
	privacyPolicyVersion: versionSchema.nullish(),
	userConsentList: z.array(z.string()).nullish(),
});

export type LegalAgreementsInfo = z.infer<typeof legalAgreementsInfoSchema>["legalAgreements"];

export interface AcceptedLegalAgreements {
	termsOfServiceVersion: string | null;
	privacyPolicyVersion: string | null;
	userConsentList: string[];
}

/** Grindr's versions are date stamps ("20260706"); the PUT body wants them as numbers. */
function toWireVersion(version: string): number | string {
	return /^\d+$/.test(version) ? Number(version) : version;
}

export function createLegalMethods(fetchRest: RestFetcher, t: (key: string, defaultValue?: string) => string) {
	return {
		/** Latest published Terms of Service / Privacy Policy versions and their URLs. */
		async getLegalAgreementsInfo(): Promise<LegalAgreementsInfo> {
			const response = await fetchRest("/v3/legal-agreements");
			await assertSuccess(response, t("api.errors.load_legal_agreements"));
			const payload = await parseJsonSafe(response);
			return legalAgreementsInfoSchema.parse(payload).legalAgreements;
		},

		/** The versions the signed-in user has accepted (null if never accepted). */
		async getAcceptedLegalAgreements(): Promise<AcceptedLegalAgreements> {
			const response = await fetchRest("/v3/me/legal-agreements");
			await assertSuccess(response, t("api.errors.load_legal_agreements"));
			const payload = await parseJsonSafe(response);
			const parsed = acceptedLegalAgreementsSchema.parse(payload ?? {});
			return {
				termsOfServiceVersion: parsed.termsOfServiceVersion ?? null,
				privacyPolicyVersion: parsed.privacyPolicyVersion ?? null,
				userConsentList: parsed.userConsentList ?? [],
			};
		},

		/** Consents can only be added via this PUT, so an empty list leaves existing ones untouched. */
		async acceptLegalAgreements(params: {
			termsOfServiceVersion: string;
			privacyPolicyVersion: string;
		}): Promise<void> {
			const response = await fetchRest("/v3/me/legal-agreements", {
				method: "PUT",
				body: {
					termsOfServiceVersion: toWireVersion(params.termsOfServiceVersion),
					privacyPolicyVersion: toWireVersion(params.privacyPolicyVersion),
					userConsentList: [],
				},
			});
			await assertSuccess(response, t("api.errors.accept_legal_agreements"));
		},
	};
}
