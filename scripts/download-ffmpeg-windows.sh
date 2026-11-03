#!/usr/bin/env bash
set -euo pipefail

# Downloads a static FFmpeg build for Windows x64.
# Requires: curl, unzip

# Pinned to a dated BtbN build and verified by checksum — see
# download-ffmpeg-linux.sh for why, and how to update.
FFMPEG_VERSION="7.1"
BTBN_RELEASE="autobuild-2026-07-31-14-10"
BTBN_BUILD="n7.1.5-12-g1fdbca85aa"
EXPECTED_SHA256="b7c1c846dacca68ee4ebf5c390742c973b3d5d14a6d44b061f500d8e4ac74fc0"
DOWNLOAD_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/${BTBN_RELEASE}/ffmpeg-${BTBN_BUILD}-win64-lgpl-${FFMPEG_VERSION}.zip"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../native/bin/ffmpeg/win32-x64"

echo "Downloading Windows FFmpeg ${FFMPEG_VERSION} to $DEST_DIR..."
mkdir -p "$DEST_DIR"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

curl -L --fail --progress-bar "$DOWNLOAD_URL" -o "$TMP_DIR/ffmpeg.zip"
echo "${EXPECTED_SHA256}  $TMP_DIR/ffmpeg.zip" | sha256sum --check --strict
unzip -q "$TMP_DIR/ffmpeg.zip" -d "$TMP_DIR"

INNER_DIR=$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)
cp "$INNER_DIR/bin/ffmpeg.exe" "$DEST_DIR/ffmpeg.exe"
cp "$INNER_DIR/bin/ffprobe.exe" "$DEST_DIR/ffprobe.exe"

echo "Done. Windows FFmpeg installed:"
ls -lh "$DEST_DIR/"
