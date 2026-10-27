import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiFunctions } from "../useApiFunctions";
import type { AcceptedLegalAgreements, LegalAgreementsInfo } from "../../services/api/legalMethods";

/**
 * Latest published ToS / Privacy Policy versions. Fetched once per session
 * so the accept call later can send the exact versions the user was shown.
 */
export function useLegalAgreementsInfo(enabled = true) {
	const api = useApiFunctions();
	return useQuery<LegalAgreementsInfo>({
		queryKey: ["legal-agreements-info"],
		queryFn: () => api.getLegalAgreementsInfo(),
		staleTime: Infinity,
		gcTime: Infinity,
		enabled,
	});
}

/** The ToS / Privacy Policy versions the signed-in user has accepted. */
export function useAcceptedLegalAgreements(userId: number | null, enabled = true) {
	const api = useApiFunctions();
	return useQuery<AcceptedLegalAgreements>({
		queryKey: ["legal-agreements-accepted", userId],
		queryFn: () => api.getAcceptedLegalAgreements(),
		staleTime: Infinity,
		gcTime: Infinity,
		enabled: enabled && !!userId,
	});
}

export function useAcceptLegalAgreements(userId: number | null) {
	const api = useApiFunctions();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (params: { termsOfServiceVersion: string; privacyPolicyVersion: string }) =>
			api.acceptLegalAgreements(params),
		onSuccess: (_, params) => {
			const now = Date.now();
			queryClient.setQueryData<AcceptedLegalAgreements>(["legal-agreements-accepted", userId], (old) => ({
				...params,
				userConsentList: old?.userConsentList ?? [],
				termsAcceptedAt: now,
				privacyAcceptedAt: now,
			}));
		},
	});
}

/**
 * True when the accepted version is missing or older than the latest one.
 * Versions are date stamps ("20260706"), so numeric ones compare numerically.
 */
export function isLegalVersionOutdated(accepted: string | null, latest: string): boolean {
	if (!accepted) return true;
	if (/^\d+$/.test(accepted) && /^\d+$/.test(latest)) {
		return Number(accepted) < Number(latest);
	}
	return accepted !== latest;
}
