import { useNavigate } from "react-router-dom";
import { HeaderBackButton } from "./HeaderBackButton";

export function BackToSettings() {
	const navigate = useNavigate();
	return <HeaderBackButton onClick={() => navigate("/settings")} />;
}
