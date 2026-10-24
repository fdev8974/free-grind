# Building Free Grind

This page lists every tool and version the official release builds use, so you can build the same app from source.

There are two ways to build:

- **Release builds** of the Android APK, the Windows installer, the Linux packages and the OTA frontend bundle run in a pinned container (Windows is cross-compiled there). They're reproducible: the same commit gives the same bytes as the published files. To build or check one, see [REPRODUCIBILITY.md](./REPRODUCIBILITY.md).
- **Development builds** run directly on your machine with the toolchain below. They're the same app, but the bytes depend on your machine.

## Pinned inputs

Each input is pinned in one place, which both CI and local tools read:

| Component               | Version         | Where it's pinned                                                  |
| ----------------------- | --------------- | ------------------------------------------------------------------ |
| Rust                    | 1.97.1          | [`rust-toolchain.toml`](./rust-toolchain.toml)                     |
| Bun                     | 1.3.14          | `packageManager` in [`package.json`](./package.json)               |
| Node.js (runs Vite)     | 24.21.0         | [`.node-version`](./.node-version)                                 |
| JS dependencies         | —               | [`bun.lock`](./bun.lock) (the only lockfile; npm/pnpm/yarn ones are ignored) |
| Tauri CLI               | —               | `package.json` / `bun.lock`                                        |
| Cargo dependencies      | —               | [`src-tauri/Cargo.lock`](./src-tauri/Cargo.lock), CI checks it with `--locked` |
| Patched crates          | —               | `src-tauri/*-patched/`, [`.cargo-patches/`](./.cargo-patches)      |
| Google OAuth extension  | —               | git submodule commit (`src-tauri/vendor/`)                         |
| Android SDK platform    | 36              | `src-tauri/gen/android/app/build.gradle.kts`, `ci/build/Dockerfile` |
| Android build-tools     | 36.0.0          | `src-tauri/gen/android/app/build.gradle.kts`, `ci/build/Dockerfile` |
| Android NDK             | 29.0.14206865   | `src-tauri/gen/android/app/build.gradle.kts`, `ci/build/Dockerfile` |
| Gradle                  | 8.14.3          | `src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties`, with checksum |
| Release container (Debian, JDK, LLVM, MSVC CRT/SDK, NSIS, AppImage runtime) | see Dockerfile | [`ci/build/Dockerfile`](./ci/build/Dockerfile), every download with a checksum |
| CI runner images        | Ubuntu 24.04, macOS 26 (Xcode 26.6 selected explicitly) | `runs-on:` in the workflows            |
| GitHub Actions          | —               | commit SHA in the workflows                                        |

To bump Rust, Bun or Node, change the version in its file. The container build then stops at the old checksum in `ci/build/Dockerfile`; update that too.

## Getting the source

The desktop and Android builds compile in a git submodule, so clone with submodules:

```bash
git clone --recurse-submodules https://github.com/fdev8974/free-grind.git
cd free-grind
# for an existing checkout, or after switching tags:
git submodule update --init
```

## Release builds

With Podman or Docker installed:

```bash
FG_CHANNEL=main sh ci/build/run.sh android   # or: windows, linux, frontend
```

The outputs land in `out/<artifact>/`. [REPRODUCIBILITY.md](./REPRODUCIBILITY.md) explains `FG_CHANNEL` and how to compare the outputs with a release.

## Development builds

### Toolchain

- **Rust:** install [rustup](https://rustup.rs). Inside the checkout, rustup reads `rust-toolchain.toml` and installs 1.97.1 by itself (`rustup toolchain install` does it explicitly). Add the target you build for, for example `rustup target add aarch64-linux-android`.
- **Bun:** install exactly the version in `packageManager`:
  ```bash
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
  ```
- **Node.js:** the version in `.node-version` (`nvm install`, `fnm use` and similar tools read it). Vite runs under Node when it's installed.
- **JS dependencies:** always install from the lockfile:
  ```bash
  bun install --frozen-lockfile
  ```

### Linux (x86_64)

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

### Android (arm64-v8a)

You need JDK 21 and an Android SDK with the components from the table above:

```bash
sdkmanager --install "platforms;android-36" "build-tools;36.0.0" "platform-tools" "ndk;29.0.14206865"
rustup target add aarch64-linux-android
bun run build:android:apk
```

Output: `src-tauri/gen/android/app/build/outputs/apk/arm64/release/`

The APK is signed when the project keystore exists at `src-tauri/certs/free-grind-dev.jks` (it isn't in the repository), and unsigned otherwise.

### iOS

See [build-ios.yml](.github/workflows/build-ios.yml). It needs the `aarch64-apple-ios` target and Xcode 26.6 (CI uses the `macos-26` runner). `bun run build:ios:ipa` builds locally.
