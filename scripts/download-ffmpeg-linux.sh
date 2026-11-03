#!/usr/bin/env bash
set -euo pipefail

# Downloads a static FFmpeg build for Linux (x64 or arm64).
# Requires: curl, tar

FFMPEG_VERSION="7.1"

ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  x86_64|x64|amd64)
    BTBN_ARCH="linux64"
    TARGET_FOLDER="linux-x64"
    ;;
  aarch64|arm64)
    BTBN_ARCH="linuxarm64"
    TARGET_FOLDER="linux-arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

DOWNLOAD_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n${FFMPEG_VERSION}-latest-${BTBN_ARCH}-lgpl-${FFMPEG_VERSION}.tar.xz"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../native/bin/ffmpeg/$TARGET_FOLDER"

echo "Downloading Linux FFmpeg ${FFMPEG_VERSION} (${BTBN_ARCH}) to $DEST_DIR..."
mkdir -p "$DEST_DIR"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

curl -L --fail --progress-bar "$DOWNLOAD_URL" -o "$TMP_DIR/ffmpeg.tar.xz"
tar -xJf "$TMP_DIR/ffmpeg.tar.xz" -C "$TMP_DIR"

INNER_DIR=$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)
cp "$INNER_DIR/bin/ffmpeg" "$DEST_DIR/ffmpeg"
cp "$INNER_DIR/bin/ffprobe" "$DEST_DIR/ffprobe"
chmod +x "$DEST_DIR/ffmpeg" "$DEST_DIR/ffprobe"

echo "Done. Linux FFmpeg installed:"
ls -lh "$DEST_DIR/"
