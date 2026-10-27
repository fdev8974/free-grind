#!/bin/sh
# Packs a built frontend (dist/) into the OTA bundle, byte for byte the same on
# every machine with GNU tar and gzip: sorted entries, fixed owner and modes,
# mtimes from SOURCE_DATE_EPOCH (the commit time) and no gzip timestamp.
#
#   sh ci/build/pack-frontend.sh <dist dir> <out.tar.gz>
set -eu

src="${1:?usage: pack-frontend.sh <dist dir> <out.tar.gz>}"
dest="${2:?usage: pack-frontend.sh <dist dir> <out.tar.gz>}"
if ! tar --version 2>/dev/null | grep -q 'GNU tar'; then
	echo "pack-frontend.sh needs GNU tar (on macOS: brew install gnu-tar, then put gtar first as tar)" >&2
	exit 1
fi
epoch="${SOURCE_DATE_EPOCH:-$(git log -1 --pretty=%ct)}"

tar --sort=name --format=gnu --mtime="@$epoch" --clamp-mtime \
	--owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' \
	-C "$src" -cf - . | gzip -9n > "$dest"
