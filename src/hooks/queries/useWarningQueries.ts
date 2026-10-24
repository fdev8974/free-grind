import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiFunctions } from "../useApiFunctions";
import type { AccountWarning } from "../../services/api/warningsMethods";

/**
 * The signed-in user's community-guidelines warnings. Unlike bans they
 * aren't on the session token, so they're fetched once per login.
 */
export function useAccountWarnings(userId: number | null, enabled = true) {
	const api = useApiFunctions();
	return useQuery<AccountWarning[]>({
		queryKey: ["account-warnings", userId],
		queryFn: () => api.getAccountWarnings(),
		staleTime: Infinity,
		gcTime: Infinity,
		retry: false,
		enabled: enabled && !!userId,
	});
}

export function useAcknowledgeAccountWarnings(userId: number | null) {
	const api = useApiFunctions();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => api.acknowledgeAccountWarnings(),
		onSuccess: () => {
			queryClient.setQueryData<AccountWarning[]>(["account-warnings", userId], []);
		},
	});
}
