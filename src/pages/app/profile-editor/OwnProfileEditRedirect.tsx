import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../contexts/useAuth";
import { useDesktopBreakpoint } from "../../../hooks/useDesktopBreakpoint";

/** The old /settings/profile-editor URL (settings search, older links): opens
 * your own profile in edit mode instead, like Settings' profile row does. */
export function OwnProfileEditRedirect() {
	const { userId } = useAuth();
	const isDesktop = useDesktopBreakpoint();
	const location = useLocation();

	if (userId == null) return <Navigate to="/settings" replace />;

	return (
		<Navigate
			to={`/profile/${userId}`}
			replace
			state={{
				returnTo: "/settings",
				editOwnProfile: true,
				// Desktop shows the profile as a modal over Settings (see App.tsx).
				...(isDesktop
					? { backgroundLocation: { ...location, pathname: "/settings", search: "", hash: "", state: null } }
					: {}),
			}}
		/>
	);
}
