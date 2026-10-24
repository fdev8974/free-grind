---
title: FAQ
---

# Free Grind FAQ

## About Free Grind

::: details Where do I download Free Grind?

**Follow the instructions on the [Download](/guide/download) page.** Only download Free Grind from the [official releases page](https://github.com/fdev8974/free-grind/releases), never from anywhere else. If you're a technical user, you can also [build it yourself](https://github.com/fdev8974/free-grind#development).

:::

::: details Can I pay for Free Grind, or for early access?

No. **Free Grind is free and always will be.** There's no paid version, no premium features and no paid early access. Anyone who asks you to pay for it is a scammer.

If you want to say thank you to a contributor, [FUNDING.md](https://github.com/fdev8974/free-grind/blob/development/FUNDING.md) lists their donation links. Donations are optional and don't get you anything in the app.

:::

::: details Is Free Grind a modified Grindr app?

No. Free Grind is a separate client that talks to the Grindr API directly. It isn't a patched version of the official app, so there's no bloat to remove: every feature is built from scratch.

Free Grind started as a fork of [Open Grind](https://opengrind.org) and has grown its own features since. The two projects aren't affiliated.

:::

::: details How do I know a release is safe?

Free Grind is open source, and its releases are **reproducible**: you can build the same version yourself and check that you get exactly the same file. Releases are also signed. See [KEYS.md](https://github.com/fdev8974/free-grind/blob/development/KEYS.md) to check who signed a download, and [REPRODUCIBILITY.md](https://github.com/fdev8974/free-grind/blob/development/REPRODUCIBILITY.md) to check what's inside it.

:::

::: details How many people use Free Grind?

We don't know, and that's on purpose: Free Grind has no analytics, no trackers and no install counter. The only hint is the download count on the releases page.

:::

::: details When does feature X arrive? When is the next update?

Search the [issues](https://github.com/fdev8974/free-grind/issues) for the feature, or use **Settings → Issues & Feature Requests** in the app. New versions are announced on [Telegram](https://t.me/freegrind) and [Discord](https://discord.gg/cJqTaWPMFF).

:::

## Features

::: details Can I fake my location?

Yes, it's built in and doesn't need a subscription. See [Location spoofing](/guide/features/location-spoofing).

:::

::: details Can I use paid Grindr features?

The grid is unlocked for free, see [Unlocked grid](/guide/features/unlocked-grid). For some paid actions, like unsending messages or sending more expiring photos, Free Grind can try a bypass, see [Paid feature bypass](/guide/features/paid-features).

:::

::: details Can I create a new account?

Yes, on Android: tap **Sign up** on the sign-in screen. On other platforms, create the account on Android or in the official app, then sign in to Free Grind.

:::

::: details How do I sign in with Google, Facebook or on a new device?

See [Sign in](/guide/login).

:::

::: details Can I use several accounts?

Yes, see [Multiple accounts](/guide/features/multiple-accounts).

:::

::: details Can I change the colors?

Yes. **Settings → Look & Feel** has the color scheme, accent color, pure black mode, grid columns and more.

:::

::: details Are there AI features?

Only if you want them: [Chat translation](/guide/features/translation) can use Gemini, ChatGPT or Claude with your own API key. Without a key, nothing is sent to any AI service.

:::

## Problems

::: details Can I get banned for using Free Grind?

Using any unofficial client technically violates [Grindr's terms of service](https://www.grindr.com/terms-of-service). The risk is low, but it exists. The [paid feature bypass](/guide/features/paid-features) carries an extra risk.

If your account is restricted, Free Grind shows why and for how long.

:::

::: details I can't sign in.

- Accounts created with Google or Facebook need **Sign in with Google** or **Sign in with Facebook**, not email and password.
- If Grindr asks for SMS verification, finish it on the **Verification** screen.

See [Sign in](/guide/login).

:::

::: details I don't get notifications.

Check **Settings → Notifications** and your system's notification settings. On Android, notifications need Google Play services. On desktop, they only arrive while Free Grind is running. See [Notifications](/guide/notifications).

:::

::: details Videos don't play on Linux.

Install an H.264 decoder, see [Video codecs on Linux](/guide/codecs).

:::

::: details The window is blank or flickers on Linux.

See [Rendering problems](/guide/download#rendering-problems).

:::

::: details Something broke after an update.

Make sure you're on the newest version: **Settings → Check for Updates**. If you switched to the _development_ update channel, switch back to _main_ for tested releases.

:::

::: details Where do I report a bug?

Use **Settings → Report Bug or Feature**, or [open an issue on GitHub](https://github.com/fdev8974/free-grind/issues) with your device, platform, Free Grind version and what you were doing.

:::
