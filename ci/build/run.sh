#!/bin/sh
# Builds a release artifact inside the pinned container (ci/build/Dockerfile).
# CI and anyone verifying a release run exactly this.
#
#   FG_CHANNEL=main sh ci/build/run.sh linux|android|frontend
#
# FG_CHANNEL is the default update channel baked into the frontend: `main` for
# releases built from the main branch, `development` otherwise (OTA bundles use
# the channel they're published to). A release's BUILDINFO.txt says which.
#
# Uses podman when it's installed, docker otherwise (FG_CONTAINER_ENGINE
# overrides). Outputs land in out/<artifact>/.
set -eu

artifact="${1:-}"
case "$artifact" in
linux | android | frontend) ;;
*)
	echo "usage: FG_CHANNEL=<main|development> sh ci/build/run.sh <linux|android|frontend>" >&2
	exit 2
	;;
esac
# Same rule as OTA channel names in scripts/publish-ota.mjs.
if ! printf '%s' "${FG_CHANNEL:-}" | grep -Eqx '[a-z0-9-]{1,40}'; then
	echo "FG_CHANNEL must be the update channel, usually main or development (see BUILDINFO.txt of the release)" >&2
	exit 2
fi

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$root"

engine="${FG_CONTAINER_ENGINE:-}"
if [ -z "$engine" ]; then
	if command -v podman >/dev/null 2>&1; then engine=podman; else engine=docker; fi
fi

rust_version="$(sed -n 's/^channel = "\(.*\)"$/\1/p' rust-toolchain.toml)"
bun_version="$(sed -n 's/^ *"packageManager": "bun@\(.*\)",$/\1/p' package.json)"
node_version="$(cat .node-version)"
: "${rust_version:?no channel in rust-toolchain.toml}"
: "${bun_version:?no packageManager in package.json}"

image="free-grind-build-$artifact"
"$engine" build --target "$artifact" -t "$image" \
	--build-arg RUST_VERSION="$rust_version" \
	--build-arg BUN_VERSION="$bun_version" \
	--build-arg NODE_VERSION="$node_version" \
	ci/build

# Rootful docker writes into the checkout as root; hand the outputs back to the
# caller afterwards. Rootless podman's container root already is the caller.
owner=""
case "$engine" in *docker*) owner="$(id -u):$(id -g)" ;; esac

# :z relabels the checkout for SELinux hosts (Fedora); elsewhere it's a no-op.
"$engine" run --rm \
	-v "$root:/work:z" \
	-e FG_CHANNEL \
	-e FG_OWNER="$owner" \
	"$image" sh "ci/build/$artifact.sh"
