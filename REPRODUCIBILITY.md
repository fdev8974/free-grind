# Reproducible builds

A reproducible build lets you confirm that a published Free Grind download was built from the published source code, and nothing else. You rebuild it yourself from the same commit and compare the bytes. That's stronger than trusting a signature: a signature only tells you who built a file, a reproducible build tells you what's in it.

| Artifact                                    | Reproducible | How to check                                  |
| ------------------------------------------- | ------------ | --------------------------------------------- |
| Android APK (`free-grind-v<version>.apk`)   | Yes          | [Android](#android)                           |
| Windows installer and portable exe          | Yes          | [Windows](#windows)                           |
| iOS IPA (unsigned)                          | Yes, on a Mac with Xcode 26.6 | [iOS](#ios)                  |
| Linux `.deb`, `.rpm`, `.AppImage`           | Yes          | [Linux](#linux)                               |
| OTA frontend bundle (`frontend-*.tar.gz`)   | Yes          | [OTA frontend bundle](#ota-frontend-bundle)   |
| macOS                                       | Not yet      | [Not reproducible yet](#not-reproducible-yet) |

The OTA bundle matters as much as the apps: it replaces the whole user interface of an installed app on every update.

## How releases are built

CI ([release.yml](.github/workflows/release.yml), [ota-branches.yml](.github/workflows/ota-branches.yml)) runs the commands from this page:

1. Two separate runners each build the APK, the Windows installer and exe, the Linux packages and the OTA bundle inside the pinned container from [ci/build/Dockerfile](ci/build/Dockerfile), and two macOS runners each build the iOS IPA with [ci/build/ios.sh](ci/build/ios.sh).
2. [ci/compare.sh](ci/compare.sh) checks that both builds are byte-identical. If they differ, nothing is published.
3. Only then is the APK signed and the OTA bundle signed and uploaded. CI checks that the signed APK is exactly the unsigned build plus a signature, using the same `apksigcopier` check you run below.

Every release lists what it was built from in two assets:

- `BUILDINFO.txt`: the commit, `FG_CHANNEL` (the default update channel baked into the app) and `SOURCE_DATE_EPOCH`
- `SHA256SUMS`: the checksums of every file both builders agreed on, plus the signed APK
- `SHA256SUMS.minisig`: the release key's signature over `SHA256SUMS` ([KEYS.md](./KEYS.md) shows how to check it)

## What you need

- Linux on x86_64
- [Podman](https://podman.io) (recommended, rootless) or Docker
- Free disk space: about 5 GB for Linux, about 6 GB for Windows, about 12 GB for Android, 1 GB for the OTA bundle
- Network access: the container image downloads its pinned tools, and the builds download the locked dependencies

As a reference, on a 3-core machine with 11 GB of RAM the Rust part of the Linux build took 6½ minutes, the Windows build 7 minutes from scratch, the Android build 12 minutes from scratch, and the OTA bundle under a minute. Building the container image the first time adds a few minutes.

```bash
git clone --recurse-submodules https://github.com/fdev8974/free-grind.git
cd free-grind
git checkout <commit from BUILDINFO.txt>
git submodule update --init
```

Use a clean checkout. The build stops if it finds the release keystore, and it ignores local `.env` files.

## Android

The published APK is the reproducible build plus a v2 signature. A signature can't be reproduced without the private key, so [apksigcopier](https://github.com/obfusk/apksigcopier) copies it from the published APK onto your build. If that gives back the published file byte for byte, everything apart from the signature is identical.

You need `apksigcopier` (`apt install apksigcopier` or `pip install apksigcopier`) and `apksigner` from the Android SDK build-tools.

```bash
# 1. Build the unsigned APK
FG_CHANNEL=<from BUILDINFO.txt> sh ci/build/run.sh android
LOCAL=out/android/free-grind-v<version>-android-arm64-unsigned.apk

# 2. Download free-grind-v<version>.apk from the release
PUBLISHED=/path/to/free-grind-v<version>.apk

# 3. Copy the signature onto your build and compare
apksigcopier copy "$PUBLISHED" "$LOCAL" check.apk
cmp check.apk "$PUBLISHED" && echo "✓ the published APK is this build plus its signature"

# 4. Check who signed it
apksigner verify --print-certs "$PUBLISHED" | grep 'SHA-256'
# -> Signer #1 certificate SHA-256 digest: 7ce9e5cdac620ec798bea6749aed4c6d59bf12ab5e1dc8cb59c117bb929fc9d0
```

`sha256sum "$LOCAL"` also matches the `…-unsigned.apk` line in the release's `SHA256SUMS`.

## Windows

The Windows build is cross-compiled in the Linux container with [cargo-xwin](https://github.com/rust-cross/cargo-xwin), against Microsoft's MSVC runtime and Windows SDK in fixed versions. The installer and the exe aren't signed, so the whole file has to match.

```bash
FG_CHANNEL=<from BUILDINFO.txt> sh ci/build/run.sh windows

cmp out/windows/free-grind-v<version>-windows-x64-setup.exe /path/to/free-grind-v<version>-windows-x64-setup.exe \
  && echo "✓ installer matches"
# The release ships the portable exe three times, as the manager, client and
# child copies (the app picks its mode from its file name); all three are this file.
cmp out/windows/free-grind-v<version>-windows-x64.exe /path/to/free-grind-manager-v<version>-windows-x64.exe \
  && echo "✓ exe matches"
```

## iOS

Apple's toolchain only runs on macOS, so the IPA can't be built in the container. [ci/build/ios.sh](ci/build/ios.sh) builds it on a Mac instead, in a copy of the checkout at a fixed path (`/tmp/free-grind-ios`), because Swift and Xcode record absolute paths in the app. It needs:

- macOS on Apple Silicon with **Xcode 26.6** selected (`sudo xcode-select -s /Applications/Xcode_26.6.app`); the script refuses any other version
- rustup, Bun and Node in the versions this page lists, plus `jq`
- a full clone, not a shallow one: the build number is the commit count

The IPA is published unsigned (you sign it when you sideload it), so the whole file has to match.

```bash
FG_CHANNEL=<from BUILDINFO.txt> bash ci/build/ios.sh
cmp out/ios/free-grind-v<version>-unsigned.ipa /path/to/free-grind-v<version>-unsigned.ipa && echo "✓ IPA matches"
```

## Linux

The `.deb`, `.rpm` and `.AppImage` aren't signed, so the whole file has to match.

```bash
FG_CHANNEL=<from BUILDINFO.txt> sh ci/build/run.sh linux

# Download the three Linux files from the release into one directory
PUBLISHED=/path/to/downloads
for LOCAL in out/linux/*; do
  name="$(basename "$LOCAL")"
  cmp "$LOCAL" "$PUBLISHED/$name" && echo "✓ $name matches"
done
```

## OTA frontend bundle

Installed apps download their user interface as `frontend-<sequence>.tar.gz` from the update server, and stable releases attach the same file as `frontend-<version>-ota.main.<sequence>.tar.gz`. The detached `.sig` next to it is a minisign signature over the file, so the file itself has to match.

```bash
# FG_CHANNEL is the OTA channel: main or development
FG_CHANNEL=<channel> sh ci/build/run.sh frontend
cmp out/frontend/frontend.tar.gz /path/to/frontend-<...>.tar.gz && echo "✓ bundle matches"
```

For a bundle on the update server, `https://freegrind-ota-<channel>.surge.sh/latest.json` links the current file. Build from the commit it was published from (the `OTA_NOTES` in the manifest name it).

## Trusting the build environment

The rebuild runs tools you have to trust. Each one is pinned to a version and a checksum, so you can check them before running anything.

| Component                 | Version                  | Pinned in                                                           |
| ------------------------- | ------------------------ | ------------------------------------------------------------------- |
| Base image                | Debian 12 (bookworm)     | `ci/build/Dockerfile`, by `@sha256` digest                          |
| Debian packages           | snapshot of 2026-10-10   | `ci/build/Dockerfile` (`SNAPSHOT`, snapshot.debian.org)             |
| Rust                      | 1.97.1                   | `rust-toolchain.toml`; rustup verifies the downloads                |
| Node.js (runs Vite)       | 24.21.0                  | `.node-version`, checksum in `ci/build/Dockerfile`                  |
| Bun                       | 1.3.14                   | `packageManager` in `package.json`, checksum in `ci/build/Dockerfile` |
| JDK                       | Temurin 21.0.12.1+1      | `ci/build/Dockerfile`, with checksum                                |
| Android SDK, NDK          | platform 36, build-tools 36.0.0, NDK 29.0.14206865 | `ci/build/Dockerfile`, `build.gradle.kts`; sdkmanager verifies the downloads |
| Gradle                    | 8.14.3                   | `gradle-wrapper.properties`, with `distributionSha256Sum`           |
| AppImage runtime          | type2-runtime 20251108   | `ci/build/Dockerfile`, with checksum                                |
| Windows: clang-cl, lld-link | LLVM 19.1.7 (Debian)   | `ci/build/Dockerfile`, Debian snapshot                              |
| Windows: MSVC CRT, Windows SDK | CRT 14.44.17.14, SDK 10.0.26100 | `XWIN_CRT_VERSION`, `XWIN_SDK_VERSION` in `ci/build/Dockerfile`; xwin checks Microsoft's hashes |
| Windows: cargo-xwin       | 0.23.1                   | `ci/build/Dockerfile`, built with `cargo install --locked`          |
| Windows: NSIS             | 3.11                     | `ci/build/Dockerfile`: tauri's `nsis-3.11.zip` and the official source, both with checksums |
| iOS: Xcode                | 26.6 (iOS SDK included)  | checked by `ci/build/ios.sh`; CI selects it on the `macos-26` image  |
| iOS: xcodegen             | 2.46.0                   | `ci/build/ios.sh`, with checksum                                     |
| JS dependencies           | —                        | `bun.lock`                                                          |
| Rust crates               | —                        | `src-tauri/Cargo.lock`                                              |
| Android libraries         | —                        | fixed versions in `src-tauri/gen/android/app/build.gradle.kts`      |

Two checks you can do by hand:

- **Gradle wrapper.** `src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar` runs before anything else in the Android build. Its SHA-256 is `e996d452d2645e70c01c11143ca2d3742734a28da2bf61f25c82bdc288c9e637`, which is the official wrapper of Gradle 6.9–7.0 according to [Gradle's checksum list](https://gradle.org/release-checksums/). It then downloads Gradle 8.14.3 and checks it against `distributionSha256Sum`.
- **Base image.** The digest in the Dockerfile is the multi-arch index of `debian:bookworm-20261005-slim` on Docker Hub: `docker buildx imagetools inspect debian:bookworm-20261005-slim`.

## What the build does to be reproducible

For anyone changing the build. Each of these was needed to get identical bytes:

- **Fixed environment:** the container, plus `TZ=UTC`, `LC_ALL=C`, `umask 022` ([ci/build/common.sh](ci/build/common.sh)).
- **Clean compiler outputs:** each container image builds into its own `out/cargo-target/<artifact>`, which is wiped when the image changes. Cargo doesn't notice a different C compiler, so objects left by an older image or a host build would otherwise end up in the binary.
- **Timestamps:** `SOURCE_DATE_EPOCH` is the commit time, used for package and archive timestamps.
- **Paths:** `--remap-path-prefix` (Rust) and `-ffile-prefix-map` (C, including BoringSSL) record the checkout as `/free-grind` and the crates as `/cargo`.
- **Frontend:** Vite runs under Node, because Bun's built-in Node hashes chunks differently. Local `.env` files are ignored (`FG_REPRODUCIBLE_BUILD` in `vite.config.mjs`).
- **OTA bundle:** packed by [ci/build/pack-frontend.sh](ci/build/pack-frontend.sh) with sorted entries, a fixed owner, fixed modes and fixed mtimes, and gzip without a timestamp.
- **Linux packages:** tauri's bundler stamps the current time into packages and downloads an unpinned `linuxdeploy` for AppImages. [ci/build/linux.sh](ci/build/linux.sh) therefore repacks the `.deb`, builds the `.rpm` with `rpmbuild`, and assembles the AppImage around the pinned runtime. The AppImage uses the system's WebKitGTK and GStreamer, like the `.deb` and `.rpm`.
- **Windows:** one codegen unit (otherwise a panic type descriptor lands at a random place in `.data`), `/Brepro` instead of a link timestamp, no PDB, and path remapping through `/clang:` flags for clang-cl ([ci/build/windows.sh](ci/build/windows.sh)). NSIS records every installed file's mtime, so [a wrapper](ci/build/windows/makensis) sets them to the commit time first. makensis is built with `VERSION=3.11`, since its version string ends up in the installer.
- **iOS:** one codegen unit for the Rust library (otherwise the linker orders imported symbols differently, e.g. `objc_msgSend`'s GOT slot), a fixed build path, and an IPA zip with sorted entries, the commit time as mtime and no extra attributes.
- **Android:** the baseline profile and Kotlin tooling metadata are switched off, because they differ between builds. Build-tools and NDK versions are set explicitly so AGP can't pick its own. The release network security config lives in `ci/build/android/` and is swapped in by the build script, not by CI.

## Not reproducible yet

- **macOS** is built on GitHub's `macos-26` runner image with Xcode 26.6 selected explicitly, so the toolchain is pinned, but the output isn't reproducible yet.
- The **manual "Build Artifacts" workflow** produces test builds on the runner images; they aren't releases.
