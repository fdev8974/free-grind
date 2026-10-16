import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Shared by publish-ota.mjs (the OTA manifest's min_binary_version) and the
// release workflow (an APK release is only needed when this equals the current
// version, i.e. native code changed since the last binary).
//
//   node scripts/min-binary-version.mjs   -> prints e.g. 1.0.0-beta.0

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Diff lines that only move the app version (bump commits touch these files too).
const VERSION_ONLY_LINE = /^[+-]\s*(version\s*=\s*"|"version"\s*:)/;

/** Does `commit` change native code (src-tauri) beyond the version fields? */
function changesNativeCode(commit) {
  // Binary files (e.g. app icons) show up as "Binary files … differ" with no
  // +/- lines, and pure renames/mode changes have none either — numstat marks
  // the former "-\t-" and the latter "0\t0", so count both as native.
  const numstat = git(["diff", "--numstat", `${commit}^1`, commit, "--", "src-tauri"]);
  if (numstat.split("\n").some((line) => /^(-\t-|0\t0)\t/.test(line))) return true;

  const diff = git(["diff", "-U0", `${commit}^1`, commit, "--", "src-tauri"]);
  return diff
    .split("\n")
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line))
    .some((line) => !VERSION_ONLY_LINE.test(line));
}

function packageVersionAt(commit) {
  try {
    return JSON.parse(git(["show", `${commit}:package.json`])).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Oldest binary version that already contains the latest native change, so
 * frontend-only releases keep reaching older binaries over OTA instead of
 * forcing an APK reinstall for every version bump.
 *
 * Walks first-parent history to the newest commit that changed native code; a
 * binary contains it if it was built from that commit's version (when the
 * commit itself bumped it) or from the first version bump after it. Falls back
 * to the current version whenever history can't answer that.
 */
export function resolveAutoMinBinaryVersion(appVersion) {
  try {
    if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
      console.warn("Shallow clone, using the app version as min_binary_version");
      return appVersion;
    }

    const nativeCommit = git(["log", "--first-parent", "--format=%H", "--", "src-tauri"])
      .split("\n")
      .filter(Boolean)
      .find((commit) => {
        try {
          return changesNativeCode(commit);
        } catch {
          return true; // root commit or unreadable diff: treat as native
        }
      });
    if (!nativeCommit) return appVersion;

    const isBump = (commit) => {
      const version = packageVersionAt(commit);
      return version !== null && version !== packageVersionAt(`${commit}^1`);
    };

    if (isBump(nativeCommit)) return packageVersionAt(nativeCommit) ?? appVersion;

    // Bumps after the native change, newest first: the last one is the first bump.
    const laterBumps = git(["log", "--first-parent", "--format=%H", `${nativeCommit}..HEAD`, "--", "package.json"])
      .split("\n")
      .filter(Boolean)
      .filter(isBump);
    const firstBump = laterBumps.at(-1);
    return (firstBump && packageVersionAt(firstBump)) || appVersion;
  } catch (error) {
    console.warn(`Could not derive min_binary_version from git (${error.message}), using the app version`);
    return appVersion;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  console.log(resolveAutoMinBinaryVersion(appVersion));
}
