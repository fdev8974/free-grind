# Pinned build environment for the reproducible release artifacts (Linux
# packages, Android APK, OTA frontend bundle). Build it through ci/build/run.sh,
# which passes the Rust, Bun and Node versions from their single source of truth
# (rust-toolchain.toml, package.json, .node-version). Bumping one of those also
# means updating its checksum below; the build stops at the mismatch otherwise.
#
# Every download is pinned by version and checksum, and apt reads a fixed
# snapshot.debian.org date, so building this file twice gives the same tools.

FROM debian@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS base
# ^ debian:bookworm-20261005-slim. Bookworm keeps the Linux packages' glibc
# floor at 2.36.

# A snapshot older than the base image fails apt with "held broken packages".
ARG SNAPSHOT=20261010T000000Z
RUN echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${SNAPSHOT} bookworm main" > /etc/apt/sources.list \
	&& echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${SNAPSHOT} bookworm-updates main" >> /etc/apt/sources.list \
	&& echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${SNAPSHOT} bookworm-security main" >> /etc/apt/sources.list \
	&& rm -f /etc/apt/sources.list.d/debian.sources

RUN apt-get -qq -o Acquire::Check-Valid-Until=false -o Acquire::Retries=5 update \
	&& DEBIAN_FRONTEND=noninteractive apt-get -qq install -y --no-install-recommends \
		ca-certificates curl git unzip xz-utils file \
	&& rm -rf /var/lib/apt/lists/*

ARG NODE_VERSION
# node-v24.21.0-linux-x64.tar.xz from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
ARG NODE_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
# vite has to run under Node, not Bun's built-in node: Bun's JavaScriptCore
# hashes chunks differently, so the frontend wouldn't match an official build.
RUN : "${NODE_VERSION:?pass --build-arg NODE_VERSION (ci/build/run.sh does)}" \
	&& curl -fsSL --retry 3 -o /tmp/node.txz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
	&& { echo "${NODE_SHA256}  /tmp/node.txz" | sha256sum -c - \
		|| { echo "Node ${NODE_VERSION} doesn't match NODE_SHA256 in ci/build/Dockerfile" >&2; exit 1; }; } \
	&& tar -xJf /tmp/node.txz -C /opt && mv "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node && rm /tmp/node.txz
ENV PATH=/opt/node/bin:$PATH

ARG BUN_VERSION
# bun-linux-x64.zip from https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/SHASUMS256.txt
ARG BUN_SHA256=951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f
RUN : "${BUN_VERSION:?pass --build-arg BUN_VERSION (ci/build/run.sh does)}" \
	&& curl -fsSL --retry 3 -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" \
	&& { echo "${BUN_SHA256}  /tmp/bun.zip" | sha256sum -c - \
		|| { echo "Bun ${BUN_VERSION} doesn't match BUN_SHA256 in ci/build/Dockerfile" >&2; exit 1; }; } \
	&& unzip -q /tmp/bun.zip -d /opt && mv /opt/bun-linux-x64 /opt/bun && ln -s bun /opt/bun/bunx && rm /tmp/bun.zip
ENV PATH=/opt/bun:$PATH

WORKDIR /work

# --- OTA frontend bundle: Node + Bun are all it needs -----------------------
FROM base AS frontend

# --- Shared by the Rust builds ------------------------------------------------
FROM base AS rust

RUN apt-get -qq -o Acquire::Check-Valid-Until=false -o Acquire::Retries=5 update \
	&& DEBIAN_FRONTEND=noninteractive apt-get -qq install -y --no-install-recommends \
		build-essential clang libclang-dev pkg-config cmake ninja-build perl \
	&& rm -rf /var/lib/apt/lists/*

ARG RUST_VERSION
# rustup-init 1.28.2; rustup itself verifies every toolchain component it downloads.
ARG RUSTUP_INIT_SHA256=20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
RUN : "${RUST_VERSION:?pass --build-arg RUST_VERSION (ci/build/run.sh does)}" \
	&& curl -fsSL --retry 3 -o /tmp/rustup-init https://static.rust-lang.org/rustup/archive/1.28.2/x86_64-unknown-linux-gnu/rustup-init \
	&& echo "${RUSTUP_INIT_SHA256}  /tmp/rustup-init" | sha256sum -c - \
	&& chmod +x /tmp/rustup-init \
	&& /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
		--component rustfmt --component clippy \
	&& rm /tmp/rustup-init
ENV PATH=/opt/cargo/bin:$PATH

# --- Linux .deb / .rpm / .AppImage --------------------------------------------
FROM rust AS linux

RUN apt-get -qq -o Acquire::Check-Valid-Until=false -o Acquire::Retries=5 update \
	&& DEBIAN_FRONTEND=noninteractive apt-get -qq install -y --no-install-recommends \
		libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libxdo-dev libssl-dev \
		libayatana-appindicator3-dev librsvg2-dev \
		libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
		binutils dpkg-dev rpm squashfs-tools \
	&& rm -rf /var/lib/apt/lists/*

# tauri's AppImage bundler downloads linuxdeploy's "continuous" build on every
# run, which can't be pinned; ci/build/linux.sh assembles the AppImage itself
# around this runtime instead.
ARG APPIMAGE_RUNTIME_TAG=20251108
ARG APPIMAGE_RUNTIME_SHA256=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d
RUN curl -fsSL --retry 3 -o /opt/appimage-runtime \
		"https://github.com/AppImage/type2-runtime/releases/download/${APPIMAGE_RUNTIME_TAG}/runtime-x86_64" \
	&& echo "${APPIMAGE_RUNTIME_SHA256}  /opt/appimage-runtime" | sha256sum -c - \
	&& chmod 0644 /opt/appimage-runtime

# --- Android APK ----------------------------------------------------------------
FROM rust AS android

RUN rustup target add aarch64-linux-android

# Temurin 21.0.12.1+1
ARG JDK_URL=https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_linux_hotspot_21.0.12.1_1.tar.gz
ARG JDK_SHA256=ce79869e1307ed8ee1e2baa86a412b1eb5b75d10a01006d788a6f968bcfaee94
RUN curl -fsSL --retry 3 -o /tmp/jdk.tgz "$JDK_URL" \
	&& echo "${JDK_SHA256}  /tmp/jdk.tgz" | sha256sum -c - \
	&& mkdir /opt/jdk && tar -xzf /tmp/jdk.tgz -C /opt/jdk --strip-components=1 && rm /tmp/jdk.tgz
ENV JAVA_HOME=/opt/jdk PATH=/opt/jdk/bin:$PATH

# Keep these in sync with compileSdk, buildToolsVersion and ndkVersion in
# src-tauri/gen/android/app/build.gradle.kts.
ARG ANDROID_PLATFORM=36
ARG ANDROID_BUILD_TOOLS=36.0.0
ARG ANDROID_NDK=29.0.14206865
ARG CMDLINE_TOOLS_BUILD=16111833
ARG CMDLINE_TOOLS_SHA256=0877a1d048fe4a24efe2eff536ca4223f7adeb58648bb81909d33c446918cfa8
ENV ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk
RUN curl -fsSL --retry 3 -o /tmp/clt.zip "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_BUILD}_latest.zip" \
	&& echo "${CMDLINE_TOOLS_SHA256}  /tmp/clt.zip" | sha256sum -c - \
	&& mkdir -p "$ANDROID_HOME/cmdline-tools" && unzip -q /tmp/clt.zip -d "$ANDROID_HOME/cmdline-tools" \
	&& mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" && rm /tmp/clt.zip \
	&& yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null \
	&& "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install \
		"platforms;android-${ANDROID_PLATFORM}" "build-tools;${ANDROID_BUILD_TOOLS}" "ndk;${ANDROID_NDK}" >/dev/null \
	&& "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --list_installed
ENV NDK_HOME=/opt/android-sdk/ndk/${ANDROID_NDK} \
	ANDROID_NDK_HOME=/opt/android-sdk/ndk/${ANDROID_NDK} \
	PATH=/opt/android-sdk/build-tools/${ANDROID_BUILD_TOOLS}:$PATH
