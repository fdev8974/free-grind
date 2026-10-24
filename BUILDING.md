# Building Free Grind

This page lists every tool and version the official release builds use, so you can build the same app from source. CI ([release.yml](.github/workflows/release.yml)) reads the same pins listed below, not a separate copy.

> [!NOTE]
> All toolchains are pinned, but release artifacts are **not yet bit-for-bit reproducible**: a local build won't always match a published binary byte for byte. See [Status](#status) for what's still missing.

## Pinned inputs

Each input is pinned in one place:

| Component               | Version         | Where it's pinned                                                  |
| ----------------------- | --------------- | ------------------------------------------------------------------ |
| Rust                    | 1.97.1          | [`rust-toolchain.toml`](./rust-toolchain.toml)                     |
| Bun                     | 1.3.14          | `packageManager` in [`package.json`](./package.json)               |
| JS dependencies         | —               | [`bun.lock`](./bun.lock) (the only lockfile; npm/pnpm/yarn ones are ignored) |
| Tauri CLI               | —               | `package.json` / `bun.lock`                                        |
| Cargo dependencies      | —               | [`src-tauri/Cargo.lock`](./src-tauri/Cargo.lock), CI checks it with `--locked` |
| Patched crates          | —               | `src-tauri/*-patched/`, [`.cargo-patches/`](./.cargo-patches)      |
| Google OAuth extension  | —               | git submodule commit (`src-tauri/vendor/`)                         |
| CI runner images        | Ubuntu 24.04, macOS 15, Windows Server 2025 | `runs-on:` in the workflows            |
| JDK (Android)           | Temurin 21      | `release.yml`                                                      |
| Android SDK platform    | 36              | `release.yml`, `src-tauri/gen/android/app/build.gradle.kts`        |
| Android build-tools     | 36.0.0          | `release.yml`                                                      |
| Android NDK             | 29.0.14206865   | `release.yml`                                                      |
| Gradle                  | 8.14.3          | `src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties`   |

To bump Rust or Bun, change the version in that one file. CI and anyone running rustup or `bun` locally will use the new version.

## Getting the source

The desktop and Android builds compile in a git submodule, so clone with submodules:

```bash
git clone --recurse-submodules https://github.com/fdev8974/free-grind.git
cd free-grind
# for an existing checkout, or after switching tags:
git submodule update --init
```

## Toolchain

- **Rust:** install [rustup](https://rustup.rs). Inside the checkout, rustup reads `rust-toolchain.toml` and installs 1.97.1 by itself (`rustup toolchain install` does it explicitly). Add the target you build for, for example `rustup target add aarch64-linux-android`.
- **Bun:** install exactly the version in `packageManager`:
  ```bash
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
  ```
- **JS dependencies:** always install from the lockfile:
  ```bash
  bun install --frozen-lockfile
  ```

## Desktop

### Linux (x86_64)

Same packages as CI on Ubuntu 24.04:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
  build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf rpm
FG_REQUIRE_MEDIA_EXTENSION=1 bunx tauri build --bundles deb,rpm,appimage
```

Output: `src-tauri/target/release/bundle/{deb,rpm,appimage}/`

### Windows (x64)

Besides Rust and Bun, `wreq`'s BoringSSL dependency needs [NASM](https://www.nasm.us/) on `PATH` and [LLVM](https://releases.llvm.org/) with `LIBCLANG_PATH` set (see the note in [README.md](./README.md#local-setup)).

```bash
bunx tauri build --bundles nsis
```

Output: `src-tauri/target/release/bundle/nsis/`

### macOS (universal)

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
bunx tauri build --target universal-apple-darwin --bundles app,dmg
```

Output: `src-tauri/target/universal-apple-darwin/release/bundle/`

## Android (arm64-v8a)

You need JDK 21 and an Android SDK with the components from the table above:

```bash
sdkmanager --install "platforms;android-36" "build-tools;36.0.0" "platform-tools" "ndk;29.0.14206865"
rustup target add aarch64-linux-android
bun run build:android:apk
```

Output: `src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk`

Release APKs are signed with the project keystore, which isn't in the repository. Without it, Gradle produces an unsigned APK.

## iOS

See [build-ios.yml](.github/workflows/build-ios.yml). It needs the `aarch64-apple-ios` target and Xcode on macOS 15. `bun run build:ios:ipa` builds locally.

## Status

Done:

- [x] Rust, Bun, runner OS and Android SDK/NDK versions pinned
- [x] One lockfile per ecosystem (`bun.lock`, `Cargo.lock`), and CI fails if either is out of date
- [x] Build instructions (this page)

Still open before a published binary can be checked byte for byte:

- [ ] A hermetic build environment (container or Nix) instead of GitHub's runner images, which still update preinstalled tools (apt packages, Xcode, the exact JDK 21.x)
- [ ] Deterministic outputs (`SOURCE_DATE_EPOCH`, path remapping, comparing builds across machines)
- [ ] Verification recipes per platform, for example `apksigcopier` for Android, whose signatures can't be reproduced
- [ ] GitHub Actions pinned by commit SHA instead of tag
