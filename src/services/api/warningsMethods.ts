import { z } from "zod";
import type { RestFetcher } from "../../types/chat-service";
import { assertSuccess, parseJsonSafe } from "../apiHelpers";

const accountWarningsSchema = z.object({
	warnings: z
		.array(
			z.object({
				warning: z.string(),
				count: z.number().int().nullish(),
			}),
		)
		.nullish(),
});

/** One community-guidelines violation type and how often it was flagged. */
export interface AccountWarning {
	/** Grindr's code, e.g. "MILD_INSULTS". */
	warning: string;
	count: number;
}

export function createWarningsMethods(fetchRest: RestFetcher, t: (key: string, defaultValue?: string) => string) {
	return {
		/** Unacknowledged community-guidelines warnings; empty when there are none. */
		async getAccountWarnings(): Promise<AccountWarning[]> {
			const response = await fetchRest("/v2/warnings");
			await assertSuccess(response, t("api.errors.load_warnings"));
			const payload = await parseJsonSafe(response);
			const parsed = accountWarningsSchema.parse(payload ?? {});
			return (parsed.warnings ?? []).map(({ warning, count }) => ({ warning, count: count ?? 1 }));
		},

		/** Clears every warning returned by getAccountWarnings. */
		async acknowledgeAccountWarnings(): Promise<void> {
			const response = await fetchRest("/v1/warnings", { method: "PUT" });
			await assertSuccess(response, t("api.errors.acknowledge_warnings"));
		},
	};
}
