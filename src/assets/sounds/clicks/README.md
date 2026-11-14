# Click sound recordings

Press and release recordings for the recorded click sounds in
`src/lib/effects/cursor/audio.ts`. Each file is trimmed to start on the click,
mono 48 kHz 16-bit WAV, peaked at -3 dBFS; the per-sound level is matched in code.

| File | Click sound | Source | License |
| --- | --- | --- | --- |
| `mouse-press.wav`, `mouse-release.wav` | Mouse | `mouseclick1.wav` and `mouserelease1.wav` from [Kenney UI Audio](https://kenney.nl/assets/ui-audio) by Kenney Vleugels | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `mouse-2-press.wav`, `mouse-2-release.wav` | Mouse 2 | Generated with the ElevenLabs sound effects API (`scripts/generate-click-sounds.mjs`, takes `mouse-press-1` and `mouse-release-2`) | Generated audio under the ElevenLabs terms for paid plans |
