import DefaultTheme from "vitepress/theme";
import "virtual:icons.css";
import "./custom.css";
import DownloadButton from "./DownloadButton.vue";
import Layout from "./Layout.vue";
import NavVersion from "./NavVersion.vue";
import Subpages from "./Subpages.vue";

export default {
	extends: DefaultTheme,
	Layout,
	enhanceApp({ app }) {
		app.component("DownloadButton", DownloadButton);
		app.component("NavVersion", NavVersion);
		app.component("Subpages", Subpages);
	},
};
