import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import semver from "semver";

// Sets the app version everywhere it lives. package.json is the source of truth
// (tauri.conf.json points at it, vite reads it); Cargo.toml/Cargo.lock only
// mirror it so the crate version doesn't drift.
//
//   bun run set-version beta      1.0.0-beta.0 -> 1.0.0-beta.1, 1.0.0 -> 1.1.0-beta.0
//   bun run set-version rc        1.0.0-beta.3 -> 1.0.0-rc.0
//   bun run set-version release   1.0.0-rc.1   -> 1.0.0
//   bun run set-version patch|minor|major
//   bun run set-version 1.2.0-beta.0

const PRERELEASE_IDS = ["alpha", "beta", "rc"];
const BUMPS = [...PRERELEASE_IDS, "release", "patch", "minor", "major"];

function fail(message) {
	console.error(`set-version: ${message}`);
	process.exit(1);
}

function nextVersion(current, target) {
	if (PRERELEASE_IDS.includes(target)) {
		const [currentId] = semver.prerelease(current) ?? [];
		// Same channel: beta.0 -> beta.1. Other pre-release: beta.3 -> rc.0 on
		// the same core. Stable: start the next minor's pre-releases.
		if (currentId === target) return semver.inc(current, "prerelease", target);
		if (currentId !== undefined) {
			return `${semver.major(current)}.${semver.minor(current)}.${semver.patch(current)}-${target}.0`;
		}
		return semver.inc(current, "preminor", target);
	}

	if (target === "release") {
		if (!semver.prerelease(current)) fail(`${current} is already a release version`);
		return `${semver.major(current)}.${semver.minor(current)}.${semver.patch(current)}`;
	}

	if (BUMPS.includes(target)) return semver.inc(current, target);

	return target.replace(/^v/, "");
}

/** Pre-release identifiers must be `<name>.<number>` so beta.10 sorts after beta.2. */
function validate(version, current) {
	if (!semver.valid(version)) fail(`"${version}" is not a valid semver version`);

	const prerelease = semver.prerelease(version);
	if (prerelease && (prerelease.length !== 2 || typeof prerelease[0] !== "string" || typeof prerelease[1] !== "number")) {
		fail(`pre-release must look like "beta.0", got "${prerelease.join(".")}"`);
	}

	if (!semver.gt(version, current) && !process.argv.includes("--force")) {
		fail(`${version} is not newer than ${current} (pass --force to allow)`);
	}
}

function replaceOnce(path, pattern, replacement) {
	const content = readFileSync(path, "utf8");
	if (!pattern.test(content)) fail(`version not found in ${path}`);
	writeFileSync(path, content.replace(pattern, replacement));
}

const target = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!target) fail(`usage: bun run set-version <${BUMPS.join("|")}|x.y.z[-beta.N]> [--force]`);

const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const version = nextVersion(current, target);
validate(version, current);

replaceOnce("package.json", /("version":\s*")[^"]+(")/, `$1${version}$2`);
replaceOnce("src-tauri/Cargo.toml", /^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
replaceOnce("src-tauri/Cargo.lock", /(name = "free-grind"\nversion = ")[^"]+(")/, `$1${version}$2`);

console.log(`${current} -> ${version}`);
if (process.env.GITHUB_OUTPUT) {
	appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}
