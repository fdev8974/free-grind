---
title: Download
outline: [2, 3]
---

# Download Free Grind

Never download Free Grind from unofficial sources. The only official source is the [GitHub releases page](https://github.com/fdev8974/free-grind/releases). Free Grind is free: if someone asks you to pay for it, it's a scam.

::: warning Free Grind 1.0 is in beta
New versions are published as **pre-releases**. GitHub's "Latest" badge still points to an old 0.x version, so on the releases page take the release at the top. The buttons below always point to the newest one.
:::

## Android {#android}

<div class="vpbuttons-row">
	<DownloadButton asset="\.apk$" text="Download for Android (apk)" />
</div>

Requires Android 8.0 or later on a 64-bit ARM device (practically every phone from the last years).

1. Download the APK on your phone and open it.
2. Android asks your browser for permission to install apps once. Allow it and confirm the install.
3. If Google Play Protect warns about an unknown app, tap **More details → Install anyway**.

- **To install updates**, open **Settings → Check for Updates**. New versions are downloaded, verified and installed from inside the app. Allow Free Grind to install apps when asked.
- **To verify the download**, follow [Reproducibility → Android](https://github.com/fdev8974/free-grind/blob/development/REPRODUCIBILITY.md#android).
- **To uninstall**, uninstall it like any other app. This removes your local chat history too, so [back it up](/guide/features/chat-history#backup) first if you want to keep it.

## iOS and iPadOS {#ios}

<div class="vpbuttons-row">
	<DownloadButton asset="-unsigned\.ipa$" text="Download for iOS (ipa)" />
</div>

Requires iOS or iPadOS 14.0 or later.

The IPA is unsigned, so it has to be sideloaded. The [FMHY iOS sideloading list](https://fmhy.net/mobile#ios-sideloading) collects free tools and guides for this, such as TrollStore, SideStore or Sideloadly, and explains which iOS versions each one supports. With a free Apple ID, most of these tools have to refresh the app every 7 days.

Alternatively, **FlareStore** costs about 3 € and installs the IPA directly on your iPhone or iPad without a computer.

- **To install updates**, download the new IPA and sideload it over the old one with the same tool. Your data stays.
- **To verify the download**, follow [Reproducibility → iOS](https://github.com/fdev8974/free-grind/blob/development/REPRODUCIBILITY.md#ios).

## Windows {#windows}

<div class="vpbuttons-row">
	<DownloadButton asset="-windows-x64-setup\.exe$" text="Download for Windows (installer)" />
	<DownloadButton asset="^free-grind-manager-.*\.exe$" text="Portable exe" theme="alt" />
</div>

Requires Windows 10 or 11 (x64).

1. Run the installer and follow the steps.
2. The installer isn't code-signed, so Windows SmartScreen may show "Windows protected your PC". Click **More info → Run anyway**.

The **portable exe** runs without installing. The release also contains `free-grind-client-…` and `free-grind-child-…`: these are the same program under other names, which Free Grind uses to run several instances side by side. You don't need to download them.

- **To install updates**, Free Grind tells you when a new version is out. Download the new installer and run it over the old installation. Smaller interface updates are installed automatically, see [Updates](#updates).
- **To verify the download**, follow [Reproducibility → Windows](https://github.com/fdev8974/free-grind/blob/development/REPRODUCIBILITY.md#windows).
- **To uninstall**, use **Settings → Apps → Installed apps → Free Grind → Uninstall**. To also remove your data, delete the `dev.estopia.free-grind` folders in `%APPDATA%` and `%LOCALAPPDATA%`. The latter also holds downloaded interface updates, which otherwise survive a reinstall.

## macOS {#macos}

<div class="vpbuttons-row">
	<DownloadButton asset="-macos-universal\.zip$" text="Download for macOS (zip)" />
</div>

Runs natively on Apple Silicon and Intel Macs.

1. Open the zip, which unpacks **Free Grind**, and drag the app into **Applications**.
2. The app isn't notarized by Apple, so the first launch is blocked. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the message about Free Grind.

If macOS says Free Grind "is damaged and can't be opened", remove the download quarantine flag in Terminal and open it again:

```sh
xattr -dr com.apple.quarantine "/Applications/Free Grind.app"
```

- **To install updates**, Free Grind tells you when a new version is out. Download the new zip and replace the app in Applications. Smaller interface updates are installed automatically, see [Updates](#updates).
- **To verify the download**, follow [Reproducibility → macOS](https://github.com/fdev8974/free-grind/blob/development/REPRODUCIBILITY.md#macos).
- **To uninstall**, move the app from Applications to the Trash. To also remove your data, delete the `dev.estopia.free-grind` folders in `~/Library/Application Support`, `~/Library/Caches` and `~/Library/WebKit`, and the Free Grind items in Keychain Access.

## Linux {#linux}

Free Grind is built for x86_64. Pick the package for your distribution, or the AppImage, which runs anywhere.

- **To play videos**, install an H.264 decoder. See [Video codecs on Linux](/guide/codecs).
- **If the window stays blank, flickers or draws parts of the app wrong**, see [Rendering problems](#rendering-problems).

### AppImage (any distribution) {#appimage}

<div class="vpbuttons-row">
	<DownloadButton asset="\.AppImage$" text="Download AppImage" />
</div>

Make the AppImage executable and run it:

```sh
chmod +x free-grind-v*-linux-x64.AppImage
./free-grind-v*-linux-x64.AppImage
```

In GNOME Files, the same thing is **Properties → Permissions → Executable as Program**.

- **To install updates**, download the new AppImage and replace the old file.
- **To uninstall**, delete the AppImage. To also remove your data, delete `~/.local/share/dev.estopia.free-grind` and `~/.cache/dev.estopia.free-grind`.

### deb (Debian, Ubuntu, Linux Mint, Pop!\_OS) {#deb}

<div class="vpbuttons-row">
	<DownloadButton asset="\.deb$" text="Download deb" />
</div>

```sh
sudo apt install ./free-grind-v*-linux-x64.deb
```

- **To install updates**, install the new deb the same way.
- **To uninstall**, run `sudo apt remove free-grind`, then delete your data as for the AppImage.

### rpm (Fedora, openSUSE) {#rpm}

<div class="vpbuttons-row">
	<DownloadButton asset="\.rpm$" text="Download rpm" />
</div>

```sh
# Fedora
sudo dnf install ./free-grind-v*-linux-x64.rpm
# openSUSE
sudo zypper install ./free-grind-v*-linux-x64.rpm
```

- **To install updates**, install the new rpm the same way.
- **To uninstall**, run `sudo dnf remove free-grind` or `sudo zypper remove free-grind`, then delete your data as for the AppImage.

### Verify the download

Follow [Reproducibility → Linux](https://github.com/fdev8974/free-grind/blob/development/REPRODUCIBILITY.md#linux).

### Rendering problems {#rendering-problems}

The window is drawn by WebKitGTK and your graphics driver. With some combinations, parts of the window draw wrong.

1. Update your system. Newer WebKitGTK versions fixed many rendering glitches.
2. Close Free Grind, then launch it from a terminal with one of these settings:
   - `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` if the window flickers or turns black.
   - `WEBKIT_DISABLE_DMABUF_RENDERER=1` if rows disappear while you scroll, or if nothing else helps. Scrolling gets less smooth.
   - `__NV_DISABLE_EXPLICIT_SYNC=1` on NVIDIA if Free Grind crashes on Wayland with "Error 71 (Protocol error)".

   ```sh
   WEBKIT_DISABLE_DMABUF_RENDERER=1 ./free-grind-v*-linux-x64.AppImage
   ```

When you [report a rendering problem](https://github.com/fdev8974/free-grind/issues), include your GPU and driver version, your WebKitGTK version, whether you use Wayland or X11, and which settings you tried.

## Updates {#updates}

Besides full app updates, Free Grind receives smaller interface updates (OTA) directly from GitHub on every platform. You control them in **Settings**:

- **Update Channel:** _main_ gets tested releases (recommended), _development_ gets the newest changes as soon as they're built and may be unstable.
- **Check Automatically:** looks for new versions on every app start. When off, no request is sent to GitHub unless you check manually.
- **Install Automatically:** installs new interface versions right away. When off, you're asked first.

## Build it yourself

Free Grind is open source. To build it from source, follow the [Development guide](https://github.com/fdev8974/free-grind#development) in the README.
