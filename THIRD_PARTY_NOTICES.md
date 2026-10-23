# Third-party notices

## Open Grind

Free Grind started as a fork of [Open Grind](https://git.opengrind.org/open-grind/open-grind)
and keeps porting code from it. The following parts are ported or adapted from
Open Grind:

- `src-tauri/src/media_proxy/`: from `src-tauri/src/media/`
- `src-tauri/webkit-extension/fgmedia.c`: from `src-tauri/webkit-extension/ogmedia.c`
- `src-tauri/wry-patched/response-streams.patch`: from `src-tauri/patches/wry@0.55.1.patch`
- `src/utils/mediaProxy.ts`: adapted from Open Grind's media proxy frontend

`src-tauri/grindr-patched/` is a patched copy of
[grindr.rs](https://git.opengrind.org/open-grind/grindr.rs) and ships with its
own `LICENSE`.

```
MIT License

Copyright (c) 2026-present Open Grind Governance (https://opengrind.org/governance)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
