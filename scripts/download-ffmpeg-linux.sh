#!/usr/bin/env bash
set -euo pipefail

# Downloads a static FFmpeg build for Linux (x64 or arm64).
# Requires: curl, tar

# Pinned to a dated BtbN build and verified by checksum: their rolling
# "latest" release drops old FFmpeg branches (7.1 vanished, breaking releases)
# and would otherwise ship whatever was uploaded that day. To update, pick a
# newer autobuild-* release and copy its hashes from checksums.sha256.
FFMPEG_VERSION="7.1"
BTBN_RELEASE="autobuild-2026-07-31-14-10"
BTBN_BUILD="n7.1.5-12-g1fdbca85aa"

ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  x86_64|x64|amd64)
    BTBN_ARCH="linux64"
    TARGET_FOLDER="linux-x64"
    EXPECTED_SHA256="58057a52db17bd2fefa87f271956f04aa2277d55efc13f288594cc2c65c59479"
    ;;
  aarch64|arm64)
    BTBN_ARCH="linuxarm64"
    TARGET_FOLDER="linux-arm64"
    EXPECTED_SHA256="cfb4498c475e7d492cceb4706b495428d4b2061b5c797ad63d4a0cc20367e97a"
    ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

DOWNLOAD_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/${BTBN_RELEASE}/ffmpeg-${BTBN_BUILD}-${BTBN_ARCH}-lgpl-${FFMPEG_VERSION}.tar.xz"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../native/bin/ffmpeg/$TARGET_FOLDER"

echo "Downloading Linux FFmpeg ${FFMPEG_VERSION} (${BTBN_ARCH}) to $DEST_DIR..."
mkdir -p "$DEST_DIR"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

curl -L --fail --progress-bar "$DOWNLOAD_URL" -o "$TMP_DIR/ffmpeg.tar.xz"
echo "${EXPECTED_SHA256}  $TMP_DIR/ffmpeg.tar.xz" | sha256sum --check --strict
tar -xJf "$TMP_DIR/ffmpeg.tar.xz" -C "$TMP_DIR"

INNER_DIR=$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)
cp "$INNER_DIR/bin/ffmpeg" "$DEST_DIR/ffmpeg"
cp "$INNER_DIR/bin/ffprobe" "$DEST_DIR/ffprobe"
chmod +x "$DEST_DIR/ffmpeg" "$DEST_DIR/ffprobe"

echo "Done. Linux FFmpeg installed:"
ls -lh "$DEST_DIR/"
