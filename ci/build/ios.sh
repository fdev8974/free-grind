#!/bin/bash
# Unsigned iOS IPA. Runs on macOS with Xcode 26.6 selected (`xcode-select -s`),
# plus rustup, Bun (version in package.json), Node (.node-version), jq and rsync:
#
#   FG_CHANNEL=main bash ci/build/ios.sh
#
# Apple's toolchain only runs on macOS, so unlike ci/build/run.sh there's no
# container. The build runs in a copy of the checkout at a fixed path instead,
# with fixed crate and DerivedData paths: Swift and Xcode record absolute paths
# in the app, which would otherwise differ from Mac to Mac.
# Output: out/ios/free-grind-v<version>-unsigned.ipa
# No pipefail, like the workflow steps this came from: several `| head -n 1`
# below would fail when the left side gets SIGPIPE.
set -eu

: "${FG_CHANNEL:?FG_CHANNEL must be set (see BUILDINFO.txt of the release)}"
repo="$(cd "$(dirname "$0")/../.." && pwd -P)"
root=/tmp/free-grind-ios
export CARGO_HOME=/tmp/free-grind-ios-cargo
derived=/tmp/free-grind-ios-derived

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
# Xcode 26's bundled MetalToolchain shadows the Swift back-deployment
# compatibility libs (swiftCompatibility51/56/Concurrency), causing
# "undefined symbol __swift_FORCE_LOAD_$_swiftCompatibility*" link errors
# against the Rust-built libapp.a. Forcing the default toolchain restores
# those libs. See actions/runner-images#13135.
export TOOLCHAINS=com.apple.dt.toolchain.XcodeDefault

# Build outputs and dependencies are recreated in the copy, never carried over.
mkdir -p "$root"
rsync -a --delete --exclude /out --exclude /node_modules --exclude /dist \
	--exclude /src-tauri/target --exclude /.bun-cache "$repo/" "$root/"
cd "$root"
git checkout -q -- src-tauri/gen/apple

version="$(jq -r '.version' package.json)"
# Apple only accepts dot-separated integers in the bundle versions, so
# `1.0.0-beta.2` is split: CFBundleShortVersionString gets the plain `1.0.0`,
# and CFBundleVersion a build number that grows with every commit, which keeps
# successive betas of one version ordered. The app itself (hotswap, update
# prompt) still reads the full semver from package.json.
short_version="${version%%[-+]*}"
build_number="$(git rev-list --count HEAD)"
if ! [[ "$short_version" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
	echo "Cannot derive an iOS bundle version from '$version'" >&2
	exit 1
fi
SOURCE_DATE_EPOCH="$(git log -1 --pretty=%ct)"
export SOURCE_DATE_EPOCH

rustup target add aarch64-apple-ios
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
bun run build

# `tauri ios init` regenerates gen/apple from Tauri's templates, which drops
# our committed customizations (project.yml with the app-disguise alternate
# icons, AppIcon-* sets, LaunchScreen). Restore them.
rm -rf src-tauri/gen/apple
bunx tauri ios init --ci
git checkout -- src-tauri/gen/apple
# Keep the bundle version in sync with package.json instead of the value
# hardcoded in project.yml.
sed -i '' \
	-e "s/CFBundleShortVersionString: .*/CFBundleShortVersionString: \"$short_version\"/" \
	-e "s/CFBundleVersion: .*/CFBundleVersion: \"$build_number\"/" \
	src-tauri/gen/apple/project.yml
# xcodegen fails on source paths that don't exist yet; Externals is filled
# with the prebuilt Rust library below.
mkdir -p src-tauri/gen/apple/Externals/arm64/release \
	src-tauri/gen/apple/Externals/x86_64/release \
	src-tauri/gen/apple/assets

# Pinned release instead of whatever Homebrew has today.
tools="$(mktemp -d)"
trap 'rm -rf "$tools"' EXIT
curl -fsSL -o "$tools/xcodegen.zip" https://github.com/yonaskolb/XcodeGen/releases/download/2.46.0/xcodegen.zip
echo "4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806  $tools/xcodegen.zip" | shasum -a 256 -c -
unzip -q "$tools/xcodegen.zip" -d "$tools"
(cd src-tauri/gen/apple && "$tools/xcodegen/bin/xcodegen" generate)

# The Tauri CLI normally merges src-tauri/Info.plist during `tauri ios build`;
# this build bypasses it. Without the NS*UsageDescription keys iOS kills the
# app on the first camera/mic/location/photos access.
info_plist="$(find src-tauri/gen/apple -path '*_iOS/Info.plist' | head -n 1)"
[ -n "$info_plist" ] || { echo "Generated iOS Info.plist not found under src-tauri/gen/apple" >&2; exit 1; }
# PlistBuddy's Merge skips keys that already exist, so delete them first to
# let src-tauri/Info.plist win.
for key in $(plutil -convert json -o - src-tauri/Info.plist | jq -r 'keys[]'); do
	/usr/libexec/PlistBuddy -c "Delete :$key" "$info_plist" 2>/dev/null || true
done
/usr/libexec/PlistBuddy -c "Merge src-tauri/Info.plist" "$info_plist"
plutil -lint "$info_plist" >/dev/null

# The Rust library. `custom-protocol` is what `tauri build` enables
# automatically; without it the app is a dev build and loads devUrl.
export RUSTFLAGS="--remap-path-prefix=$CARGO_HOME=/cargo --remap-path-prefix=$root=/free-grind"
export CFLAGS="-ffile-prefix-map=$CARGO_HOME=/cargo -ffile-prefix-map=$root=/free-grind"
export CXXFLAGS="$CFLAGS"
# One codegen unit, as on Windows, where several units placed some symbols
# differently from build to build.
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
cargo build --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios --release --features custom-protocol
lib=src-tauri/target/aarch64-apple-ios/release/libopen_grind_lib.a
cp "$lib" src-tauri/gen/apple/Externals/arm64/release/libapp.a
# Keep xcodebuild happy if the generated project still references both arch outputs.
cp "$lib" src-tauri/gen/apple/Externals/x86_64/release/libapp.a

# Xcode's "Build Rust Code" phase would call the Tauri CLI again; point it at
# the library built above instead.
pbxproj="$(find src-tauri/gen/apple -maxdepth 3 -name project.pbxproj | head -n 1)"
[ -n "$pbxproj" ] || { echo "project.pbxproj not found under src-tauri/gen/apple" >&2; exit 1; }
awk '
	BEGIN { replaced = 0 }
	/tauri ios xcode-script/ {
		print "\t\t\tshellScript = \"set -e\\nLIB_PATH=\\\"$SRCROOT/Externals/arm64/release/libapp.a\\\"\\nif [ ! -f \\\"$LIB_PATH\\\" ]; then\\n  echo \\\"Missing prebuilt Rust library at $LIB_PATH\\\"\\n  exit 1\\nfi\";"
		replaced = 1
		next
	}
	{ print }
	END { if (replaced == 0) exit 2 }
' "$pbxproj" > "$tools/project.pbxproj" || { echo "Failed to replace the Build Rust Code script" >&2; exit 1; }
mv "$tools/project.pbxproj" "$pbxproj"
plutil -lint "$pbxproj" >/dev/null

workspace="$(find src-tauri/gen/apple -maxdepth 2 -name '*.xcworkspace' | head -n 1)"
if [ -n "$workspace" ]; then
	project_args=(-workspace "$workspace")
else
	project_args=(-project "$(find src-tauri/gen/apple -maxdepth 2 -name '*.xcodeproj' | head -n 1)")
fi
schemes="$(xcodebuild "${project_args[@]}" -list | awk '/Schemes:/ {flag=1; next} flag && NF {gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print}')"
scheme="$(printf '%s\n' "$schemes" | grep -Ei '(^|_|-)ios$|_iOS$|iOS' | head -n 1 || true)"
[ -n "$scheme" ] || scheme="$(printf '%s\n' "$schemes" | head -n 1)"
[ -n "$scheme" ] || { echo "Failed to resolve the iOS scheme" >&2; exit 1; }
rm -rf "$derived"
xcodebuild "${project_args[@]}" -scheme "$scheme" -configuration release \
	-destination 'generic/platform=iOS' -derivedDataPath "$derived" \
	CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
	OTHER_LDFLAGS='$(inherited) -Wl,-objc_stubs_small' \
	build
# ^ The default fast objc_msgSend selector stubs get their own GOT slot for
# _objc_msgSend next to the regular stub's, and the linker orders the two at
# random. Small stubs branch through the regular stub, leaving one slot.
app="$(find "$derived/Build/Products" -maxdepth 2 -type d -name '*.app' | grep -E '/(release|Release)-iphoneos/' | head -n 1)"
[ -n "$app" ] || { echo "No release .app in $derived/Build/Products" >&2; exit 1; }

# The IPA, the same bytes on every build: sorted entries, mtimes from the
# commit, no extra attributes (-X), and UTC because zip stores local time.
mkdir -p "$tools/Payload"
cp -R "$app" "$tools/Payload/"
find "$tools/Payload" -exec touch -h -t "$(date -r "$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S)" {} +
mkdir -p "$repo/out/ios"
ipa="$repo/out/ios/free-grind-v$version-unsigned.ipa"
rm -f "$ipa"
(cd "$tools" && find Payload | LC_ALL=C sort | /usr/bin/zip -qXy "$ipa" -@)

echo
(cd "$repo/out/ios" && shasum -a 256 -- *)
