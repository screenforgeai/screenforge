# screenforge

## 0.6.15

### Patch Changes

- 9907bf8: **Camera — Layout Presets**
  - New layout modes for the camera widget: Left panel, Right panel, and Full screen — selectable from the Camera widget sidebar with visual icon pickers
  - Side-panel layouts divide the canvas into a camera strip and a recording panel; the recording video fills its panel without squishing
  - Camera overlay editor adapts its drag handle position and constraints per layout
  - Side-panel camera pops out to a floating overlay as zoom increases, smoothly transitioning back when zoom returns to 1×
  - Screen rect fades smoothly back to full canvas when a side-layout clip ends with no following clip

  **Zoom & Rendering**
  - Sharpening filter gated above 1.75× zoom — maintains 60 fps during zoom ramps, sharpening only activates at near-peak zoom
  - `getFrameGeometryForPanel` added to correctly position content inside a side-layout panel for both Canvas 2D preview and Pixi.js export

  **Import / Record More — Timing Fix**
  - Fixed a timing mismatch where imported or "Record More" clips would play from a forwarded position instead of their start
  - Root cause: `sourceStart` was computed as a running sum of probed durations; each FFmpeg `-r 30` re-encode rounds to the nearest frame (up to 33 ms drift), accumulating across multiple append sessions
  - Fix: the actual merged file is now probed with `ffprobe` after every concat, and `sourceStart = actualMergedDuration − clipDuration` is used instead of the estimated sum

  **Cursor**
  - Cursor hidden for imported video clips — inserted clips are now marked `cursorEnabled: false`; both the live preview and export renderers hide the cursor overlay for the duration of that segment
  - Cursor hide-when-idle jitter fix: mouse moves now require at least 8 px of travel before registering as activity, preventing OS/hardware pointer jitter from resetting the idle timer

  **Native Capture Engine (macOS)**
  - Improved error handling when ScreenCaptureKit terminates the stream unexpectedly: stream reference is nil-ed on the main queue so `stopWithCompletion:` finalises the `AVAssetWriter` cleanly with whatever frames were captured

## 0.6.14

### Patch Changes

- a48fd8a: Windows release

## 0.6.13

### Patch Changes

- 720f5d2: Fix telemetry issue
- 6a1baad: Fixed telemetry issue in windows

## 0.6.12

### Patch Changes

- 50e01f6: Fix windows pipeline

## 0.6.11

### Patch Changes

- 7bb8d23: Fix windows build issue and crash detection

## 0.6.10

### Patch Changes

- 3cc7d75: Updated CI/CD pipeline of windows build

## 0.6.9

### Patch Changes

- cfac4ef: **Windows support** — Screenforge is now available on Windows. Download the installer and get the same recording and editing experience on Windows 10 and 11.

  **Cursor layering fixed** — Resolved an issue where the mask effect was rendering on top of the cursor instead of behind it, causing the cursor to disappear under masked regions. The cursor now correctly appears above all background effects on both macOS and Windows.

## 0.6.8

### Patch Changes

- 19a0987: **Import video from file** — you can now import an existing video (MP4, MOV, WebM, AVI, MKV, M4V) as a new project directly from the sidebar "+" menu or the system tray. The imported clip lands in the timeline ready to edit, with its embedded audio preserved.

  **Redesigned support modal** — the Ko-fi milestone modal now shows a desk-scene illustration, a cleaner layout, and a full-width call-to-action button.

## 0.6.7

### Patch Changes

- 25735bb: **Auto zoom and marker layer restored** — Fixed a regression where auto zoom was not applied to new recordings and the timeline click markers were missing. The toolbar window was expanded to full-screen in a previous release, but its bounds were still being used to filter cursor events — silently dropping every click and scroll recorded during a session. Cursor tracking now works correctly again.

  **Processing state restored** — The canvas now correctly clears while a new recording is being processed, showing the loading indicator before the new recording loads.

## 0.6.6

### Patch Changes

- 1f5f5ac: **Auto zoom restored** — Fixed a regression where auto zoom was not being applied to new recordings. The rendering pipeline is no longer torn down between recordings, so detected zoom clips are correctly applied on load.

  **Menu bar icon fixed in packaged builds** — The Screenforge menu bar icon now loads correctly from the app bundle in production. Previously it could fail to appear after installation.

  **Menu bar icon color corrected** — The fallback menu bar dot icon now renders in the correct brand color instead of an inverted blue.

## 0.6.5

### Patch Changes

- 0f48762: **Area recording** — You can now record a custom region of your screen. Click the crop icon in the floating toolbar to draw a selection, then start recording. A dark overlay dims everything outside your chosen area during countdown and recording.

  **Draggable toolbar** — The floating recording toolbar can now be repositioned anywhere on screen by dragging the grip handle at the top.

  **Style presets** — Save your current look (background, cursor, camera, keyboard, captions) as a named preset and apply it to future recordings in one click from the top bar.

  **Menu bar icon** — Screenforge now lives in the macOS menu bar. Quickly start a new recording, open the app, or stop an active recording — with a live timer — without switching windows.

  **Camera preview window** — The camera feed now appears in a separate floating window that stays on top of all apps while recording.

  **Privacy masks** — Hide sensitive content in your recordings with blur or solid-color masks. Draw a mask over any region and it will follow your content through zoom, pan, and cinematic tilt automatically.

## 0.6.4

### Patch Changes

- 0bbfa88: **Clip speed control** — Change the playback speed of individual video clips (0.25× – 4×) from the Video widget. Adjacent clips and zoom markers ripple automatically to stay in sync.

  **Diagnostic logs in feedback** — When sending a bug report, you can now opt in to attach recent app logs so issues are easier to diagnose.

  **Fixed** — Camera feed was not visible in exported videos.

## 0.6.3

### Patch Changes

- 4dadb8c: Added cinematic zoom — a new zoom preset with depth-of-field blur, screen tilt, background fade, and 3D perspective. Can be added from the zoom widget or directly from the timeline. Tilt direction (left or right) is user-controlled per clip, defaulting to left.

  Camera overlay position is now tracked per clip, allowing the camera bubble to follow different positions across clips.

  Camera widget controls updated: shape, mirror, roundness, shadow, and zoom response are now organized into labeled sections.

  Cursor widget now has an enable/disable toggle and exposes a continuous tracking setting.

## 0.6.2

### Patch Changes

- 0fdd5a6: - Fixed first-play stutter in the canvas preview caused by Chromium shrinking the video decode buffer for small elements
  - Improved preview playback smoothness by caching frame geometry and shadow rendering — skips expensive recomputation when nothing has changed
  - Fixed cursor click sounds occasionally missing or double-firing during playback
  - Grouped overlapping keyboard shortcut and mouse click indicators on the timeline so they no longer pile up at the same position
  - Fixed memory growth during very long recordings by capping stored cursor events
  - Unsaved-change detection is now O(1) — no longer stringifies the full project state on every edit

## 0.6.1

### Patch Changes

- 7831a1a: ## Background Music

  You can now add background music to your recordings. Open the new **Music** widget from the sidebar, click **Add Music**, and pick any MP3, WAV, M4A, or AAC file — it appears as a track on the timeline and loops automatically for the full duration of your clip.
  - **Multiple tracks** — add as many tracks as you need; each appears as Track 1, Track 2, etc. with a timestamp range
  - **Volume control** — adjust each track independently with the volume slider in the expanded panel
  - **Fit to video** — right-click any music clip on the timeline to stretch it to the full video length in one click

  ## Settings & Language

  Added a Settings panel accessible from the top nav. You can now set your name and email (used for crash reports and analytics) and switch the app language without restarting.

  ## Internationalization

  Screenforge is now available in six additional languages: German, Spanish, French, Japanese, Korean, and Portuguese. The language can be changed at any time from Settings → Language.

  ## New Wallpapers

  Three new background wallpapers are available in the Frame widget: **Shadeshifter** (soft blue abstract), **Ember** (fiery orange-purple wave), and **Sparkle** (neon light streaks on dark).

  ## Support Modal

  Added a Ko-fi support prompt that appears at usage milestones to help sustain solo development.

## 0.6.0

### Minor Changes

- 8a22900: ## Custom wallpaper upload

  You can now use any image from your computer as a wallpaper background. Click the **+** tile in the wallpaper grid, pick an image, and it appears in the grid as a selectable preset — selected instantly. Your custom wallpaper is also correctly applied when you export.

  ## 6 new wallpaper presets

  The built-in wallpaper collection has been refreshed with six new backgrounds alongside the existing set.

  ## Clip transitions (Video panel)

  A new **Video** panel lets you add animated transitions between your recording clips. Choose from fade, fade to white, slide (up / down / left / right), grow, shrink, and blur — each with an adjustable duration.

  You can now add a **Transition In** on the first clip for a polished intro effect, and a **Transition Out** on the last clip for a clean outro.

  ## Canvas aspect ratio selector

  A new aspect ratio picker in the top bar lets you choose the output shape of your canvas: **Auto** (matches your recording), **Widescreen** (16:9), **Story** (9:16), **Square** (1:1), **Portrait** (4:5), or **Landscape** (4:3).

  ## Recording list now shows duration

  Each project in the recordings list now displays its total timeline duration so you can spot the right clip at a glance.

## 0.5.9

### Patch Changes

- 3cb4b06: **Captions — full appearance control**

  You can now style your captions exactly how you want them. A new Appearance panel lets you choose from 12 curated fonts, adjust size, toggle bold and italic, set text color and opacity, control the background pill color, opacity, and corner radius, and place captions at the top, center, or bottom of the frame. Each setting resets back to defaults with a single click.

  Karaoke-style word highlighting has been upgraded to use your chosen highlight color, with future words fading to 40% opacity so the active word always stands out clearly.

  Right-clicking a caption segment now shows a delete option, alongside the existing double-click-to-edit shortcut.

  Recordings without an audio track now show a clear message in the Captions panel instead of a disabled transcribe button with no explanation.

  **Export quality — sharper unzoomed sections on Retina displays**

  When exporting a Retina Mac recording, unzoomed sections now receive an automatic sharpening pass tuned to the source-to-output downscale ratio. Previously the sharpening filter only activated during zoom clips, causing a visible quality gap between zoomed and normal shots. The filter now runs throughout the entire export, with the strength scaling up further as you zoom in.

  **Crop editing fixes**

  The crop overlay no longer jumps or misaligns while dragging handles. The preview container and the Pixi canvas now stay locked to the full source geometry during editing, so what you see matches what you drag.

  **Playback — text clips deselect on play**

  Pressing play while a text clip is selected now deselects it automatically, preventing the text editor from staying open while video plays back.

## 0.5.8

### Patch Changes

- e14a79a: Add Text widget for creating styled text overlays on screen recordings. Text clips can be placed, resized, and dragged directly on the canvas preview. Each clip supports rich formatting (font, size, bold, italic, underline, horizontal and vertical alignment, roundness), text and background color with opacity, timeline-based in/out animations (fade, slide-up, slide-down), and is fully rendered in exported video.

## 0.5.7

### Patch Changes

- de61c54: Fixed a black screen that appeared when playing across a deleted segment boundary. Previously, deleting a middle segment and playing through the resulting cut would show a black frame lasting as long as the deleted segment. Transitions between segments now fade out and fade in smoothly regardless of whether segments are contiguous or separated by a delete.
- 2eb81ac: Fixed pending continue recording state and audio clip issue

## 0.5.6

### Patch Changes

- 4e68a70: Force deployment

## 0.5.5

### Patch Changes

- 3894794: Video clips on the timeline can now be moved freely to any position, including back to the start. Previously, cutting a clip and deleting the first portion would leave the remaining clip stuck — it couldn't be dragged to position zero or past where adjacent clips used to be. Clips now move just like zoom clips: no ordering restrictions, full freedom to reposition anywhere on the timeline.

  Fixed a bug where manually added zoom clips had no effect. Auto-generated zoom clips were always sorted by time, but clips added by hand were appended to the end of the list. Since the zoom renderer uses binary search, unsorted clips were silently skipped during playback and export.

## 0.5.4

### Patch Changes

- 44bae6d: CI/CD reverted

## 0.5.3

### Patch Changes

- 470f87d: **Smoother preview and lower memory usage** — The editor preview no longer stutters on Retina displays. Recording sessions now release event data from memory immediately after stopping. The processing indicator has been replaced with a refined waveform animation.

## 0.5.2

### Patch Changes

- 7b98445: **Main window opens on launch** — The editor now opens automatically when the app starts. Previously, only the floating recording toolbar appeared on launch, requiring a manual step to reach the editor.

## 0.5.1

### Patch Changes

- 1bd9149: **Fix timeline jitter** — Moving the mouse over the timeline no longer causes stuttering or jittering. The ghost zone indicator that appears in empty timeline lanes was triggering a full re-render of the timeline on every pixel of mouse movement, and additionally re-rendering during drag operations, which disrupted clip dragging. All three causes have been fixed.

## 0.5.0

### Minor Changes

- c6a4eef: **Append recording** — You can now extend an existing recording directly from the timeline. Hover past the last clip in the video track to reveal a "+" button, click it, and the recording toolbar opens in append mode (indicated by an "Appending to timeline" badge). Record normally with any mic and camera combination you choose, stop when done, and the new clip is automatically joined onto your existing recording and placed as a new segment in the timeline. The append is undoable with Cmd+Z.
- e9bb250: **Camera Follow mode** — The Cursor widget now has a "Camera Follow" section with two modes. **Smooth** (default) keeps the existing behavior where the camera continuously tracks the cursor inside a zoom clip. **Fixed** locks the camera in place and only snaps to a new position when the cursor moves outside the visible frame — useful for recordings where you want a stable, minimal-movement look.

  **Export: no black bars for full-screen recordings** — Exporting without a background (padding set to 0) now produces a video that matches the recording's native aspect ratio exactly. Previously, 16:10 MacBook recordings would export with letterbox bars on the sides. The output is now cropped to the content with no bars and no clipping.

  **Clip-boundary fade** — When a project contains multiple video segments, the export now adds a short crossfade at the cut points between clips so transitions look polished rather than abrupt.

  **Timeline ghost zone: append-or-insert dropdown** — Clicking the "+" ghost on an empty section of the video track now opens a small dropdown. "Record more" launches the recording toolbar in append mode (same as before). An "Insert clip" option is shown as a coming-soon teaser for an upcoming feature.

## 0.4.1

### Patch Changes

- 41cc95b: **Timeline multi-select** — Hold ⌘/Ctrl and click to select multiple clips at once, then delete them all in one go. Press ⌘A to select all clips, Escape to clear the selection.

  **Improved audio waveform** — Waveform bars are denser, vertically centred, and auto-normalise to the loudest peak in the clip so quiet recordings no longer appear flat.

  **Audio track visibility** — The audio lane only appears when you recorded microphone audio; recordings without a separate audio track no longer show an empty lane.

  **Tooltips across the UI** — Timeline toolbar buttons (undo, redo, split, play/pause, stop, zoom), layer visibility toggles, and all sidebar nav icons now show hover tooltips.

  **Clickable indicator clips** — Clicking a mouse-click or keyboard indicator in the timeline now seeks the playhead to that moment.

  **Rounded timeline clips** — Clip corners are more rounded and content is correctly clipped inside the clip boundary.

## 0.4.0

### Minor Changes

- f925833: Add teleprompter — a floating, always-on-top speaker notes window that never appears in recordings.
  - Open it from the 3-dot menu in the toolbar; a spinner shows while it loads and a checkmark confirms it's ready
  - Write your script in Edit mode, then hit Start to begin auto-scrolling
  - In Play mode: pause/resume by clicking the text or pressing Space, restart from the toolbar, adjust font size (A− / A+) and scroll speed from the bottom bar, press Escape to go back to editing
  - Script, font size, and speed are saved between sessions
  - Teleprompter closes automatically when the recording stops

## 0.3.16

### Patch Changes

- 1e14e77: Captions now generate reliably in the packaged app. Fixed an issue where transcription would fail silently on first run after installation.

  The editor now runs noticeably smoother, especially on older or lower-end Macs. Playback, scrubbing, and adjusting settings like zoom, blur backgrounds, and keyboard shortcuts should feel more responsive with less stuttering.

## 0.3.15

### Patch Changes

- 42501dd: Fixed a crash that occurred when generating captions in the packaged app. The transcription engine's native libraries are now correctly extracted alongside their companion files, allowing them to load properly at runtime.

## 0.3.14

### Patch Changes

- f7f8e6b: Sharper recordings and smoother preview. Recordings now capture at your display's full native resolution, so exported videos are crisp even on Retina and high-DPI screens. Preview playback is kept lightweight so it stays smooth while you edit — a small "Preview" badge in the corner of the canvas lets you know the export will always be full quality.

## 0.3.13

### Patch Changes

- 0843b37: Sharper recordings and smoother preview. Recordings now capture at your display's full native resolution, so exported videos are crisp even on Retina and high-DPI screens. Preview playback is kept lightweight so it stays smooth while you edit — a small "Preview" badge in the corner of the canvas lets you know the export will always be full quality.

## 0.3.12

### Patch Changes

- a62a25d: **Captions** — When keyboard shortcut captions and transcription captions are both active, the keyboard caption now floats above the transcription caption so both are fully visible at the same time.

## 0.3.11

### Patch Changes

- 0e2ae4e: **Captions** — Transcribe your recordings directly in the app using on-device AI (Whisper). Choose from four models: Tiny, Base, Small, or Medium. Captions render live on the canvas as the video plays, with each spoken word highlighted in real time. Click any word to jump to that moment. Double-click a line to edit the text. Edits are fully undoable with Cmd+Z. Captions are saved with your project and burned into the export automatically when the Captions toggle is on.

  **Export** — Quality now defaults to High.

## 0.3.10

### Patch Changes

- 54b3d06: Fixed keyboard shortcut caption appearing off-center in exported videos when the source recording has a non-16:9 aspect ratio (e.g. MacBook 16:10 screens). The caption position now correctly accounts for the stage offset applied during letterboxed exports.

  Fixed pulse times for keyboard shortcut combos not being remapped through timeline segment edits, ensuring animation timing stays accurate after cuts.

  Fixed timeline ruler labels (e.g. "10s") being clipped at the right edge of the viewport.

## 0.3.9

### Patch Changes

- b7eb480: **Recordings panel improvements**
  - Replaced the grid/list layout toggle with a streamlined grid-only view
  - Delete button on each recording is now a trash icon with a red hover state instead of a plain ✕
  - Right-click any recording to open a context menu with a Delete option
  - New ⋯ overflow menu in the panel header with a "Delete all" option (includes confirmation dialog with a loading state)

  **Keyboard shortcuts modal**
  - A new ⌘ button in the sidebar sidebar opens a Keyboard Shortcuts modal listing all shortcuts grouped by Playback, Editing, and View

  **Export modal**
  - Clicking outside the Export dialog while not actively exporting now closes it

  **Timeline indicator styling**
  - Mouse-click and keyboard-shortcut indicators on the timeline now use a unified neutral dark pill (dashed border) instead of purple/cyan tints

## 0.3.8

### Patch Changes

- 02172da: Fixed an issue where Screenforge did not appear in System Settings > Privacy & Security > Screen Recording after launch, requiring users to manually add it using the "+" button. The app now registers itself automatically.

## 0.3.7

### Patch Changes

- e124684: **Faster exports** — Videos now export significantly faster thanks to an improved rendering pipeline.

  **Export progress in the toolbar** — The export progress indicator is now a clickable button that opens the export panel so you can check on or cancel an ongoing export.

  **System notification on export complete** — You'll now get a system notification when your export finishes, even if you've switched to another app.

  **Fixed black bars in exported videos** — Recordings from non-16:9 displays (like MacBooks with 16:10 screens) no longer have uneven black bars on the sides of the exported video.

- 98b5331: Zoomed content now looks noticeably sharper and crisper. Recordings are also preserved at full quality during processing, so fine details like text and UI elements stay clear when zoomed in.

## 0.3.6

### Patch Changes

- 173eba4: Fix KeyboardWidget test assertions to match actual defaults and available options: correct the toggle test to reflect that keyboard captions are enabled by default, and replace the non-existent "warm" background option with "light".

## 0.3.5

### Patch Changes

- e083f4f: Replace `satisfies` keyword with `as` cast in keyboard analyzer test to restore compatibility with the project's TypeScript 4.5 compiler.

## 0.3.4

### Patch Changes

- b355bef: Add keyboard captions, timeline indicators, and focus mode.

  **Keyboard captions**: Records keyboard shortcuts during screen capture (via native `EventMonitor` and `uiohook`) without storing plain typed text — only key categories, modifier state, and safe labels for shortcuts/navigation/modifiers are persisted. A new Keyboard widget lets users enable captions and configure size and background style. Settings are included in export and project persistence.

  **Timeline indicators**: A new read-only `Markers` row appears above the Video track when a recording contains keyboard shortcuts or mouse clicks. Shortcut combos and click events are merged into grouped pills (with tooltips) rendered via an absolutely-positioned overlay that tracks scroll position.

  **Focus mode**: Hides the sidebar with an animated collapse so the canvas fills the full width. Toggled by the `` ` `g` key or a Maximize/Minimize button in the canvas preview. The timeline also collapses to its minimum height while focus mode is active.

## 0.3.3

### Patch Changes

- 60ec006: Fix shadow not following crop boundary in frame preview

  When a crop was applied that changed the aspect ratio, the drop shadow remained anchored to the full content rect rather than the cropped video area. The shadow glow was also hidden in the letterbox region by an opaque background repaint. Shadow shape now matches the cropped media rect and the background repaint is restricted to that same area so the glow is correctly visible around the video content.

  Remove border from floating toolbar window selection chip

  The window selection chip in the floating toolbar had a subtle ring border (`ring-1 ring-white/12`) that has been removed for a cleaner appearance.

## 0.3.2

### Patch Changes

- 6ef5733: Added discard recording action to the floating toolbar. A trash icon now appears in the recording bar alongside pause and stop. Clicking it shows an inline confirmation prompt — confirming discards the recording immediately without saving, stops all capture streams, and resets the toolbar to idle.

## 0.3.1

### Patch Changes

- 70da3cb: Improved the capture quality and fix the export issue

## 0.3.0

### Minor Changes

- c30ceee: Migrate canvas renderer to PixiJS, overhaul export cancellation, and improve recording quality.

  **PixiJS renderer**
  - Replace the Canvas 2D renderer (`useCanvasRenderer`) with a PixiJS-based renderer (`usePixiRenderer`) for smoother, GPU-accelerated preview.
  - Add `src/lib/pixi/` module with a composable effect pipeline, texture quality management, and a PixiJS app factory.
  - Port all effects to PixiJS: camera overlay (`camera/pixi.ts`), cursor (`cursor/pixi.ts`), frame/background (`frame/pixi.ts`), and zoom (`zoom/pixi.ts`).

  **Export cancellation overhaul**
  - Track export phase (`finalizing` | `writing` | `encoding`) and propagate cancellation through all phases via `AbortController`.
  - Video-only exports (no audio, no GIF) now bypass FFmpeg entirely — the muxed file is moved (or chunk-copied) directly to the output path, making common exports significantly faster.
  - Cancellable chunked file copy honours the abort signal on every 8 MB chunk and cleans up partial output on cancel.
  - Fix muxer finalization to be idempotent: concurrent `finalize()` calls share a single promise, and a `cancel()` after finalization is a no-op.
  - Remove `-movflags +faststart` from the FFmpeg encode step (it is unnecessary for the direct-copy path).

  **Recording quality**
  - Add `captureQuality.ts` with a `computeFallbackCaptureBitrate` helper that sizes the capture bitrate to the display's backing pixel count (0.22 bpp, clamped 35–220 Mbps).
  - Use the computed bitrate for the macOS `h264_videotoolbox` fallback capture (`-b:v`, `-maxrate`, `-bufsize`); raise quality flag from `q:v 80` to `q:v 100`.
  - Switch `libx264` fallback preset from `ultrafast` to `veryfast -tune zerolatency` and tighten CRF from 18 → 14 for better capture fidelity.
  - Update `ScreenforgeCapture` native binary with matching dynamic bitrate logic.

  **Updater**
  - Add `checkForUpdatesNow` IPC channel (`updater:check-now`) and surface it through the updater bridge, allowing the renderer to trigger an immediate update check.
  - Add diagnostic logging throughout the updater service (adapter creation, state transitions, feed URL).
  - Fix: reset the `willQuitForUpdate` flag when `restartToApplyUpdate` throws so the app does not get stuck in a quit-blocked state.
  - Fix: unsubscribe the diagnostic state logger in `resetUpdaterForTests` to prevent cross-test state leakage.

  **Tests**
  - Add tests for the export service (direct-move path, cancellation during muxer finalization).
  - Add tests for `captureQuality` helpers.
  - Add tests for updater controller manual-check scenarios.
  - Add tests for the PixiJS pipeline, texture quality, zoom effect, video encoder, and render sizing.

### Patch Changes

- c2ac55a: Improve export speed by increasing encoder pipeline depth (4→12 frames), doubling the decode canvas pool, and reducing chunk batch flush delay (500ms→100ms).
- c2ac55a: Improve export encoder quality selection.

## 0.2.5

### Patch Changes

- f9cd16b: Redesigned the feedback modal into a full in-app form that submits reports directly via Sentry (bug / idea / help), replacing the previous external link flow. Name, email, and detail fields are required; analytics events are tracked on start, success, and failure.

  Exposed anonymous telemetry ID to the renderer so Sentry errors in both the main and renderer processes are correlated to the same user.

  Added `recording_started` analytics event with source type, mic/camera status, and startup latency.

  Fixed the packaged DMG volume icon showing the default Electron logo instead of the Screenforge icon.

## 0.2.4

### Patch Changes

- 9bc06ec: Fix Dock icon disappearing when the app window is closed on macOS 14+. The X button on the floating toolbar now minimizes to the Dock instead of quitting the app.

## 0.2.3

### Patch Changes

- b3dfae3: Fix "Restart & install" update button not restarting the app. The hide-on-close and before-quit handlers were blocking the quit signal from the auto-updater, causing the app to silently hide instead of restarting to apply the update.

## 0.2.2

### Patch Changes

- d911fca: Fix FFmpeg binary for macOS arm64 by switching from runtime download to a bundled native build.

## 0.2.1

### Patch Changes

- 8020642: Replace Homebrew-based FFmpeg installation with a direct binary download. The setup modal now shows a progress bar instead of raw terminal output. FFmpeg is saved to the app's user-data directory and is detected automatically on subsequent launches.

  Fix a bug where `isCropEditing` was not cleared when switching away from the frame widget tab, leaving the canvas in an unexpected crop state.

  Disable text selection globally (body/root) and re-enable it only for inputs, textareas, and elements with `.sf-allow-selection`.

  Hide the main window on close on macOS instead of quitting, so the app stays in the Dock and can be reopened without relaunching.

## 0.2.0

### Minor Changes

- 71fa7dc: Screenforge is now publicly available. Record your screen, and let Screenforge automatically zoom and follow your cursor to keep every interaction in focus. Edit your timeline, trim clips, and export to MP4, MOV, WebM, or GIF — all processed locally.

## 0.1.3

### Patch Changes

- 3a65c92: Switched from bundled FFmpeg to system FFmpeg via Homebrew
  - Removed all bundled FFmpeg infrastructure: binaries, build scripts (`build-ffmpeg-macos.sh`, `write-ffmpeg-build-manifest.mjs`, `ffmpeg-doctor.mjs`), shared paths module, and `forge.config.ts` extra resources
  - FFmpeg is now resolved from system paths (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`) or a `SCREENFORGE_FFMPEG_PATH` env override
  - Added `FFmpegSetupModal` that prompts new users to install FFmpeg via Homebrew, streams live terminal output, and handles success/error phases
  - Added FFmpeg availability check on app launch; shows setup modal automatically if FFmpeg is missing
  - Added FFmpeg missing warning banner in ExportModal with a direct link to open the setup modal
  - Export button is now disabled immediately on click (with spinner) to prevent double-submits while the export initializes

## 0.1.2

### Patch Changes

- 4b07dda: Redesigned the update prompt to match the app's design system — replaced warm hardcoded colors with theme tokens, normalised font sizes, and replaced the release notes section with a direct link to the changelog.

## 0.1.1

### Patch Changes

- 060fc9f: Fixed floating toolbar appearing in recorded videos by always using ScreenCaptureKit on macOS 13+ (removes AVFoundation fallback that captured toolbar pixels) and hiding the toolbar before the capture stream initialises.

  Fixed PostHog analytics events being silently dropped — reduced flush threshold and ensured pending events are flushed before the app exits.

## 0.1.0

### Minor Changes

- 7bc05cb: **Build**
  - Fixed app failing to launch due to invalid dependency

## 0.0.24

### Patch Changes

- Replace the old manual update banner with a native macOS auto-update flow for packaged arm64 builds.
  - Check for updates in the background and download them automatically.
  - Show a quiet in-app `Update ready` prompt once the update is downloaded and the app is idle.
  - Delay install prompts while recording or export work is active, then let the app restart after pending work is saved.
  - Publish the macOS updater feed (`RELEASES.json` and update ZIPs) alongside normal release artifacts in the release pipeline.

## 0.0.23

### Patch Changes

- 76f0efe: Added native auto-update support for packaged macOS arm64 builds.
  - Replaced the old manual upgrade flow with background update checks and downloads.
  - Added a quiet in-app `Update ready` prompt that lets you restart and install once your work is saved.
  - Updated the release pipeline to publish the macOS updater feed alongside normal release artifacts.

## 0.0.22

### Patch Changes

- 1c44dbf: Fix macOS DMG packaging in the release pipeline.
  - Allow the native `macos-alias` and `fs-xattr` install builds required by the DMG maker.
  - Apply the same native build allowlist inside the release workflow so manual reruns against release tags use the correct install policy.
  - Improve release reliability for macOS artifact generation without changing the stable release flow.

## 0.0.21

### Patch Changes

- 00fffb9: Improve CI/CD release automation and macOS packaging reliability.
  - Enable auto-merge for the `Version Packages` PR and rely on GitHub auto-delete for the release branch after merge.
  - Fix macOS `.dmg` packaging in CI by allowing the native `macos-alias` install build required by the DMG maker.
  - Keep published release notes and webhook changelog payloads aligned with the exact version section from `CHANGELOG.md`.

## 0.0.20

### Patch Changes

- bfe8d85: Improve release automation and macOS distribution in the CI/CD pipeline.
  - Enable auto-merge for the `Version Packages` PR and rely on GitHub auto-delete for the release branch after merge.
  - Build and publish macOS `.dmg` artifacts, and prefer `.dmg` as the public download asset over `.zip`.
  - Keep release webhook sync aligned with the exact version changelog content so published release notes match `CHANGELOG.md`.

## 0.0.19

### Patch Changes

- 5c39201: Fix release changelog publishing so version notes match the exact `CHANGELOG.md` section.
  - Generate GitHub release notes from the current version block in `CHANGELOG.md`.
  - Send the same version-specific changelog block to the release webhook.
  - Preserve the version heading in changelog payloads instead of dropping it.

## 0.0.18

### Patch Changes

- ee616d0: Improve release webhook sync so published versions always send changelog content to the backend.
  - Include `changelog` in the release webhook payload.
  - Resolve changelog from the current version section in `CHANGELOG.md`, with fallback behavior in CI.
  - Update the release sync workflow and CI/CD docs to reflect the changelog contract.

## 0.0.17

### Patch Changes

- 07ae923: Improve recording and export reliability.
  - Fix paused recordings so pause/resume timing is preserved consistently across the toolbar, saved recording metadata, editor timeline, and final export.
  - Update the floating toolbar pause state so the recording indicator, timer, and play/pause control reflect the live recording state correctly.
  - Harden long exports by clamping playback to the real media duration, adding safer decode-stall recovery, and reducing unnecessary per-frame work during capture rendering.
  - Improve camera export smoothness by capturing higher-quality webcam video and keeping the camera overlay in smoother playback sync during export.

## 0.0.16

### Patch Changes

- 03fcb51: Updated pipeline

## 0.0.15

### Patch Changes

- d80c0a2: Updated npmrc

## 0.0.14

### Patch Changes

- 708e0e1: Fix release automation reliability for tag-based builds.
  - Ensure the release workflow can run with an explicit `tag` input.
  - Prevent private-repo checkout/auth failures in release runs.
  - Improve CI-to-release handoff so packaged artifacts are generated and attached consistently.

## 0.0.13

### Patch Changes

- 55b4739: Fix release automation so production artifacts are reliably attached to version releases.
  - Trigger `release.yml` explicitly after creating a version tag in CI.
  - Add `workflow_dispatch` tag input support to the release workflow.
  - Ensure releases run against the intended tag and publish ZIP artifacts + checksums consistently.

## 0.0.12

### Patch Changes

- f5fb354: Patch for CI/CD tag release

## 0.0.11

### Patch Changes

- a3de980: Revamp release automation and harden CI/CD for main-branch delivery.
  - add a Changesets release workflow that opens/updates version PRs and auto-tags releases
  - move CI/Changesets base branch handling to `main` and enforce changesets on releasable PRs
  - upgrade macOS release flow with checksum generation, draft stable releases, and conditional signing/notarization scaffolding
  - upload release binaries to Cloudflare R2 and sync published release metadata to the backend webhook
  - improve pipeline security with pinned GitHub Action SHAs, safer checkout defaults, and stricter webhook/upload validation

## 0.0.10

### Patch Changes

- - Add app update checks through a remote endpoint and show an in-app update banner with an upgrade link.
  - Improve timeline editing with global keyboard shortcuts, per-segment audio/video track toggles, and audio waveform rendering for audio clips.
  - Upgrade cursor customization to a state-based Mac-style cursor set (`default`, `pointer`, `text`) with animated state previews and runtime state transitions.
  - Extend renderer/main bridge and shared types for update events, and add SVG module typings for new cursor assets.

## 0.0.9

### Patch Changes

- Add a native macOS ScreenCaptureKit capture path (macOS 13+) with FFmpeg fallback on other platforms/versions.
  - Add and integrate the `ScreenforgeCapture` helper for display capture plus cursor/click/scroll event streaming.
  - Improve cursor fidelity on Retina/mixed-scale displays via native coordinate normalization and add support for `resize` cursor type.
  - Exclude the floating toolbar from native recordings by assigning a stable toolbar window title and passing it to the helper.
  - Add native helper build/packaging support (`build:native:macos` script, bundled binary, and macOS screen-recording usage description).
  - Improve native capture lifecycle handling with explicit ready detection, graceful stop, and pause/resume controls.

## 0.0.8

### Patch Changes

- Improves project persistence in the editor with autosave, required titles before leaving unsaved work, and better save/load handling when switching, deleting, or starting recordings. Saved projects now preserve cursor settings and older projects fill in missing cursor defaults safely.

  Refreshes several editor controls and empty states, including the top-bar title editor, recording library interactions, zoom level controls, cursor styling controls, and toolbar/icon sizing for a cleaner recording workflow.

## 0.0.7

### Patch Changes

- Add a complete local export workflow and improve timeline clip interactions.
  - Add Electron export IPC channels/bridge/service and expose them in preload.
  - Add export UI flow (TopNav + ExportModal + useVideoExport) with progress, cancel, and output path picking.
  - Extend FFmpeg export settings support (format, resolution, fps, audio options, CRF, encoder preset).
  - Add rendered timeline export pipeline integration.
  - Improve timeline UX: clip click seeks playhead reliably and blank-area seeking no longer interferes with clip dragging.
  - Enable moving video/audio timeline segments with bounds-safe segment movement logic to preserve playback stability.

## 0.0.6

### Patch Changes

- Added full editing history with undo/redo across timeline and editor widgets.
  - Added in-memory history stack with 100-step limit, grouped interactions, and redo invalidation on new edits.
  - Added undo/redo controls in timeline toolbar and keyboard shortcuts (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`).
  - Tracked timeline edits (split, trim, zoom move/resize/delete) and widget edits (zoom, cursor, background) in history.
  - Reset history on recording/project context switches (new recording, load, discard, delete-current) while keeping history after save.
  - Refactored store type definitions into `src/store/types.ts` and re-exported from `src/store/index.ts`.

## 0.0.5

### Patch Changes

- Adds a major recording and timeline editing update:
  - Adds optional microphone capture and FFmpeg audio/video merge with new IPC bridge APIs.
  - Refactors the floating toolbar into modular components and improves mic controls/UX.
  - Introduces segment-based timeline editing (split at playhead, trim handles, linked audio row rendering).
  - Improves playback behavior across timeline gaps with proper timeline-to-source mapping and black gap preview.
  - Persists timeline media segments in saved projects so split/trim edits survive reload.

## 0.0.4

### Patch Changes

- Background Effect
  - New BackgroundWidget with wallpaper, gradient, solid
    colour, and live-blur modes
  - 8 bundled macOS wallpaper presets (.webp) with a
    seed-based picker
  - Gradient presets + custom from/to colour + angle
    controls
  - Padding, corner radius, shadow blur/opacity controls
    for the screen frame
  - BackgroundSettings added to the store with
    setBackground patch action

- Cursor Capture & Rendering
  - New cursor style variants (cursor3, etc.) via
    cursors.tsx SVG definitions
  - Motion blur, max tilt, and halflife controls added
    to store and CursorWidget
  - Cursor analyze / render pipeline expanded to use new
    style options

- Zoom Effect
  - Added auto vs manual mode to ZoomClip — auto follows
    the captured cursor, manual uses fixed cx/cy
  - ZoomWidgetPositionPicker component for picking the
    manual zoom centre
  - Scale range expanded to 1.0–4.0

- FFmpeg Pipeline
  - New runner.ts — typed FFmpeg process wrapper with
    progress parsing
  - ingest.ts — post-recording ingest job (re-mux / fix
    moov atom)
  - export.ts — multi-segment trim + concat filter graph
    for split clips
  - delogo.ts — delogo filter helper
  - ffmpeg/index.ts aggregates all jobs

- Recording Service
  - Major expansion of recording/service.ts — Linux
    support, cursor event capture, recording area tracking
  - IPC channels updated in channels.ts and
    recording/channel.ts

- UI Components
  - Slider, Toggle, ToggleGroup, Button, IconButton,
    AlertDialog updated for new design tokens

## 0.0.3

### Patch Changes

- Core Recording
  - Native mouse tracking: Replaced
    screen.getCursorScreenPoint() polling with
    uiohook-napi hooks — captures mousemove, mousedown,
    mouseup, and scroll events natively. Fixes incorrect
    cursor position on Linux/Wayland.
  - Unique filenames: Switched from Date.now() to
    randomUUID() to prevent file collisions when
    recordings finish within the same millisecond.
  - Recording area: stopRecording now returns the
    captured display bounds (RecordingArea) alongside
    mouse events and start time, used to correctly map
    cursor coordinates during playback.

- Linux Support
  - Toolbar hidden during capture: On Linux, the
    floating toolbar is hidden when recording starts (so
    it doesn't appear in the capture). A system tray icon
    replaces it with a live elapsed timer.
  - Tray module (electron/modules/recording/tray.ts):
    Red-dot tray icon, F9 global shortcut to stop, desktop
    notification on start — all cleaned up on recording
    end.
  - Transparent toolbar window: Fixed black background
    on the floating toolbar by applying background:
    transparent on body for transparent-chrome windows
    (toolbar, splash hashes).

- Effects Engine (src/lib/effects/)
  - Zoom effect: Analyzes mouse activity to detect
    hotspots, generates ZoomClip keyframes with
    configurable strength and ease duration, renders
    animated zoom onto the canvas.
  - Cursor effect: Renders a styled cursor overlay on
    the canvas at the correct screen-space position,
    synchronized to recording timestamps.
  - Effect registry: Composable pipeline — effects are
    registered and applied in order during canvas
    rendering.

- UI Restructure
  - Replaced flat component layout (AppMain, AppWidgets,
    AppMainTimeline) with a three-panel Canvas +
    WidgetLibrary + TopNav architecture.
  - WidgetLibrary: Tab-driven sidebar with
    RecordingWidget, ZoomWidget, and CursorWidget panels.
    Active tab is driven from global store — switches to
    Zoom when recording ends, to Recordings when a project
    is saved.
  - TopNav: Project title editing, save/export actions,
    back navigation.
  - Canvas: CanvasPreview (video + effect overlay) +
    CanvasTimeline (zoom clip editing with drag-resize
    action clips).
  - Added ConfirmModal and TitleEditModal dialogs.

- State
  - Unified Zustand store (src/store/index.ts) replaces
    separate recording.ts and zoom stores. Tracks active
    widget tab, saved projects, current project, and
    playback state.
  - Fixed stale-closure bug in persistProject: now reads
    useStore.getState() after async save instead of
    captured closure value.

- Config & Tooling
  - ESLint: added react, react-hooks plugins; curly: all
    rule enforced.
  - Vite: src path alias added for cleaner imports.
  - tsconfig.json: path mappings aligned with alias.
  - screenforge:// custom protocol registered for secure
    local asset access.

## 0.0.2

### Patch Changes

- ### Added
  - Splash screen with logo, tagline, dot-grid background, accent glow,
    and a 2px bottom progress bar tracking preload steps
  - Floating toolbar — frameless pill-shaped overlay (blur + dark glass)
    anchored to bottom center with source tabs (Display / Window / Area),
    window picker dropdown, Record / Pause / Stop controls with live
    elapsed timer, microphone toggle, animated state transitions via
    Framer Motion, and tooltips on all icon buttons
  - IPC feature modules for app, library, recording, settings, and sources
    — each with bridge.ts, channel.ts, and service.ts; added
    electron/channels.ts as shared constants
  - UI library components: IconButton, Tooltip, DropdownMenu, Button,
    highlight/particles effects, Slot, and custom hooks
    (useControlledState, useDataState, useIsInView)
  - Structured logger at electron/lib/logger.ts
  - Prettier config, MCP config, and shadcn components.json

## 0.0.1

### Patch Changes

- ### Added
  - Electron 40 + React 19 + Vite project scaffold with Electron
    Forge
  - Home screen
  - ⌘ Shift R global keyboard shortcut to trigger recording
  - Custom dark design system (Tailwind CSS v4, sf-\*
    color/spacing tokens)
  - Dot-grid and accent-glow layered background effects
  - Changesets for version and changelog management
