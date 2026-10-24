#!/bin/sh
# Checks that independent builds of one commit produced byte-identical files,
# then copies them to <result dir>. CI runs it before signing or publishing.
#
#   sh ci/compare.sh <result dir> <build dir> <build dir> [<build dir>...]
set -eu

[ "$#" -ge 3 ] || { echo "usage: compare.sh <result dir> <build dir> <build dir>..." >&2; exit 2; }
result=$1
shift

digests() { (cd "$1" && find . -type f | LC_ALL=C sort | xargs -r -d '\n' sha256sum); }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
digests "$1" > "$tmp/reference"
[ -s "$tmp/reference" ] || { echo "no files in $1" >&2; exit 1; }
echo "$1:"
cat "$tmp/reference"
status=0
for dir in "$@"; do
	[ "$dir" = "$1" ] && continue
	digests "$dir" > "$tmp/other"
	if cmp -s "$tmp/reference" "$tmp/other"; then
		echo "$dir: identical"
	else
		echo "$dir: DIFFERENT" >&2
		diff -u --label "$1" --label "$dir" "$tmp/reference" "$tmp/other" >&2 || true
		status=1
	fi
done
[ "$status" -eq 0 ] || { echo "builds are not reproducible, refusing to publish" >&2; exit 1; }

mkdir -p "$result"
cp -R "$1"/. "$result"/
