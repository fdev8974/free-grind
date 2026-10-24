#!/bin/sh
# Unsigned arm64-v8a APK. Runs inside the `android` image of
# ci/build/Dockerfile; start it with `FG_CHANNEL=... sh ci/build/run.sh android`.
#
# The APK is built without the release keystore (build.gradle.kts signs only
# when it exists). CI signs it after two builders produced the same bytes;
# REPRODUCIBILITY.md shows how to check a published APK against this output.
. ci/build/common.sh

android=/work/src-tauri/gen/android
# Gradle outputs from a host build (signed, other SDKs) must not leak in either.
rm -rf "$out/android" "$android/app/build"
mkdir -p "$out/android"

if [ -e /work/src-tauri/certs/free-grind-dev.jks ]; then
	echo "src-tauri/certs/free-grind-dev.jks exists; move it aside, this build must stay unsigned" >&2
	exit 1
fi

# Release builds allow cleartext and user-installed CAs; the committed file is
# the development one. Swap it in for the build and put it back afterwards.
nsc=src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml
nsc_backup="$(mktemp)"
cp "$nsc" "$nsc_backup"
restore_nsc() { cp "$nsc_backup" "$nsc"; }
cleanup_hook=restore_nsc
cp ci/build/android/network_security_config.xml "$nsc"

# A fresh Gradle home per build, so nothing cached from another project leaks in.
export GRADLE_USER_HOME=/root/.gradle

bunx tauri android init --ci --skip-targets-install
# arm64-v8a only: GeckoView (Google sign-in) adds ~85 MB per ABI.
bunx tauri android build --apk --split-per-abi --target aarch64

set -- "$android"/app/build/outputs/apk/arm64/release/*-unsigned.apk
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "expected one unsigned APK, found $#" >&2; exit 1; }
cp "$1" "$out/android/free-grind-v$version-android-arm64-unsigned.apk"

echo
(cd "$out/android" && sha256sum -- *)
