# Third-Party Notices

Screenforge is licensed under the GNU Affero General Public License v3.0
(or later) — see [`LICENSE`](./LICENSE). It bundles or links against the
following third-party components with license terms different from the
bulk of the codebase's dependency graph (mostly MIT/Apache-2.0/BSD, see
`package.json`):

## FFmpeg

Screenforge bundles an FFmpeg (and ffprobe) binary as an external
executable, invoked as a subprocess for capture, muxing, and export.

- **License:** GNU Lesser General Public License (LGPL) v2.1+; the BtbN
  builds are configured with `--enable-version3`, so those binaries are
  LGPL v3
- **Build configuration:** built/downloaded without any GPL-only
  components (no `libx264`, no `--enable-gpl`); macOS builds enable only
  `libopus` (LGPL/BSD), and Windows and Linux use the official
  [BtbN FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) `-lgpl` release.
- **Source:** https://ffmpeg.org — see `scripts/build-ffmpeg-macos.sh`,
  `scripts/download-ffmpeg-windows.sh` and `scripts/download-ffmpeg-linux.sh`
  for exact build/download provenance, and
  `native/bin/ffmpeg/darwin-arm64/build-manifest.json` for the macOS
  configure flags (`ffmpeg -version` prints them for any build).
- **License text:** https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
  and https://www.gnu.org/licenses/lgpl-3.0.html

## libuiohook (via `uiohook-napi`)

Mouse and keyboard event capture uses the
[`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) npm package
(MIT), which compiles and links the native
[`libuiohook`](https://github.com/kwhat/libuiohook) library directly into
the app as a native Node addon.

- **License:** dual-licensed GNU General Public License v3.0 / GNU Lesser
  General Public License v3.0
- **License text:** see `node_modules/uiohook-napi/libuiohook/COPYING.md`
  (GPL-3.0) and `node_modules/uiohook-napi/libuiohook/COPYING.LESSER.md`
  (LGPL-3.0), or https://www.gnu.org/licenses/
- **Compatibility:** GPL-3.0 and AGPL-3.0 are cross-compatible under
  GPLv3 §13, so combining this component with Screenforge's AGPL-3.0
  codebase does not introduce a licensing conflict.

## Local ML models (Whisper via `@huggingface/transformers`)

Caption transcription downloads and runs
[Whisper](https://github.com/openai/whisper) model weights
(`Xenova/whisper-{tiny,base,small,medium}`) locally via ONNX Runtime.
Model weights are fetched at runtime on first use and cached under the
app's user data directory — they are not bundled in this repository.

- **Whisper license:** MIT
- **Runtime license:** `@huggingface/transformers` is Apache-2.0
