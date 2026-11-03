#!/usr/bin/env bash
set -euo pipefail

# Downloads a static FFmpeg build for Windows x64.
# Requires: curl, unzip

FFMPEG_VERSION="7.1"
DOWNLOAD_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n${FFMPEG_VERSION}-latest-win64-lgpl-${FFMPEG_VERSION}.zip"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../native/bin/ffmpeg/win32-x64"

echo "Downloading Windows FFmpeg ${FFMPEG_VERSION} to $DEST_DIR..."
mkdir -p "$DEST_DIR"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

curl -L --fail --progress-bar "$DOWNLOAD_URL" -o "$TMP_DIR/ffmpeg.zip"
unzip -q "$TMP_DIR/ffmpeg.zip" -d "$TMP_DIR"

INNER_DIR=$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)
cp "$INNER_DIR/bin/ffmpeg.exe" "$DEST_DIR/ffmpeg.exe"
cp "$INNER_DIR/bin/ffprobe.exe" "$DEST_DIR/ffprobe.exe"

echo "Done. Windows FFmpeg installed:"
ls -lh "$DEST_DIR/"
