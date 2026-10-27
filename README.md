<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Free Grind Icon" width="150" height="150">
</p>

<p align="center">
  <a href="https://discord.gg/cJqTaWPMFF"><img src="https://img.shields.io/discord/1496182396033175823?label=Discord&logo=discord" alt="Discord"></a>
  <a href="https://t.me/freegrind"><img src="https://img.shields.io/badge/Telegram-2CA5E0?style=flat&logo=telegram&logoColor=white" alt="Telegram"></a>
  <a href="https://github.com/fdev8974/free-grind/releases"><img src="https://img.shields.io/github/v/release/fdev8974/free-grind?include_prereleases&sort=semver&logo=github&label=Release" alt="Latest Release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue" alt="License"></a>
  <a href="https://github.com/fdev8974/free-grind/issues"><img src="https://img.shields.io/badge/Issues-GitHub-blue?logo=github" alt="Issues"></a>
</p>

<h1 align="center">Free Grind</h1>

<p align="center">
An unofficial, cross-platform Grindr client — free, libre, ad-free, tracker-free, and community-driven.
</p>

## Introduction

Free Grind is a fully independent Grindr client built with [Tauri](https://tauri.app/) and React, running the same codebase on Windows, Linux, macOS, Android, and iOS. It is not a mod or patch of the official app — it communicates directly with the Grindr API as a native client.

The goal is to provide a privacy-respecting, open, and extensible alternative to the official client, without ads, trackers, or forced upsells.

Free Grind 1.0 is currently in beta. Expect some rough edges, and please [report](#bugs) anything that breaks.

**Documentation, guides and the Grindr API reference: [fdev8974.github.io/free-grind](https://fdev8974.github.io/free-grind/)**

Neither the maintainers nor contributors are affiliated with Grindr LLC.

## Disclaimer

This project is provided with no warranty of any kind. Use at your own risk. We are not responsible for lost chats, account issues, unexpected bans, or any other problems arising from use of this software.

Free Grind does not collect personal data, display ads, or generate revenue of any kind. This project is open source — you can verify all of this yourself.

## Downloads

| Platform     | File                                     |
| ------------ | ---------------------------------------- |
| Android      | `free-grind-v<version>.apk`              |
| iOS / iPadOS | `free-grind-v<version>-unsigned.ipa` (sideload) |
| Windows      | `…-windows-x64-setup.exe` or the portable exe |
| macOS        | `…-macos-universal.zip`                  |
| Linux        | `.AppImage`, `.deb` or `.rpm`            |

Download from the [releases page](https://github.com/fdev8974/free-grind/releases). The 1.0 betas are published as **pre-releases**, so take the release at the top, not the one marked "Latest".

Step-by-step instructions for every platform, including iOS sideloading and Linux video codecs, are in the [download guide](https://fdev8974.github.io/free-grind/guide/download). To build it yourself, see [Development](#development).

## Features

- **[Unlocked grid](https://fdev8974.github.io/free-grind/guide/features/unlocked-grid):** browse the whole grid for free, with filters, name search, double tap to tap and quick actions.
- **[Location spoofing](https://fdev8974.github.io/free-grind/guide/features/location-spoofing):** set your location anywhere in the world, save places and share them in chats.
- **[Views and taps](https://fdev8974.github.io/free-grind/guide/features/interest):** anonymous profile viewers are revealed by matching them with your local history.
- **[Local chat history](https://fdev8974.github.io/free-grind/guide/features/chat-history):** messages and media stay on your device, searchable, exportable and backed up, even after unsends and blocks.
- **Chat:** albums, collections, expiring photos, GIFs, audio messages, video calls, saved phrases, reactions, inbox filters, pinned, archived and hidden chats, and slash commands.
- **[Paid feature bypass](https://fdev8974.github.io/free-grind/guide/features/paid-features):** unsend messages, send more expiring photos and share albums without a subscription.
- **[Chat translation](https://fdev8974.github.io/free-grind/guide/features/translation):** with Google Translate, Gemini, ChatGPT or Claude, per message or automatically.
- **[Automation](https://fdev8974.github.io/free-grind/guide/features/automation):** auto-block by age or keywords, and your own rules for new chats.
- **[Privacy](https://fdev8974.github.io/free-grind/guide/features/privacy):** zero trackers, incognito mode, hidden read receipts, invisible profile views, blurred grid and app disguise.
- **[Sexual health](https://fdev8974.github.io/free-grind/guide/features/sexual-health):** track PrEP doses, encounters, STI tests and appointments, stored only on your device.
- **[Multiple accounts](https://fdev8974.github.io/free-grind/guide/features/multiple-accounts):** switch between accounts, and move a session to a new device with a QR code.
- **Sign in** with email, Google or Facebook, and create new accounts (Android).
- **Customizable:** color scheme, accent color, pure black mode, 2–4 grid columns and optional features.
- **[No ads](https://fdev8974.github.io/free-grind/guide/features/no-ads),** no upsells, no premium version.

## Bugs

> [!WARNING]
> Please read this section before reporting bugs. Some issues are known limitations of the current development stage.

- **iOS**: builds are functional but less tested than Android and desktop.
- **Linux**: videos need an H.264 decoder for GStreamer, see [Video codecs on Linux](https://fdev8974.github.io/free-grind/guide/codecs). Video calls aren't supported, because WebKitGTK has no WebRTC.
- **Grindr API**: some server-side fields and WebSocket events are still undocumented and may display incorrectly.

> [!TIP]
> Bug reports and feature requests are tracked on [GitHub Issues](https://github.com/fdev8974/free-grind/issues). Please check there first to see if your issue is already known before opening a new one. You can also report bugs from inside the app under **Settings → Report Bug or Feature**. For community discussion, join us on [Discord](https://discord.gg/cJqTaWPMFF) or [Telegram](https://t.me/freegrind).

## Development

Interested in contributing? Head to [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.

### Local Setup

```bash
bun install
```

> [!NOTE]
> Building the desktop app on Windows also requires, for `wreq`'s transitive `boring-sys2` (BoringSSL) dependency:
> - [NASM](https://www.nasm.us/) on `PATH` (e.g. `winget install NASM.NASM`) — builds BoringSSL's assembly-optimized crypto routines.
> - [LLVM](https://releases.llvm.org/) with `LIBCLANG_PATH` set (e.g. `winget install LLVM.LLVM`, then `setx LIBCLANG_PATH "C:\Program Files\LLVM\bin"`) — `bindgen` needs `libclang` to generate Rust bindings from the BoringSSL headers.
>
> Restart your shell after installing either so `PATH`/`LIBCLANG_PATH` take effect.

### Common Commands

```bash
# Desktop (Tauri + Vite)
bun run dev

# Web only
bun run dev:web

# Android dev
bun run dev:android

# iOS dev (simulator configurable via IOS_SIMULATOR)
bun run dev:ios

# Android APK build
bun run build:android:apk

# iOS IPA build
bun run build:ios:ipa
```

All Tauri commands are routed through shell scripts in [scripts](scripts) and use Bun (`bunx`). Bun is the only supported package manager; `bun.lock` is the one lockfile.

Building from source with the pinned toolchain: see [BUILDING.md](./BUILDING.md). All release downloads and the OTA updates are reproducible; [REPRODUCIBILITY.md](./REPRODUCIBILITY.md) shows how to check a release against the source. The signing keys and how to check a download are in [KEYS.md](./KEYS.md).

All contributions must be aligned with [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

The documentation site lives in [`docs/`](./docs/) and is published to [fdev8974.github.io/free-grind](https://fdev8974.github.io/free-grind/) on every push to `development`. Run it locally with `bun run docs`. The Grindr API reference is generated from [`docs/lib/openapi.json`](./docs/lib/openapi.json), taken from [Open Grind](https://opengrind.org). Contributions to reverse engineering and documentation are especially valued.

## FAQ & Troubleshooting

More answers are in the [FAQ](https://fdev8974.github.io/free-grind/guide/faq).

<details>
  <summary>Can I get banned for using this?</summary>

  Using any unofficial client [technically violates Grindr's Terms of Service](https://www.grindr.com/terms-of-service). The risk is low, but it exists. The [paid feature bypass](https://fdev8974.github.io/free-grind/guide/features/paid-features) carries an extra risk. Use at your own discretion.
</details>

<details>
  <summary>Does this work on iOS?</summary>

  Yes. Each release includes an unsigned IPA that you sideload, see the [iOS download guide](https://fdev8974.github.io/free-grind/guide/download#ios).
</details>

<details>
  <summary>Why isn't feature X implemented yet?</summary>

  Free Grind is community-driven. Search the [issues](https://github.com/fdev8974/free-grind/issues) or open a feature request there, or from inside the app under **Settings → Report Bug or Feature**.
</details>

<details>
  <summary>Where is the API documentation?</summary>

  At [fdev8974.github.io/free-grind/grindr-api](https://fdev8974.github.io/free-grind/grindr-api/), generated from [`docs/lib/openapi.json`](./docs/lib/openapi.json).
</details>

## Contributing

This project is open to all kinds of contributions — code, documentation, bug reports, and reverse engineering.

- **Code contributions:** [open a pull request](https://github.com/fdev8974/free-grind/pulls) on GitHub.
- **Bug reports & feature requests:** submit them on [GitHub Issues](https://github.com/fdev8974/free-grind/issues).
- **Community discussion & support:** join us on [Discord](https://discord.gg/cJqTaWPMFF) or [Telegram](https://t.me/freegrind).

## Donate

If you'd like to support the project, see [FUNDING.md](./FUNDING.md).

## License

[MIT](./LICENSE). Free Grind started as a fork of [Open Grind](https://opengrind.org); see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
