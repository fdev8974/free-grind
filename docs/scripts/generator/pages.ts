import type { Context } from "./context";
import { SHARED_PAGE } from "./context";
import { renderOperation } from "./operations";
import { renderProperty } from "./properties";
import {
	pageTitle,
	schemaDisplay,
	tagTitle,
	urlForParamGroup,
	urlForSchema,
	withWipSuffix,
} from "./slugs";
import type { Parameter, ParameterOrRef, PropertyGroup, Schema } from "./types";

function refName(ref: string): string {
	return ref.replace("#/components/schemas/", "");
}

function resolveGroupParam(
	ctx: Context,
	p: ParameterOrRef,
): Parameter | undefined {
	if ("$ref" in p) {
		const name = p.$ref.replace("#/components/parameters/", "");
		return ctx.doc.components.parameters?.[name];
	}
	return p;
}

function appendOptional(propertyLine: string, optional: boolean): string {
	if (!optional) return propertyLine;
	const nl = propertyLine.indexOf("\n");
	let head = nl >= 0 ? propertyLine.slice(0, nl) : propertyLine;
	const tail = nl >= 0 ? propertyLine.slice(nl) : "";
	head = head.replace(/,\s*may be absent/gi, "");
	if (/,\s*optional$/i.test(head)) return `${head}${tail}`;
	return `${head}, optional${tail}`;
}

function renderParamGroupSection(ctx: Context, groupName: string): string {
	const group = ctx.paramGroups.get(groupName);
	if (!group) return "";
	const lines: string[] = [`## ${groupName}`, ""];
	if (group["x-inherits"]) {
		const parentUrl = urlForParamGroup(ctx, group["x-inherits"]);
		lines.push(`- *everything from [${group["x-inherits"]}](${parentUrl})*`);
	}
	for (const p of group.parameters) {
		const resolved = resolveGroupParam(ctx, p);
		if (!resolved) continue;
		const base = resolved.schema ?? {};
		const schema: Schema =
			resolved.description && !base.description
				? { ...base, description: resolved.description }
				: base;
		lines.push(
			appendOptional(
				renderProperty(ctx, resolved.name, schema, 0, !!resolved.required),
				!resolved.required,
			),
		);
	}
	lines.push("");
	return lines.join("\n").trimEnd() + "\n";
}

function renderPropertyGroups(
	ctx: Context,
	groups: PropertyGroup[],
	lines: string[],
): void {
	for (const group of groups) {
		lines.push("", group.heading, "");
		for (const piece of group.allOf ?? []) {
			if (piece.$ref) {
				const ref = refName(piece.$ref);
				lines.push(
					`- *everything from [${schemaDisplay(ctx, ref)}](${urlForSchema(ctx, ref)})*`,
				);
			}
		}
		const groupRequired = group.required;
		for (const [k, v] of Object.entries(group.properties ?? {})) {
			const req =
				groupRequired === undefined ? true : groupRequired.includes(k);
			lines.push(appendOptional(renderProperty(ctx, k, v, 0, req), !req));
		}
	}
}

function renderSchemaSection(ctx: Context, name: string): string {
	const schema = ctx.doc.components.schemas[name];
	if (!schema) return "";
	if (schema["x-exclude-from-markdown"]) return "";
	const wip = schema["x-wip"] === true;
	const display = schemaDisplay(ctx, name);
	const lines: string[] = [`## ${display}`, ""];

	if (wip) lines.push("> [!NOTE]\n> This type hasn't been researched yet", "");
	if (schema.description) lines.push(schema.description, "");

	if (schema["x-enum-labels"]) {
		const variants = schema.oneOf ?? schema.anyOf;
		const intEnumVals: number[] = [];
		const strEnumVals: string[] = [];
		if (variants) {
			for (const v of variants) {
				if (v.type === "integer" && Array.isArray(v.enum))
					intEnumVals.push(...(v.enum as number[]));
				if (v.type === "string" && Array.isArray(v.enum))
					strEnumVals.push(...(v.enum as string[]));
			}
		}
		const strToInt = new Map(strEnumVals.map((s, i) => [s, intEnumVals[i]]));
		for (const [val, label] of Object.entries(schema["x-enum-labels"])) {
			const intVal = strToInt.get(val);
			const keyPart =
				intVal !== undefined ? `\`"${val}"\` or \`${intVal}\`` : `\`${val}\``;
			if (intVal === undefined && label === val) {
				lines.push(`- ${keyPart}`);
			} else {
				lines.push(`- ${keyPart} — ${label}`);
			}
		}
		lines.push("");
		return lines.join("\n").trimEnd() + "\n";
	}

	if (schema.enum) {
		for (const val of schema.enum) lines.push(`- \`${JSON.stringify(val)}\``);
		lines.push("");
		return lines.join("\n").trimEnd() + "\n";
	}

	if (Array.isArray(schema.allOf)) {
		for (const piece of schema.allOf) {
			if (piece.$ref) {
				const ref = refName(piece.$ref);
				lines.push(
					`- *everything from [${schemaDisplay(ctx, ref)}](${urlForSchema(ctx, ref)})*`,
				);
			}
		}
		const inline = schema.allOf.find((p): p is Schema => p.type === "object");
		const overrides = schema.properties ?? {};
		const merged: Record<string, Schema> = { ...(inline?.properties ?? {}) };
		for (const [k, v] of Object.entries(overrides)) {
			merged[k] = { ...(merged[k] ?? {}), ...v };
		}
		const reqSet = new Set([
			...(inline?.required ?? []),
			...(schema.required ?? []),
		]);
		for (const [k, v] of Object.entries(merged)) {
			const req = reqSet.has(k);
			lines.push(appendOptional(renderProperty(ctx, k, v, 0, req), !req));
		}
		renderPropertyGroups(ctx, schema["x-property-groups"] ?? [], lines);
		lines.push("");
		return lines.join("\n").trimEnd() + "\n";
	}

	if (schema.properties) {
		const reqList = schema.required ?? [];
		for (const [k, v] of Object.entries(schema.properties)) {
			const req = reqList.includes(k);
			lines.push(appendOptional(renderProperty(ctx, k, v, 0, req), !req));
		}
		renderPropertyGroups(ctx, schema["x-property-groups"] ?? [], lines);
		lines.push("");
		return lines.join("\n").trimEnd() + "\n";
	}

	if (schema["x-property-groups"]?.length) {
		renderPropertyGroups(ctx, schema["x-property-groups"], lines);
		lines.push("");
		return lines.join("\n").trimEnd() + "\n";
	}

	const variants = schema.oneOf ?? schema.anyOf;
	if (variants) {
		for (const v of variants) {
			if (v.$ref) {
				const ref = refName(v.$ref);
				lines.push(`- [${schemaDisplay(ctx, ref)}](${urlForSchema(ctx, ref)})`);
			}
		}
		lines.push("");
	}

	return lines.join("\n").trimEnd() + "\n";
}

export function renderTagPage(ctx: Context, tagName: string): string {
	const tagObj = ctx.doc.tags.find((t) => t.name === tagName);
	const wip = tagObj?.["x-wip"] === true;
	const lines: string[] = [`# ${withWipSuffix(tagTitle(tagName), wip)}`, ""];

	if (tagObj?.description) {
		lines.push(tagObj.description, "");
	}

	if (wip && tagObj?.["x-wip-note"]) {
		lines.push(
			`> [!NOTE]\n> This page is a work in progress. Endpoints below haven't been fully researched. ${tagObj["x-wip-note"]}`,
			"",
		);
	} else if (wip) {
		lines.push(
			"> [!NOTE]\n> This page is a work in progress. Endpoints below haven't been fully researched.",
		"",
		);
	} else if (tagObj?.["x-wip-note"]) {
		lines.push(`> [!NOTE]\n> ${tagObj["x-wip-note"]}`, "");
	}

	for (const entry of ctx.operationsByTag.get(tagName) ?? []) {
		lines.push(renderOperation(ctx, entry, wip));
	}
	for (const name of ctx.paramGroupsByPage.get(tagName) ?? []) {
		lines.push(renderParamGroupSection(ctx, name));
	}
	for (const name of ctx.schemasByPage.get(tagName) ?? []) {
		lines.push(renderSchemaSection(ctx, name));
	}
	return (
		lines
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trimEnd() + "\n"
	);
}

export function renderSharedPage(ctx: Context, pageName: string): string {
	const lines: string[] = [`# ${pageTitle(pageName)}`, ""];
	const lead =
		pageName === SHARED_PAGE
			? "Types shared across multiple top-level sections."
			: `Types shared by more than one ${pageName.split("/")[0]} endpoint page.`;
	lines.push(lead, "");
	const schemas = [...(ctx.schemasByPage.get(pageName) ?? [])].sort((a, b) =>
		schemaDisplay(ctx, a).localeCompare(schemaDisplay(ctx, b)),
	);
	for (const name of schemas) lines.push(renderSchemaSection(ctx, name));
	return (
		lines
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trimEnd() + "\n"
	);
}
