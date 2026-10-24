#!/bin/sh
# Linux x86_64 .deb, .rpm and .AppImage. Runs inside the `linux` image of
# ci/build/Dockerfile; start it with `FG_CHANNEL=... sh ci/build/run.sh linux`.
#
# tauri builds the binary and a .deb, but its bundler stamps wall-clock times
# into every package and fetches unpinned tools for the AppImage, so this
# script repacks the .deb and builds the .rpm and .AppImage from its payload.
. ci/build/common.sh

# Mirrors target.x86_64-unknown-linux-gnu in .cargo/config.toml, which
# RUSTFLAGS (set in common.sh) overrides.
export RUSTFLAGS="$RUSTFLAGS -C link-arg=-fuse-ld=bfd"
# build.rs fails instead of shipping without the video streaming extension.
export FG_REQUIRE_MEDIA_EXTENSION=1

target="$CARGO_TARGET_DIR/release"
rm -rf "$target/bundle" "$out/linux"
mkdir -p "$out/linux"
bunx tauri build --bundles deb

set -- "$target"/bundle/deb/*.deb
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "expected one .deb from tauri, found $#" >&2; exit 1; }
tauri_deb=$1

work="$(mktemp -d)"
root="$work/root"
dpkg-deb --raw-extract "$tauri_deb" "$root"

# Permissions follow the build machine's umask and checkout; fix them.
find "$root" -type d -exec chmod 0755 {} +
find "$root" -path "$root/DEBIAN" -prune -o -type f -exec chmod 0644 {} +
chmod 0755 "$root/usr/bin/free-grind"
find "$root" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +

# tauri sums directory sizes, which depend on the filesystem; Debian policy
# defines Installed-Size as file sizes plus 1 KiB per directory.
files_kib=$(cd "$root" && find . -path ./DEBIAN -prune -o -type f -printf '%s\n' | awk '{ s += int(($1 + 1023) / 1024) } END { print s + 0 }')
dirs=$(cd "$root" && find . -path ./DEBIAN -prune -o -type d -print | wc -l)
sed -i "s/^Installed-Size: .*/Installed-Size: $((files_kib + dirs))/" "$root/DEBIAN/control"
LC_ALL=C sort -k2 -o "$root/DEBIAN/md5sums" "$root/DEBIAN/md5sums"

deb="$out/linux/free-grind-v$version-linux-x64.deb"
dpkg-deb --root-owner-group -Zgzip -z9 --uniform-compression -b "$root" "$deb"

# --- .rpm: same payload and the metadata tauri's rpm bundler wrote ----------
rpm_root="$work/rpm-root"
mkdir -p "$rpm_root"
cp -a "$root/." "$rpm_root/"
rm -rf "$rpm_root/DEBIAN"
# RPM versions can't contain '-'. '_' is a separator to rpm's version
# comparison just like the '-' tauri wrote, so upgrades still order the same.
rpm_version="$(echo "$version" | tr '-' '_')"
spec="$work/free-grind.spec"
{
	echo "Name: free-grind"
	echo "Version: $rpm_version"
	echo "Release: 1"
	echo "Summary: Free Grind is a Grindr Client"
	echo "License: MIT"
	echo "URL: https://github.com/fdev8974/free-grind"
	echo "AutoReqProv: no"
	echo "%description"
	echo "Free Grind is a Grindr Client"
	echo "%install"
	echo "cp -a '$rpm_root/.' %{buildroot}/"
	echo "%files"
	echo "%defattr(-,root,root,-)"
	(cd "$rpm_root" && find . -mindepth 1 -type d -path './usr/lib/Free Grind*' | LC_ALL=C sort | sed 's|^\.\(.*\)$|%dir "\1"|')
	(cd "$rpm_root" && find . -type f | LC_ALL=C sort | sed 's|^\.\(.*\)$|"\1"|')
} > "$spec"
rpmbuild -bb --quiet --target x86_64-linux \
	--define "_topdir $work/rpmbuild" \
	--define "_buildhost reproducible" \
	--define "source_date_epoch_from_changelog 0" \
	--define "use_source_date_epoch_as_buildtime 1" \
	--define "clamp_mtime_to_source_date_epoch 1" \
	--define "_binary_payload w6.gzdio" \
	--define "_build_id_links none" \
	--define "debug_package %{nil}" \
	--define "__os_install_post %{nil}" \
	"$spec"
set -- "$work"/rpmbuild/RPMS/x86_64/*.rpm
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "expected one .rpm from rpmbuild, found $#" >&2; exit 1; }
rpm="$out/linux/free-grind-v$version-linux-x64.rpm"
mv "$1" "$rpm"

# --- .AppImage: the .deb payload plus a pinned runtime, no bundled libraries.
# It uses the system's WebKitGTK and GStreamer like the .deb/.rpm do.
appdir="$work/AppDir"
mkdir -p "$appdir"
cp -a "$root/usr" "$appdir/"
set -- "$appdir"/usr/share/applications/*.desktop
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "expected one .desktop in the payload, found $#" >&2; exit 1; }
desktop=$1
icon="$(sed -n 's/^Icon=//p' "$desktop" | head -1)"
largest_icon="$(find "$appdir/usr/share/icons" -name "$icon.png" -printf '%s %p\n' | sort -rn | head -1 | cut -d' ' -f2-)"
[ -n "$largest_icon" ] || { echo "no $icon.png under usr/share/icons" >&2; exit 1; }
cp "$desktop" "$appdir/"
cp "$largest_icon" "$appdir/$icon.png"
cp "$largest_icon" "$appdir/.DirIcon"
cp ci/build/AppRun "$appdir/AppRun"
chmod 0755 "$appdir/AppRun"
find "$appdir" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
# mksquashfs takes its own timestamps from SOURCE_DATE_EPOCH.
mksquashfs "$appdir" "$work/app.sqfs" -comp zstd -b 128K -noappend -no-progress -no-xattrs \
	-all-root -processors 1 >/dev/null
appimage="$out/linux/free-grind-v$version-linux-x64.AppImage"
cat /opt/appimage-runtime "$work/app.sqfs" > "$appimage"
chmod 0755 "$appimage"

rm -rf "$work"
echo
echo "glibc floor: $(objdump -T "$target/free-grind" | grep -o 'GLIBC_[0-9.]*' | sort -Vu | tail -1)"
(cd "$out/linux" && sha256sum -- *)
