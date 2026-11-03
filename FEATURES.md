# Planned Features

## Audio / Music

- **Auto-Duck**: Automatically lower background music volume when the recording's voice/audio is present, then bring it back up during silence. Two viable implementation paths:
  - *FFmpeg sidechain* (~1 day): pass both the rendered WAV and music file to FFmpeg with a `sidechaincompress` filter_complex (`threshold=-25dB, ratio=4, attack=200ms, release=1000ms`). Simple, export-only — live preview won't reflect it.
  - *Web Audio sidechain* (~2–3 days): analyze recording amplitude frame-by-frame in `renderTimelineAudio` (`OfflineAudioContext`), build a gain envelope, apply it to the music `GainNode` via `setValueAtTime` automations with configurable attack/release. Works in both preview and export, but requires careful tuning to avoid pumping artifacts.
  - Recommended starting point: FFmpeg sidechain for v1, Web Audio for parity later.

## Camera

- **Background Blur**: Blur only the background behind the person in the camera feed (not the entire frame). Requires per-frame ML person segmentation (e.g. `@mediapipe/tasks-vision` selfie segmenter) + canvas compositing — draw blurred frame, cut out sharp person via segmentation mask, composite on top.
