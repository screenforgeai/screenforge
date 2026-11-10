# Export Benchmarks

How long an export takes, measured the same way on every platform and every release, so we can see when a release gets slower and publish honest numbers.

---

## What is measured

`pnpm bench:export -- --release` exports one fixed sample project twice:

| Preset    | Sample recording                            | Export settings                            |
| --------- | ------------------------------------------- | ------------------------------------------ |
| **1080p** | 1920×1080, 60 fps, 20 s, with a 440 Hz tone | MP4, 1080p, 60 fps, High quality, audio on |
| **4K**    | 3840×2160, 60 fps, 20 s, with a 440 Hz tone | MP4, 4K, 60 fps, High quality, audio on    |

The export settings are the export dialog's defaults (format MP4, 60 fps, High), with only the resolution changed. The project has a solid background with padding, rounded corners and a shadow, like a typical edit.

The sample is FFmpeg's `testsrc2` pattern (moving detail, text and colour bars) at the preset size. It is generated on first run into `node_modules/.cache/screenforge-bench-export/` (not the shared temp directory) and reused after that, so the repo doesn't carry a 4K video. It is encoded with `libx264` where the FFmpeg build has it, otherwise the platform's own H.264 encoder (`libopenh264`, `h264_videotoolbox`, `h264_mf`). The content is identical everywhere; only the sample's encoding can differ.

For each preset the benchmark records:

- **seconds**: time from the app loading the project to the finished file on disk (decode, render, encode, audio mux). It does not include starting the app.
- **realtimeFactor**: seconds of video exported per second of waiting. Above 1.0 is faster than real time.
- output size, resolution, fps and frame count, and the decode/render/encode time split.

The definitions live in `scripts/bench-export-lib.mjs` (tested in `scripts/bench-export-lib.test.ts`).

## Running it

The benchmark starts the real app (`pnpm start`) with the export harness, so it needs a normal dev setup: dependencies installed with their install scripts (the Electron binary), FFmpeg (`pnpm download:ffmpeg:*` or `SCREENFORGE_FFMPEG_PATH`), and a display. Close other heavy apps and keep the machine plugged in.

```bash
# macOS
pnpm bench:export -- --release --json bench-results/export-macos-arm64.json

# Linux (X11 or Wayland session; on a headless box use a virtual display)
xvfb-run -a pnpm bench:export -- --release --json bench-results/export-linux-x64.json

# Windows (PowerShell)
pnpm bench:export -- --release --json bench-results/export-windows-x64.json
```

The Windows launcher (no `script(1)`, so `pnpm start` runs through the shell with an open stdin) has not been run yet. If it fails, please note it in the release checklist.

Without `--release`, `pnpm bench:export` runs the small fixture manifests in `test/fixtures/export/manifests/` as before.

### The JSON file

The shape, with placeholder numbers:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-06T18:00:00.000Z",
  "environment": {
    "appVersion": "0.7.0",
    "gitCommit": "abc1234",
    "platform": "darwin",
    "arch": "arm64",
    "osRelease": "24.1.0",
    "cpuModel": "Apple M2 Pro",
    "cpuCount": 12,
    "totalMemoryGb": 32,
    "nodeVersion": "v22.11.0",
    "ffmpegVersion": "ffmpeg version 7.1 ...",
    "sampleEncoder": "libx264"
  },
  "results": [
    {
      "manifest": "release-1080p.json",
      "id": "release-1080p",
      "seconds": 0,
      "contentSeconds": 20,
      "realtimeFactor": 0,
      "outputWidth": 1920,
      "outputHeight": 1080,
      "outputFps": 60,
      "outputSizeBytes": 0,
      "captureFrameCount": 1200,
      "capturePerf": {}
    }
  ]
}
```

With `--release` the script also prints ready-made rows for the table below.

## Results per release

Add one row per platform per release. Only numbers from a real run go here.

| Version | Platform | Machine | Preset | Export time | Realtime |
| ------- | -------- | ------- | ------ | ----------- | -------- |
|         |          |         | 1080p  |             |          |
|         |          |         | 4K     |             |          |

### Not measured yet

- **Linux x64, the container this benchmark was written in** (issue #20): the export could not run. The container has no display or GPU, and the Electron binary is not installed there. Only the sample generation was checked: FFmpeg 6.1.1 with libx264 produced both samples (1920×1080 and 3840×2160, 60 fps, exactly 20.0 s, AAC audio). That is not an export time.
- **macOS and Windows**: need a run on real hardware.
