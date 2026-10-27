#!/bin/bash
# macOS universal app as a zip. Runs on macOS with Xcode 26.6 selected
# (`xcode-select -s`), plus rustup, Bun (version in package.json), Node
# (.node-version) and rsync:
#
#   FG_CHANNEL=main bash ci/build/macos.sh
#
# Like ci/build/ios.sh, it builds in a copy of the checkout at a fixed path,
# with fixed crate paths, since the build records absolute paths.
# Output: out/macos/free-grind-v<version>-macos-universal.zip
# Tauri signs the bundle ad-hoc (signingIdentity "-" in tauri.conf.json) with
# src-tauri/Entitlements.plist, so macOS asks for microphone, camera and
# location access.
# No pipefail, as in ios.sh.
set -eu

: "${FG_CHANNEL:?FG_CHANNEL must be set (see BUILDINFO.txt of the release)}"
repo="$(cd "$(dirname "$0")/../.." && pwd -P)"
root=/tmp/free-grind-macos
export CARGO_HOME=/tmp/free-grind-macos-cargo

# Read all of it: xcodebuild crashes on a pipe that closes early (`| head`).
xcode="$(xcodebuild -version)"
xcode="${xcode%%$'\n'*}"
if [ "$xcode" != "Xcode 26.6" ]; then
	echo "Release builds use Xcode 26.6, this is $xcode; select it with xcode-select -s" >&2
	exit 1
fi
if [ ! -f "$repo/src-tauri/vendor/freegrind-google-oauth-webextension/geckoview/manifest.json" ]; then
	echo "The git submodule is missing; run: git submodule update --init" >&2
	exit 1
fi

export TZ=UTC LC_ALL=C LANG=C
export FG_REPRODUCIBLE_BUILD=1 VITE_HOTSWAP_CHANNEL="$FG_CHANNEL"

# Build outputs and dependencies are recreated in the copy, never carried over.
mkdir -p "$root"
rsync -a --delete --exclude /out --exclude /node_modules --exclude /dist \
	--exclude /src-tauri/target --exclude /.bun-cache "$repo/" "$root/"
cd "$root"
version="$(node -p 'require("./package.json").version')"
SOURCE_DATE_EPOCH="$(git log -1 --pretty=%ct)"
export SOURCE_DATE_EPOCH

rustup target add aarch64-apple-darwin x86_64-apple-darwin
# The copy's target dir survives between runs; cargo doesn't notice a new C
# compiler, so start over whenever Xcode or Rust changes.
stamp="$xcode / $(rustc --version)"
if [ "$(cat src-tauri/target/.fg-stamp 2>/dev/null)" != "$stamp" ]; then
	rm -rf src-tauri/target
	mkdir -p src-tauri/target
	echo "$stamp" > src-tauri/target/.fg-stamp
fi
# cargo would otherwise quietly re-resolve an outdated Cargo.lock.
cargo metadata --locked --format-version 1 --manifest-path src-tauri/Cargo.toml >/dev/null
bun install --frozen-lockfile

# Per-target flags rather than RUSTFLAGS, which would drop target.*.rustflags
# from .cargo/config.toml; aarch64 keeps its -ld_classic from there.
remaps="--remap-path-prefix=$CARGO_HOME=/cargo --remap-path-prefix=$root=/free-grind"
export CARGO_TARGET_AARCH64_APPLE_DARWIN_RUSTFLAGS="-C link-args=-Wl,-ld_classic $remaps"
export CARGO_TARGET_X86_64_APPLE_DARWIN_RUSTFLAGS="$remaps"
export CFLAGS="-ffile-prefix-map=$CARGO_HOME=/cargo -ffile-prefix-map=$root=/free-grind"
export CXXFLAGS="$CFLAGS"
# One codegen unit, as on Windows and iOS.
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1

bundle=src-tauri/target/universal-apple-darwin/release/bundle/macos
rm -rf "$bundle"
bunx tauri build --target universal-apple-darwin --bundles app

set -- "$bundle"/*.app
[ "$#" -eq 1 ] && [ -d "$1" ] || { echo "expected one .app from tauri, found $#" >&2; exit 1; }
app="$1"

# The zip, the same bytes on every build: sorted entries, mtimes from the
# commit, no extra attributes (-X), and UTC because zip stores local time.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
cp -R "$app" "$staging/"
find "$staging" -exec touch -h -t "$(date -r "$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S)" {} +
mkdir -p "$repo/out/macos"
zip_path="$repo/out/macos/free-grind-v$version-macos-universal.zip"
rm -f "$zip_path"
(cd "$staging" && find "$(basename "$app")" | LC_ALL=C sort | /usr/bin/zip -qXy "$zip_path" -@)

echo
(cd "$repo/out/macos" && shasum -a 256 -- *)
