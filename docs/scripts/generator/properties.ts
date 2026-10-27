import type { Context } from "./context";
import { urlForSchema } from "./slugs";
import type { RequestBody, Schema } from "./types";

const TYPE_HINT_TOKENS = [
	"string",
	"number",
	"integer",
	"long",
	"object",
	"array",
	"boolean",
	"float",
	"unix",
	"iso",
	"url",
	"email",
	"binary",
	"uuidv",
	"uuid",
	"hex",
	"jwt",
];

const PLURALIZABLE = new Set([
	"object",
	"long integer",
	"integer",
	"number",
	"string",
	"float",
]);

function pluralize(inner: string): string {
	if (inner.endsWith("s") || inner.includes("[") || inner.includes("("))
		return inner;
	if (PLURALIZABLE.has(inner)) return `${inner}s`;
	return inner;
}

export function descriptionConveysType(desc: string): boolean {
	const trimmed = desc.trimStart();
	if (
		trimmed.startsWith("[") ||
		trimmed.startsWith("*") ||
		trimmed.startsWith("see ")
	)
		return true;
	const lower = trimmed.slice(0, 64).toLowerCase();
	return TYPE_HINT_TOKENS.some((t) => lower.includes(t));
}

function isOpaqueObjectSchema(schema: Schema | undefined): boolean {
	if (!schema || schema.type !== "object") return false;
	if (schema.properties && Object.keys(schema.properties).length) return false;
	if (schema.allOf?.length) return false;
	if (schema.oneOf?.length) return false;
	return schema.additionalProperties === true;
}

export function isPlaceholderSchema(
	schema: Schema | undefined,
	resolve?: (name: string) => Schema | undefined,
): boolean {
	if (!schema) return false;
	if (schema.$ref === "#/components/schemas/UndocumentedObject") return true;
	const first = schema.allOf?.[0];
	if (
		schema.allOf?.length === 1 &&
		first?.$ref === "#/components/schemas/UndocumentedObject"
	)
		return true;
	if (resolve && schema.$ref?.startsWith("#/components/schemas/")) {
		const resolved = resolve(schema.$ref.replace("#/components/schemas/", ""));
		if (resolved && isOpaqueObjectSchema(resolved)) return true;
	}
	return isOpaqueObjectSchema(schema);
}

export function isPlaceholderBody(
	body: RequestBody | undefined,
	resolve?: (name: string) => Schema | undefined,
): boolean {
	if (!body?.content) return false;
	for (const media of Object.values(body.content)) {
		if (isPlaceholderSchema(media.schema, resolve)) return true;
	}
	return false;
}

export function isEmptyObjectSchema(schema: Schema | undefined): boolean {
	if (!schema || schema.type !== "object") return false;
	if (schema.properties && Object.keys(schema.properties).length) return false;
	if (schema.allOf?.length) return false;
	return true;
}

function refName(ref: string): string {
	return ref.replace("#/components/schemas/", "");
}

export function inlineIfUnrendered(ctx: Context, schema: Schema): Schema {
	if (schema.$ref) {
		const name = refName(schema.$ref);
		if (!ctx.renderedSchemas.has(name)) {
			const resolved = ctx.doc.components.schemas[name];
			if (resolved) return resolved;
		}
	}
	const first = schema.allOf?.[0];
	if (schema.allOf?.length === 1 && first?.$ref) {
		const name = refName(first.$ref);
		if (!ctx.renderedSchemas.has(name)) {
			const resolved = ctx.doc.components.schemas[name];
			if (resolved) {
				const siblings = { ...schema };
				delete siblings.$ref;
				delete siblings.allOf;
				return { ...resolved, ...siblings };
			}
		}
	}
	return schema;
}

export function describeType(ctx: Context, schema: Schema | undefined): string {
	if (!schema) return "";
	const s = inlineIfUnrendered(ctx, schema);
	if (s.$ref) {
		const name = refName(s.$ref);
		const display =
			ctx.doc.components.schemas[name]?.["x-display-name"] ?? name;
		return `[${display}](${urlForSchema(ctx, name)})`;
	}
	const first = s.allOf?.[0];
	if (s.allOf?.length === 1 && first?.$ref) return describeType(ctx, first);
	if (s.allOf?.length === 1 && first?.type === "object")
		return describeType(ctx, first);
	if (Array.isArray(s.allOf) || s.oneOf || s.anyOf) return "object";
	if (s.type === "array") {
		const inner = describeType(ctx, s.items);
		if (!inner) return "array";
		return `array of ${pluralize(inner)}`;
	}
	if (s.type === "integer")
		return s.format === "int64" ? "long integer" : "integer";
	if (s.type === "number") return s.format === "float" ? "float" : "number";
	if (s.type === "string") {
		if (s.format === "binary") return "binary";
		if (s.format === "date-time") return "ISO 8601 date string";
		if (s.format === "uri") return "URL";
		if (s.format === "email") return "email";
		return "string";
	}
	if (s.type === "boolean") return "boolean";
	if (s.type === "object") return "object";
	return "";
}

function nullableSuffix(desc: string, nullable: boolean): string {
	if (!nullable) return "";
	if (desc.includes("`null`") || /\bnull\b/i.test(desc)) return "";
	return " or `null`";
}

export function renderPropertyRhs(
	ctx: Context,
	schema: Schema | undefined,
): string {
	if (!schema) return "unknown";
	const type = describeType(ctx, schema);
	const desc = schema.description;
	if (desc) {
		const body = descriptionConveysType(desc)
			? desc
			: type
				? `${type}, ${desc}`
				: desc.trimStart().toLowerCase().startsWith("unknown")
					? desc
					: `unknown, ${desc}`;
		return body + nullableSuffix(body, !!schema.nullable);
	}
	const base = type || "unknown";
	return schema.nullable ? `${base} or \`null\`` : base;
}

export interface FlattenedSchema {
	properties: Record<string, Schema>;
	required: string[];
	__allOfRefs: string[];
}

export function flattenAllOf(schema: Schema): FlattenedSchema {
	const merged: FlattenedSchema = {
		properties: {},
		required: [],
		__allOfRefs: [],
	};
	for (const piece of schema.allOf ?? []) {
		if (piece.$ref) merged.__allOfRefs.push(refName(piece.$ref));
		else if (piece.type === "object" && piece.properties) {
			Object.assign(merged.properties, piece.properties);
			if (piece.required) merged.required.push(...piece.required);
		}
	}
	return merged;
}

export function flattenSchema(
	schema: Schema | undefined,
): FlattenedSchema | null {
	if (!schema) return null;
	let base: FlattenedSchema;
	if (Array.isArray(schema.allOf)) base = flattenAllOf(schema);
	else if (schema.properties) {
		base = {
			properties: { ...schema.properties },
			required: [...(schema.required ?? [])],
			__allOfRefs: [],
		};
	} else return null;
	if (schema.properties && Array.isArray(schema.allOf)) {
		for (const [k, v] of Object.entries(schema.properties)) {
			base.properties[k] = { ...(base.properties[k] ?? {}), ...v };
		}
	}
	if (schema.required && !Array.isArray(schema.allOf))
		base.required.push(...schema.required);
	return base;
}

type InlinedObject = (Schema & { __allOfRefs?: string[] }) | null;

export function inlineObject(
	ctx: Context,
	schema: Schema | undefined,
): InlinedObject {
	if (!schema) return null;
	const first = schema.allOf?.[0];
	if (schema.allOf?.length === 1 && first?.$ref) return null;
	if (schema.type === "object" && schema.properties) return schema;
	if (schema.type === "array" && schema.items) {
		const items = inlineIfUnrendered(ctx, schema.items);
		if (items.type === "object" && items.properties) return items;
		if (Array.isArray(items.allOf)) return flattenAllOf(items);
	}
	if (schema.allOf?.length === 1 && first?.type === "object") return first;
	if (Array.isArray(schema.allOf)) return flattenAllOf(schema);
	return null;
}

export function renderProperty(
	ctx: Context,
	name: string,
	schema: Schema,
	indent: number,
	required: boolean,
): string {
	let working = inlineIfUnrendered(ctx, schema);
	if (working.type === "array" && working.items) {
		const resolvedItems = inlineIfUnrendered(ctx, working.items);
		if (resolvedItems !== working.items)
			working = { ...working, items: resolvedItems };
	}
	const pad = "  ".repeat(indent);
	const rhs = renderPropertyRhs(ctx, working);
	const lines = [`${pad}- \`${name}\` — ${rhs}`];
	const addlProps = working.additionalProperties;
	if (
		working.type === "object" &&
		!working.properties &&
		typeof addlProps === "object" &&
		addlProps.properties
	) {
		const childPad = "  ".repeat(indent + 1);
		lines.push(
			`${childPad}- *key is ${working["x-key-description"] ?? "string"}*`,
		);
		const reqList = addlProps.required ?? [];
		for (const [k, v] of Object.entries(addlProps.properties)) {
			lines.push(renderProperty(ctx, k, v, indent + 1, reqList.includes(k)));
		}
		void required;
		return lines.join("\n");
	}
	const inline = inlineObject(ctx, working);
	if (inline) {
		const childPad = "  ".repeat(indent + 1);
		for (const refName of inline.__allOfRefs ?? []) {
			const display =
				ctx.doc.components.schemas[refName]?.["x-display-name"] ?? refName;
			lines.push(
				`${childPad}- *everything from [${display}](${urlForSchema(ctx, refName)})*`,
			);
		}
		if (inline.properties) {
			const reqList = inline.required ?? [];
			for (const [k, v] of Object.entries(inline.properties)) {
				lines.push(renderProperty(ctx, k, v, indent + 1, reqList.includes(k)));
			}
		}
	}
	void required;
	return lines.join("\n");
}
