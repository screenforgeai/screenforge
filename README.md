<div align="center">

<!-- Hero demo. To swap in the inline video player: open README.md in the
     GitHub web editor, drag the demo .mp4 onto this spot, and replace this
     <a> block with the https://github.com/user-attachments/assets/... URL
     GitHub generates (on its own line). For a looping GIF instead, add
     src/assets/readme-demo.gif and point the <img> below at it. -->
<a href="https://x.com/arshi_mohib/status/2078530968659607593">
  <img src="src/assets/readme-banner.png" alt="Screenforge demo: a screen recording that zooms in and follows the cursor automatically" width="100%" />
</a>

<sub>▶ <a href="https://x.com/arshi_mohib/status/2078530968659607593">Watch the demo</a></sub>

# Screenforge

**Free, open-source screen recorder that zooms in and follows your cursor automatically.**

Record your screen, webcam and mic, polish it in a full timeline editor, and export a ready-to-share video. Free for commercial use, no account, no watermark.

[![Latest release](https://img.shields.io/github/v/release/screenforgeai/screenforge?label=release&color=d44523)](https://github.com/screenforgeai/screenforge/releases/latest)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![CI](https://github.com/screenforgeai/screenforge/actions/workflows/ci.yml/badge.svg)](https://github.com/screenforgeai/screenforge/actions/workflows/ci.yml)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#download)

[![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)

[![Last commit](https://img.shields.io/github/last-commit/screenforgeai/screenforge)](https://github.com/screenforgeai/screenforge/commits/main)
[![Contributors](https://img.shields.io/github/contributors/screenforgeai/screenforge)](https://github.com/screenforgeai/screenforge/graphs/contributors)
[![Issues](https://img.shields.io/github/issues/screenforgeai/screenforge)](https://github.com/screenforgeai/screenforge/issues)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[![GitHub stars](https://img.shields.io/github/stars/screenforgeai/screenforge?style=social)](https://github.com/screenforgeai/screenforge/stargazers)
[![Follow on X](https://img.shields.io/twitter/follow/arshi_mohib?style=social)](https://x.com/arshi_mohib)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/mohibarshi)

[**Download**](#download) · [Website](https://screenforge.co) · [Features](#features) · [Build from source](#build-from-source) · [Contributing](#contributing)

</div>

---

## Why Screenforge

Making a good product demo or tutorial usually means recording, then spending an hour hand-keyframing zooms. Screenforge records where your cursor goes and what you click, and uses that to zoom and pan the video for you. You get a polished result straight out of the recorder, and you can still adjust every zoom on the timeline.

- **Automatic zoom and cursor tracking.** Clicks and typing drive smooth zooms that follow the cursor, so viewers always see what matters.
- **Fast, built-in captions.** Whisper transcription is part of the app, with word-level timing you can edit.
- **Actually free, including for commercial use.** No account, no watermark, no export limits, no "Pro" tier. Use it for client work, product demos and paid courses. The full app is open source under AGPL-3.0.
- **A real editor.** Multi-track timeline with zoom, camera, captions, text, masks, music and transitions.

## Download

| Platform | Download | Notes |
|---|---|---|
| **macOS** (Apple Silicon) | [screenforge.co/download/mac](https://screenforge.co/download/mac) | Code-signed and notarized |
| **Windows** (x64) | [screenforge.co/download/windows](https://screenforge.co/download/windows) | Squirrel installer, auto-updates |
| **Linux** (x64) | [screenforge.co/download/linux](https://screenforge.co/download/linux) | `.deb`, `.rpm`, AppImage and `.zip`; records on X11 and Wayland; shows when a new version is out |

All builds are also on the [GitHub releases page](https://github.com/screenforgeai/screenforge/releases). See [`CHANGELOG.md`](./CHANGELOG.md) for what changed in each version.

## Features

### Recording
- Capture a full display, a single window, or a selected area
- Webcam and microphone, recorded alongside the screen
- Cursor tracking at 120 Hz with sub-pixel precision, plus click and keystroke logging that drive auto-zoom and the keyboard overlay
- Teleprompter: a floating, always-on-top script window while you record
- Import existing videos (MP4, MOV, WebM, AVI, MKV, M4V) to edit them too

### Editing
- **Zoom:** automatic cursor-following zoom or manual keyframed pans, with a cinematic mode (optical zoom, depth, tilt, motion blur, background fade)
- **Cursor:** 11 cursor styles, click ripples and sounds, motion blur, hide when idle
- **Camera:** square, horizontal or vertical shapes; overlay, side-panel and full-screen layouts; background blur and shadow
- **Frame and background:** solid colors, gradients, 14 built-in wallpapers or your own image, with padding, blur, rounded corners and shadow
- **Keyboard overlay:** shows shortcuts as you press them
- **Text clips** with full typography controls
- **Privacy masks:** blur or block out any region of the screen
- **Music:** import, loop, trim, set volume, fit to video length
- **Transitions:** 8 types (fade, slide, grow/shrink, blur)
- **Speed:** per-clip, 0.25x to 4x
- **Multi-track timeline:** trim, split and move every clip type, with audio waveforms
- **Undo/redo**, autosave, a project library, and style presets that save cursor, camera, frame and caption styling together

### Captions
- Transcription with Whisper (tiny, base, small or medium) on ONNX Runtime
- Word-level timing, click-to-edit segments, full styling
- Export as SRT or burn captions into the video

### Export
- MP4, MOV, WebM or GIF at 720p, 1080p or 4K, 20 to 60 fps
- Fast, balanced or high-quality presets and a configurable audio bitrate
- Frame-accurate rendering in a hidden Pixi.js window, muxed with FFmpeg

### Also
- Available in English, German, Spanish, French, Japanese, Korean and Portuguese
- Optional, anonymous usage analytics and error reporting (PostHog), off in development builds and in forks, no account required

Ideas on the roadmap live in [`FEATURES.md`](./FEATURES.md).

## How it works

```
Record ──► Edit ──► Export
  │          │         │
  │          │         └─ hidden window renders each frame with Pixi.js,
  │          │            FFmpeg muxes video + audio, file saved to disk
  │          └─ React + Zustand editor, Canvas 2D live preview, undoable timeline
  └─ Electron main process captures screen, camera, mic, cursor and keys
```

Screenforge is an Electron app. The main process (`electron/`) handles capture, FFmpeg and file I/O; the renderer (`src/`) is the React editor. Effects (zoom, frame, cursor, camera, keyboard) each have a Canvas 2D renderer for live preview and a Pixi.js renderer for export.

For a deeper tour, read [`docs/FOUNDATION.md`](./docs/FOUNDATION.md) and [`docs/RECORDING_AND_EXPORT.md`](./docs/RECORDING_AND_EXPORT.md).

| Layer | Technology |
|---|---|
| App framework | Electron 40 + Electron Forge |
| UI | React 19, Tailwind CSS v4, Zustand |
| Rendering | Pixi.js (export), Canvas 2D (live preview) |
| Video processing | FFmpeg (bundled) |
| Transcription | Whisper on ONNX Runtime |
| Build | Vite, TypeScript |
| Tests | Vitest |

## Build from source

**Prerequisites:** Node.js 22.12+ and pnpm 10 (pnpm 11 ignores this repo's `.npmrc`, which Electron Forge needs).

```bash
git clone https://github.com/screenforgeai/screenforge.git
cd screenforge
pnpm install
pnpm download:ffmpeg:linux     # Linux only; on Windows: pnpm download:ffmpeg:windows
pnpm start
```

macOS uses the FFmpeg build committed in `native/bin/ffmpeg/darwin-arm64/`. Linux and Windows binaries are too large to commit, so they are downloaded.

| Command | What it does |
|---|---|
| `pnpm start` | Run in dev mode (Vite + HMR) |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm test:unit` | Unit tests |
| `pnpm test:export` | Export pipeline tests |
| `pnpm make` | Build installers for your platform |

Builds from forks ship with telemetry and auto-update turned off.

## Project layout

```
electron/          Main process: capture, FFmpeg, IPC, file I/O
  modules/         One folder per feature (channel.ts / service.ts / bridge.ts)
src/               Renderer: React editor
  store/           Zustand store with undo/redo
  lib/effects/     Zoom, frame, cursor, camera, keyboard (Canvas 2D + Pixi.js)
  locales/         Translations
native/            Native capture helpers and the bundled macOS FFmpeg
docs/              Architecture and build notes
```

## Contributing

Contributions are welcome, from bug reports to new effects.

- Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, tests and the changeset workflow.
- Browse [open issues](https://github.com/screenforgeai/screenforge/issues) or open one to discuss a bigger change first.
- Translations are plain JSON in [`src/locales/`](./src/locales), a good first contribution.
- This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).

Found a security issue? Please report it privately; see [`SECURITY.md`](./SECURITY.md).

## Support the project

- ⭐ Star the repo, it helps others find it
- Share what you make and tag [@arshi_mohib](https://x.com/arshi_mohib) on X
- Buy a coffee on [Ko-fi](https://ko-fi.com/mohibarshi)

## License

Screenforge is licensed under the [GNU Affero General Public License v3.0 or later](./LICENSE). Third-party licenses (FFmpeg, libuiohook, Whisper) are listed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

**The license covers the app, not your videos.** AGPL-3.0 sets the terms for copying, modifying and redistributing Screenforge itself: if you ship a modified version, you share its source under the same license. It places no limits on what you record or export. The videos you make are yours, for any use, commercial included.
