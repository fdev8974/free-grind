import globals from "globals";
import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default defineConfig(
	js.configs.recommended,
	ts.configs.recommended,
	prettier,
	{
		languageOptions: { globals: globals.node },
		rules: {
			"no-undef": "off",
		},
	},
);
