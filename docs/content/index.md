---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

titleTemplate: ':title — free & open source Grindr client'

hero:
  name: "Free Grind"
  text: "Unofficial Grindr client"
  tagline: Crossplatform, free, libre, ad-free, tracker-free, privacy-centered and community-driven
  image:
    src: /logo.webp
    alt: Free Grind logo
  actions:
    - theme: brand
      text: Download
      icon: '<span class="vp-icon i-download"></span>'
      link: /guide/download
      platforms:
        - { label: Android, icon: '<span class="vp-icon i-android"></span>' }
        - { label: iOS, icon: '<span class="vp-icon i-ios"></span>' }
        - { label: Windows, icon: '<span class="vp-icon i-windows"></span>' }
        - { label: Linux, icon: '<span class="vp-icon i-linux"></span>' }
        - { label: macOS, icon: '<span class="vp-icon i-apple"></span>' }
    - theme: alt
      text: Source code
      icon: '<span class="vp-icon i-github"></span>'
      link: https://github.com/fdev8974/free-grind
    - theme: ghost
      text: Discord
      icon: '<span class="vp-icon i-discord"></span>'
      link: https://discord.gg/cJqTaWPMFF
    - theme: ghost
      text: Telegram
      icon: '<span class="vp-icon i-telegram"></span>'
      link: https://t.me/freegrind

features:
  - title: Unlocked grid
    icon: '<span class="vp-icon i-grid"></span>'
    details: Browse the whole grid for free, page after page, with filters, name search and quick gestures
    link: /guide/features/unlocked-grid
  - title: Location spoofing
    icon: '<span class="vp-icon i-teleport"></span>'
    details: Set your location anywhere in the world for free and appear in the grid there
    link: /guide/features/location-spoofing
  - title: Local chat history
    icon: '<span class="vp-icon i-history"></span>'
    details: Messages and media stay on your device, searchable and backed up, even after unsends and blocks
    link: /guide/features/chat-history
  - title: Privacy built-in
    icon: '<span class="vp-icon i-privacy"></span>'
    details: No trackers, plus incognito mode, hidden read receipts, invisible profile views and app disguise
    link: /guide/features/privacy
  - title: Zero ads
    icon: '<span class="vp-icon i-no-ads"></span>'
    details: No ads, no banners, no upsells, no premium version. Free forever
    link: /guide/features/no-ads
  - title: All platforms
    icon: '<span class="vp-icon i-platforms"></span>'
    details: Android, iOS, Windows, macOS and Linux from one codebase, with reproducible builds
    link: /guide/download
---
