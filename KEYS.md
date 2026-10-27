# Signing keys

Free Grind releases are signed with two keys. Check a download against these values before you trust it. To check what's inside a download, not just who signed it, see [REPRODUCIBILITY.md](./REPRODUCIBILITY.md).

| Key                    | Signs                                                         | Public part |
| ---------------------- | ------------------------------------------------------------- | ----------- |
| Release minisign key   | `SHA256SUMS` of every release, and every OTA frontend update  | `RWQfowNcYziP1BnTEyNrdZk2MymsuGVoCeqqtGE3OfpYfLqnvAvCS9JX` |
| Android signing key    | the APK (`free-grind-v<version>.apk`)                         | certificate SHA-256 `7ce9e5cdac620ec798bea6749aed4c6d59bf12ab5e1dc8cb59c117bb929fc9d0` |

The minisign key is the same one installed apps use to accept OTA updates; it's in [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json) under `plugins.hotswap.pubkey`. The Android key is what Android checks on every update: an APK signed with another key won't install over Free Grind.

## Checking a download (Windows, macOS, Linux, iOS)

Download `SHA256SUMS` and `SHA256SUMS.minisig` from the same release, next to the file you want to check. You need [minisign](https://jedisct1.github.io/minisign/): `apt install minisign` on Debian/Ubuntu, `brew install minisign` on macOS, or a binary from its [releases](https://github.com/jedisct1/minisign/releases).

```bash
# 1. The checksums were signed by the release key
minisign -Vm SHA256SUMS -x SHA256SUMS.minisig -P RWQfowNcYziP1BnTEyNrdZk2MymsuGVoCeqqtGE3OfpYfLqnvAvCS9JX

# 2. Your download is listed in them
sha256sum --ignore-missing -c SHA256SUMS
```

The Windows exe is published as three copies (`free-grind-manager-…`, `free-grind-client-…`, `free-grind-child-…`); all three match the `free-grind-v<version>-windows-x64.exe` line.

## Checking the Android APK

```bash
apksigner verify --print-certs free-grind-v<version>.apk | grep 'SHA-256'
# -> Signer #1 certificate SHA-256 digest: 7ce9e5cdac620ec798bea6749aed4c6d59bf12ab5e1dc8cb59c117bb929fc9d0
```

`apksigner` is part of the Android SDK build-tools. The certificate's name reads `CN=Open Grind, OU=Dev, O=Open Grind`; what identifies it is the digest above.

## Checking an OTA update

Each update on `https://freegrind-ota-<channel>.surge.sh/latest.json` names a bundle and carries its signature as base64. Installed apps verify it before loading the bundle; to do the same by hand:

```bash
curl -fsSL https://freegrind-ota-main.surge.sh/latest.json > latest.json
curl -fsSL "$(jq -r .url latest.json)" -o frontend.tar.gz
jq -r .signature latest.json | base64 -d > frontend.tar.gz.minisig
minisign -Vm frontend.tar.gz -x frontend.tar.gz.minisig -P RWQfowNcYziP1BnTEyNrdZk2MymsuGVoCeqqtGE3OfpYfLqnvAvCS9JX
```

## Releases up to 1.0.0-beta.18

These releases have no `SHA256SUMS.minisig` and weren't reproducible.
