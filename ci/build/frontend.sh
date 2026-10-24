#!/bin/sh
# OTA frontend bundle (frontend.tar.gz). Runs inside the `frontend` image of
# ci/build/Dockerfile; start it with `FG_CHANNEL=... sh ci/build/run.sh frontend`.
# scripts/publish-ota.mjs signs and uploads this file (OTA_BUNDLE).
. ci/build/common.sh

rm -rf "$out/frontend"
mkdir -p "$out/frontend"
bun run build
sh ci/build/pack-frontend.sh dist "$out/frontend/frontend.tar.gz"

echo
(cd "$out/frontend" && sha256sum -- *)
