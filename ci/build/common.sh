# Sourced by the ci/build/<artifact>.sh scripts inside the container, with the
# checkout mounted at /work. Everything that would otherwise leak the build
# machine into the output (time, locale, paths, local .env files) is fixed here.

set -eu
cd /work

# The mount belongs to the host user; git refuses to read it as root otherwise.
git config --global --add safe.directory /work
git config --global --add safe.directory /work/src-tauri/vendor/freegrind-google-oauth-webextension

# Artifact scripts add their own cleanup by setting cleanup_hook to a function.
cleanup_hook=true
fg_cleanup() {
	"$cleanup_hook" || true
	if [ -n "${FG_OWNER:-}" ]; then
		chown -R "$FG_OWNER" /work/out /work/dist /work/node_modules /work/.bun-cache \
			/work/src-tauri/gen 2>/dev/null || true
	fi
}
trap fg_cleanup EXIT

export TZ=UTC LC_ALL=C LANG=C
umask 022
# Timestamps inside archives and packages come from the commit, not the clock.
SOURCE_DATE_EPOCH="$(git log -1 --pretty=%ct)"
export SOURCE_DATE_EPOCH

# Builds see the checkout at /work and the crates at /opt/cargo; record both
# as fixed names so a different mount point can't change the binaries.
# RUSTFLAGS replaces target.*.rustflags from .cargo/config.toml, so each
# artifact script appends the flags from there it still needs.
export RUSTFLAGS="--remap-path-prefix=/opt/cargo=/cargo --remap-path-prefix=/work=/free-grind"
# rustc's remapping misses C code (BoringSSL bakes __FILE__ into the binary).
prefix_maps="-ffile-prefix-map=/opt/cargo=/cargo -ffile-prefix-map=/work=/free-grind"
export CFLAGS="$prefix_maps" CXXFLAGS="$prefix_maps"

# Local .env files (API keys for development) must not end up in a release
# build; vite.config.mjs skips them when this is set.
export FG_REPRODUCIBLE_BUILD=1
export VITE_HOTSWAP_CHANNEL="${FG_CHANNEL:?FG_CHANNEL must be set}"
export NODE_OPTIONS="--max-old-space-size=4096"

version="$(node -p 'require("./package.json").version')"
out="/work/out"

# bun's hardlinking install fails across the container's overlay and the
# mounted checkout, so the cache lives on the mount and files are copied.
export BUN_INSTALL_CACHE_DIR=/work/.bun-cache
bun install --frozen-lockfile --backend copyfile

echo "Building Free Grind $version (channel $FG_CHANNEL, SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH)"
echo "  node $(node --version), bun $(bun --version)"
if command -v cargo >/dev/null 2>&1; then
	# The app builds compile the submodule in; the frontend bundle doesn't need it.
	if [ ! -f src-tauri/vendor/freegrind-google-oauth-webextension/geckoview/manifest.json ]; then
		echo "The git submodule is missing; run: git submodule update --init" >&2
		exit 1
	fi
	echo "  $(rustc --version)"
	# cargo would otherwise quietly re-resolve an outdated Cargo.lock.
	cargo metadata --locked --format-version 1 --manifest-path src-tauri/Cargo.toml >/dev/null

	# Each image gets its own cargo target dir, wiped when the image changes:
	# cargo doesn't notice a different C compiler, so objects built by an older
	# image (or on the host, in src-tauri/target) would end up in the binary.
	export CARGO_TARGET_DIR="$out/cargo-target/${FG_ARTIFACT:?}"
	if [ "$(cat "$CARGO_TARGET_DIR/.image" 2>/dev/null)" != "${FG_IMAGE_ID:?}" ]; then
		rm -rf "$CARGO_TARGET_DIR"
		mkdir -p "$CARGO_TARGET_DIR"
		echo "$FG_IMAGE_ID" > "$CARGO_TARGET_DIR/.image"
	fi
fi
