#!/usr/bin/env sh
set -eu

sh scripts/tauri.sh android init --ci --skip-targets-install
# arm64-v8a only, like the release workflow.
sh scripts/tauri.sh android build --apk --split-per-abi --target aarch64 -v

echo "APK output: src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk"
