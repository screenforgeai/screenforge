# Recording & Export — How It Works

A plain-language explanation of what happens when you record your screen and export a video in Screenforge.

---

## The Big Picture

```
[Your Screen] → Capture → Raw File → Edit/Preview → Export → Final Video File
```

There are two separate stages that each touch the video:

1. **Recording** — capturing what's on your screen into a file
2. **Export** — re-rendering that file with all your edits applied into a deliverable

---

## Stage 1: Recording

### What happens when you hit Record

The app picks a capture strategy based on your OS:

**macOS 13+ (most users)**
A native Swift binary called `ScreenforgeCapture` runs in the background. It uses Apple's **ScreenCaptureKit** framework to grab frames directly from the GPU at full Retina resolution. Each frame comes in as raw BGRA pixels (basically uncompressed). The binary feeds those frames into an **HEVC (H.265) encoder** at the highest quality setting, and writes a `.mp4` file to a temp folder.

**Older macOS / Linux / Windows (fallback)**
FFmpeg is used instead, capturing via AVFoundation (macOS), x11grab (Linux), or gdigrab (Windows) and encoding to an H.264 `.mp4`.

**Cursor & mouse events**
Separately, every mouse move/click/scroll is recorded as a timestamped list of events (not burned into the video). These are used later for the cursor overlay and zoom effects in the editor.

**Audio**
The browser's `MediaRecorder` API records microphone audio as a `.webm` file. After recording stops, FFmpeg merges it with the video file.

### What you end up with

A `.mp4` file on disk (temp folder) at full screen resolution. This is your **raw source** — no edits, no effects, just the screen capture.

---

## Stage 2: Preview (the Editor)

The editor loads the `.mp4` file into a hidden `<video>` element. A **canvas** element sits on top and is redrawn 60 times per second via `requestAnimationFrame`. Each frame:

1. The current video frame is drawn onto the canvas
2. Zoom transforms are applied (`ctx.scale()`) if a zoom clip is active
3. The cursor overlay is drawn on top
4. Background/frame effects are composited

The canvas is sized to the video's native resolution and CSS scales it to fit the panel. This is a **live preview only** — the `.mp4` file on disk is unchanged.

---

## Stage 3: Export

Export is a full re-render of every frame. Here's the pipeline step by step:

```
Source .mp4
    ↓ decode (mediabunny library)
Raw frames (one at a time)
    ↓ draw onto canvas (zoom + cursor + frame effects applied)
Composited frame
    ↓ encode (WebCodecs VideoEncoder → H.264 or VP9)
Encoded chunks
    ↓ mux (mediabunny library → writes .mp4 / .webm / .mov)
Temp video file
    ↓ FFmpeg merges audio + video
Final output file
```

### Key components

**mediabunny** — a JS library used for two things: decoding the source `.mp4` into frames (`CanvasSink`), and muxing the encoded chunks back into a container file.

**WebCodecs VideoEncoder** — a browser API (available in Electron) that encodes canvas frames into H.264 or VP9 compressed chunks. This is what determines export video quality.

**FFmpeg** — a native binary bundled with the app, used only at the end to merge the encoded video with the audio WAV file.

### Where quality settings live

When you pick "High Quality / 1080p", these values are used:
- **Resolution**: output canvas is sized to 1920×1080
- **Bitrate**: 80 Mbps (for 1080p high quality)
- **Codec**: H.264 for mp4/mov, VP9 for webm
- **Encoder config**: passed to WebCodecs VideoEncoder

The export runs in a hidden Electron `BrowserWindow` so the UI stays responsive.

---

## How the Two Stages Connect

```
Recording                   Export
─────────                   ──────
ScreenCaptureKit  →  .mp4   read by mediabunny
   (HEVC, full res)             ↓
cursor events  ─────────→  drawn onto frames
mouse clicks   ─────────→  cursor overlay
zoom clips     ─────────→  canvas transforms
```

The `.mp4` from recording is never modified after recording stops (except for the audio merge). All effects (zoom, cursor, frame) are composited fresh during export. The raw file is essentially a "source of truth" that gets re-rendered.

---

## Common Terms

| Term | What it means |
|------|---------------|
| **HEVC / H.265** | A video compression format. Better quality than H.264 at the same file size. Used during recording on modern macOS. |
| **H.264 / AVC** | An older but widely supported compression format. Used for exports by default. |
| **WebCodecs** | A browser API for encoding/decoding video frames in JavaScript. Screenforge uses it for the export re-encoding step. |
| **Muxing** | Combining a video stream and an audio stream into a single container file (e.g., `.mp4`). Like putting picture and sound together into one file. |
| **Bitrate** | How many bits per second are used to represent the video. Higher = larger file but better quality. |
| **latencyMode** | Tells the encoder whether to prioritize speed (`realtime`) or quality (`quality`). |
| **CRF / bitrateMode** | How the encoder allocates bits across frames — constant (same bits every frame) or variable (more bits for complex frames, fewer for static ones). |
| **ScreenCaptureKit** | Apple's modern screen capture framework (macOS 13+). Faster and higher quality than older methods. |
| **mediabunny** | A JS library that wraps WebCodecs for easier video muxing/demuxing. Screenforge uses it to both decode source frames and write the encoded output. |

---

## Quality Degradation Points (What We're About to Fix)

Based on the code review, there are 3 places where quality is currently being lost:

1. **Export encoder uses `latencyMode: 'realtime'`** — tells the encoder to rush, sacrificing quality. Should be `'quality'` for an offline export.

2. **Export encoder uses constant bitrate (CBR)** — wastes bits on static frames. Screen recordings should use variable bitrate (VBR) so complex/moving scenes get more bits.

3. **Canvas zoom doesn't set `imageSmoothingQuality: 'high'`** — when the zoom effect magnifies content, the default interpolation (`'low'`) makes it look blurry. Applies to both preview and export.

4. **Old macOS fallback captures at 80% quality** — can be raised to 100%.
