#!/bin/sh
# Windows x64 NSIS installer and portable exe, cross-compiled on Linux. Runs
# inside the `windows` image of ci/build/Dockerfile; start it with
# `FG_CHANNEL=... sh ci/build/run.sh windows`.
. ci/build/common.sh

# With several codegen units, the rust_panic type descriptor lands first or
# last in .data at random, so the exe differs between builds.
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
# /Brepro: no link timestamp, content hash instead. No PDB: lld hashes it into
# the exe's debug GUID, and it records rustc's random response-file paths.
export RUSTFLAGS="$RUSTFLAGS --remap-path-prefix=/opt/xwin=/xwin -Clink-arg=/Brepro -Clink-arg=/DEBUG:NONE -Clink-arg=/threads:1"
# clang-cl only takes GCC-style flags behind /clang:. cargo-xwin passes
# CL_FLAGS to the Windows target's C/C++ compiles only.
unset CFLAGS CXXFLAGS
export CL_FLAGS="/clang:-ffile-prefix-map=/opt/cargo=/cargo /clang:-ffile-prefix-map=/work=/free-grind /clang:-ffile-prefix-map=/opt/xwin=/xwin"
install -m 0755 ci/build/windows/makensis /usr/local/bin/makensis

target="$CARGO_TARGET_DIR/x86_64-pc-windows-msvc/release"
rm -rf "$target/bundle" "$out/windows"
mkdir -p "$out/windows"
bunx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis

set -- "$target"/bundle/nsis/*-setup.exe
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "expected one installer from tauri, found $#" >&2; exit 1; }
cp "$1" "$out/windows/free-grind-v$version-windows-x64-setup.exe"
# The portable exe; releases also publish it as the manager/client/child copies.
cp "$target/free-grind.exe" "$out/windows/free-grind-v$version-windows-x64.exe"

echo
(cd "$out/windows" && sha256sum -- *)
