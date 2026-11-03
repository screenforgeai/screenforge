# Linux Build Plan

> **Status:** Phases 1–7 are implemented (session detection, X11 60fps +
> uiohook staging, Wayland portal capture via getDisplayMedia/MediaRecorder,
> FFmpeg bundling script, Forge deb/rpm/zip packaging, behavior guards, and
> the `build-linux.yml` release workflow). Remaining: on-device validation
> per the Phase 8 test matrix, the optional native Linux helper
> (Phase 3 Option B), and an AppImage maker.

Goal: ship a Linux-ready Screenforge build (deb / rpm / AppImage / zip) whose
recording pipeline works on **both Linux display systems**:

- **X11** — the legacy display server. Apps can grab the screen directly
  (FFmpeg `x11grab`) and install global input hooks (`uiohook-napi` works).
- **Wayland** — the modern default (Ubuntu 22+, Fedora, GNOME, KDE Plasma).
  Direct grabbing is forbidden by design; screen capture must go through
  **PipeWire + xdg-desktop-portal** (the system the user approves via a
  portal dialog).
  Global input hooks are also blocked, so cursor tracking needs a different
  strategy.

Detection at runtime: `XDG_SESSION_TYPE`, `WAYLAND_DISPLAY`, and `DISPLAY`.
Note that most Wayland sessions run XWayland, so `DISPLAY` being set does
NOT mean X11 — under XWayland, `x11grab` records a black/empty screen.
Session type must be checked before choosing a capture backend.

---

## Current state (audit summary)

What already exists:

- `electron/modules/recording/service.ts:250` — an FFmpeg `x11grab` capture
  path gated on `process.platform === 'linux' && process.env.DISPLAY`
  (30 fps, no Wayland handling).
- `electron/modules/app/window-controller.ts:92` — Linux-only behavior that
  hides the toolbar during recording and falls back to a tray control
  (partially compensates for `setContentProtection` being a no-op on Linux).
- `forge.config.ts:418-420` — `MakerDeb`, `MakerRpm`, and `MakerZIP` for
  linux are declared (but never exercised, and resources aren't staged).
- `buildH264EncodeArgs()` and post-processing already fall back to `libx264`
  off macOS, so crop/concat/merge/export encoding works on Linux unchanged.

The gaps:

| # | Gap | Where |
|---|-----|-------|
| 1 | No Wayland capture path at all; `x11grab` misused under XWayland | `recording/service.ts:250,332` |
| 2 | `shouldUseNativeCapture()` false on Linux → no window sources, no window-only recording | `lib/macos-native-capture.ts`, `sources/service.ts` |
| 3 | Global cursor/keyboard tracking: uiohook prebuild not staged on Linux; uiohook cannot work on Wayland at all | `shared/uiohook-paths.js:41`, `recording/service.ts` |
| 4 | No bundled FFmpeg for `linux-x64` (silently relies on `/usr/bin/ffmpeg`) | `scripts/`, `shared/ffmpeg-paths.js` |
| 5 | Packaging: extraResources always stages a mac/win native helper that doesn't exist on Linux; no Linux icon; `make-platform.mjs` rejects `linux` | `forge.config.ts:73-80`, `scripts/make-platform.mjs:22` |
| 6 | `setContentProtection` is a no-op on Linux → overlays (area selector, camera preview, teleprompter, scene overlay) can appear in recordings | `area-selector/service.ts:58`, `camera-preview/service.ts:46`, etc. |
| 7 | Auto-updater hard-disabled on Linux (acceptable for v1, revisit for AppImage) | `updater/service.ts:203` |
| 8 | No Linux CI/release pipeline | `.github/workflows/` |
| 9 | Permissions UX assumes mac/win (settings deep-links return `null`, statuses stubbed) | `app/service.ts:126,271` |

---

## Phase 1 — Session detection & capture backend selection

New module `electron/lib/linux-capture.ts`:

```ts
export type LinuxSessionType = 'x11' | 'wayland' | 'unknown';

export function getLinuxSessionType(): LinuxSessionType {
  if (process.platform !== 'linux') return 'unknown';
  const sessionType = process.env.XDG_SESSION_TYPE?.toLowerCase();
  if (sessionType === 'wayland' || process.env.WAYLAND_DISPLAY) return 'wayland';
  if (sessionType === 'x11' || process.env.DISPLAY) return 'x11';
  return 'unknown';
}
```

Wire it into `startRecording()` in `recording/service.ts`:

- `x11` → FFmpeg `x11grab` path (Phase 2).
- `wayland` → PipeWire capture path (Phase 3).
- `unknown` → user-facing error ("Could not detect a display session").

Also replace the current `process.env.DISPLAY` check at
`recording/service.ts:250` — it wrongly selects `x11grab` under XWayland.

## Phase 2 — X11 pipeline (harden what exists)

The `x11grab` path mostly works; bring it to parity with mac/win:

1. Bump `-framerate` 30 → 60 to match the other platforms.
2. Multi-monitor: verify `${DISPLAY}+${x},${y}` offsets against
   `display.bounds` for negative-coordinate layouts.
3. Cursor tracking: uiohook-napi supports X11. Fix
   `shared/uiohook-paths.js:41-46` to stage the
   `uiohook-napi-linux-x64` prebuild into extraResources (same pattern as
   mac/win) so packaged builds can load it
   (`recording/service.ts:164` already computes the right dir name).
4. Pause/resume: SIGSTOP/SIGCONT on the FFmpeg process (existing code)
   works on Linux — verify pause-span timing.
5. Window-only recording: keep unsupported on X11 for v1; improve the error
   message at `recording/service.ts:1334-1340` to say so explicitly
   ("Window recording on Linux is available on Wayland via the system
   picker" once Phase 3 lands).

## Phase 3 — Wayland pipeline (PipeWire via desktop portal)

Direct FFmpeg capture is impossible on Wayland. Two implementation options:

### Option A (recommended for v1): Chromium's built-in portal capture

Electron/Chromium ships a PipeWire screen-capture backend. Flow:

1. In `electron/main.ts`, before `app.whenReady()`:
   `app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')`
   (Linux only; harmless no-op on newer Electron where it's default-on).
2. Add a renderer-side capture route: `navigator.mediaDevices.getDisplayMedia()`
   (or `getUserMedia` with a `desktopCapturer` source id) → the portal shows
   the system picker (user selects screen *or window* — window recording on
   Wayland comes for free) → record the `MediaStream` with `MediaRecorder`
   (VP9/webm) → stream chunks to main via the existing
   `saveRecording()` IPC → remux/transcode to H.264 MP4 with the bundled
   FFmpeg (reuse `reencodeRecording()` / `faststartMp4()` machinery).
3. Recording bounds: derive from the stream's video track settings
   (`track.getSettings()`) instead of `display.bounds`, since the portal
   controls what is captured.
4. Pause/resume: `MediaRecorder.pause()/resume()` maps onto the existing
   pause-span bookkeeping.

Pros: no new native code, portal handles permissions and window picking,
works on GNOME/KDE/wlroots. Cons: renderer-side encode (VP9→H.264 transcode
step), capture FPS subject to compositor throttling.

### Option B (later, for parity): native Linux helper

A `native/linux/ScreenforgeCapture` binary (C++ / Rust) speaking
xdg-desktop-portal (`org.freedesktop.portal.ScreenCast`) + PipeWire directly,
encoding via FFmpeg libs — mirroring the mac (ScreenCaptureKit) and win
(WGC/Media Foundation) helpers, including the stdout JSON cursor-event
protocol. This restores main-process capture, 60 fps control, and embedded
cursor metadata. Defer until Option A ships and demand justifies it.

### Cursor tracking on Wayland

uiohook cannot see global input on Wayland. Strategy, in order:

1. **PipeWire embedded cursor metadata** — request cursor mode "metadata" in
   the portal session; Option B can emit cursor positions from it. For
   Option A, Chromium composites the cursor into the video
   (cursor mode "embedded") — so recordings show the cursor but Screenforge
   gets no event stream.
2. **Graceful degradation (v1)**: on Wayland, record with the cursor
   composited into the video, disable auto-zoom/cursor-effects features
   (they depend on the event stream), and surface a one-line notice in the
   recorder UI ("Cursor effects require an X11 session on Linux for now").
   Gate this on `getLinuxSessionType()` and expose it to the renderer via a
   new field on the existing app-info/permission IPC payload.
3. Long term: libei / `org.freedesktop.portal.InputCapture` portal for a
   permissioned global event stream.

## Phase 4 — FFmpeg bundling for Linux

1. New script `scripts/download-ffmpeg-linux.sh`: fetch a pinned static
   x86_64 (and arm64) build (BtbN/FFmpeg-Builds GPL release — matches the
   Windows script's approach) into `native/bin/ffmpeg/linux-x64/`, writing
   the same `build-manifest.json`.
2. `shared/ffmpeg-paths.js` already resolves `${platform}-${arch}` — no code
   change needed once the folder exists; packaged resolution via
   `getPackagedBinaryCandidate()` also already works.
3. Keep the `/usr/bin/ffmpeg` system fallback (already present) for distro
   packages that prefer system FFmpeg (and note AGPL/GPL distribution
   obligations for the bundled binary in `THIRD_PARTY_NOTICES.md`).
4. Add `"download:ffmpeg:linux"` to `package.json` scripts.

## Phase 5 — Packaging (Electron Forge)

`forge.config.ts` changes:

1. **extraResources** (`:73-77`): only unshift the native helper on
   mac/win — on Linux there is none (until Option B). Currently packaging on
   Linux would fail or stage a stale mac binary.
2. **Icon**: generate `build/icons/screenforge.png` (512×512; deb/rpm want
   PNG, not icns/ico) + a `scripts/build-linux-app-icon.sh`; point
   `appIconPath` at it when `process.platform === 'linux'` and pass it to
   the makers.
3. **MakerDeb / MakerRpm options**: name, productName, genericName
   ("Screen Recorder"), categories `['AudioVideo', 'Video']`, homepage,
   icon, and a `.desktop` entry. Recommended deb `depends`:
   `libnotify4`, `libxtst6` (uiohook), `libnss3`; recommend (not depend on)
   `pipewire` and `xdg-desktop-portal`.
4. **AppImage**: add `@reforged/maker-appimage` — the most
   distro-agnostic Electron target and the easiest "download and run"
   artifact for users. Ship deb + rpm + AppImage + zip.
5. **`scripts/make-platform.mjs:22`**: accept `linux`; add
   `"make:linux": "node scripts/make-platform.mjs linux"`.
6. Wayland launch flags: ship the `.desktop` Exec with
   `--ozone-platform-hint=auto` (or set it via `app.commandLine` on Linux)
   so the app runs natively on Wayland instead of XWayland.

## Phase 6 — App behavior fixes on Linux

1. **Overlay leakage** (`setContentProtection` no-op): the toolbar-hide +
   tray fallback at `window-controller.ts:92` already exists — extend the
   same hide-during-capture treatment to the camera preview, teleprompter,
   and scene overlay windows, or (X11 path) exclude their bounds via a crop.
   Area selector already closes before capture starts — verify.
2. **Permissions UI** (`app/service.ts`): on Linux return
   `screen: 'granted'` for X11; for Wayland, screen permission is asked by
   the portal at record time — represent it as `'not-determined'` and skip
   the pre-flight gate. Mic/camera prompts are handled by Chromium/portal.
   Settings deep-link stays `null` (no universal Linux equivalent).
3. **Global shortcuts**: `globalShortcut` (F9, scene-overlay bindings) works
   on X11, unreliable on Wayland — wrap registration in a try/log and don't
   treat failure as fatal.
4. **Tray**: GNOME needs the AppIndicator extension; guard tray creation and
   fall back to the toolbar staying visible if tray creation fails (this
   interacts with fix #1 — never leave the user with zero stop-recording
   affordance).
5. **Updater**: leave disabled (`updater/service.ts:203`) — deb/rpm update
   through package managers. Revisit AppImage self-update later.
6. Sweep the remaining mac-isms: `titleBarStyle: 'hiddenInset'`,
   `app.dock?.` (already optional-chained), always-on-top levels
   (`'screen-saver'`, `'modal-panel'`) — verify each degrades sanely under
   GNOME/KDE window managers.

## Phase 7 — CI / release

1. New `.github/workflows/build-linux.yml` on `linux-v*` tags (mirroring
   `build-windows.yml`): `ubuntu-22.04` runner (older glibc = wider
   compatibility), `download:ffmpeg:linux`, `pnpm make:linux`, upload
   deb/rpm/AppImage/zip artifacts to R2 (extend
   `scripts/upload-release-to-r2*.sh`).
2. Extend `ci.yml` to at least run `electron-forge package` on
   ubuntu so packaging regressions surface in PRs.
3. `scripts/create-release-tag.sh`: support the `linux-v*` tag family.

## Phase 8 — Test matrix

| Environment | What to verify |
|---|---|
| Ubuntu 22.04 / X11 | x11grab capture 60fps, cursor events via uiohook, auto-zoom, pause/resume, crop, export, tray |
| Ubuntu 24.04 / Wayland (GNOME) | portal picker, screen + window capture, cursor visible in video, effects gracefully disabled, pause/resume |
| Fedora / Wayland (GNOME) | rpm install, portal capture |
| Kubuntu / KDE Plasma (Wayland + X11) | portal on KDE, tray, global shortcuts |
| XWayland edge case | app must choose the Wayland path, not x11grab |
| No-portal environment (bare WM) | clear error message, no crash |

Also: `pnpm test:all` on ubuntu CI, `verify:packaged:export` for the export
worker on Linux (Pixi/WebGL in a hidden window — verify GPU/swiftshader
fallback works on the runner).

---

## Suggested sequencing

1. **Milestone 1 — "it builds"**: Phases 4 + 5 (ffmpeg bundle, forge fixes,
   icon, AppImage/deb/rpm produced locally).
2. **Milestone 2 — "X11 records well"**: Phases 1 + 2 + 6 (session
   detection, 60fps x11grab, uiohook staging, overlay hiding, permissions).
3. **Milestone 3 — "Wayland records"**: Phase 3 Option A (portal capture via
   MediaRecorder, effects degradation UX).
4. **Milestone 4 — "shippable"**: Phases 7 + 8 (CI, R2 uploads, test matrix
   sign-off).
5. **Later**: native Linux helper (Phase 3 Option B) for cursor metadata +
   60fps parity; libei input capture; AppImage self-update.
