#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

if [[ "${1:-}" == "--" ]]; then
  shift
fi

SOURCE_DIR="${1:-${SCREENFORGE_FFMPEG_SOURCE_DIR:-}}"
ARCH="$(uname -m)"
TARGET_ID="darwin-$ARCH"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/screenforge-ffmpeg-build.XXXXXX")"
INSTALL_DIR="$BUILD_DIR/install"
OUTPUT_DIR="$ROOT/native/bin/ffmpeg/$TARGET_ID"
DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-11.0}"
CPU_COUNT="$(sysctl -n hw.ncpu 2>/dev/null || printf '8')"
CONFIGURE_ARGS_FILE="$BUILD_DIR/configure-args.txt"

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

if [[ -z "$SOURCE_DIR" ]]; then
  echo "Usage: pnpm build:ffmpeg:macos -- /absolute/path/to/ffmpeg"
  echo "Or set SCREENFORGE_FFMPEG_SOURCE_DIR."
  exit 1
fi

if [[ -f "$SOURCE_DIR" ]]; then
  if [[ "$(basename "$SOURCE_DIR")" == "ffmpeg" ]]; then
    echo "You passed the installed FFmpeg binary: $SOURCE_DIR"
    echo "This script needs the FFmpeg source directory instead."
    echo "Expected something like: /absolute/path/to/ffmpeg-source"
    echo "That directory must contain a 'configure' file."
  else
    echo "Expected an FFmpeg source directory, but got a file: $SOURCE_DIR"
  fi
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Expected an FFmpeg source directory, but got: $SOURCE_DIR"
  exit 1
fi

SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"

if [[ ! -f "$SOURCE_DIR/configure" ]]; then
  echo "FFmpeg source directory is invalid: $SOURCE_DIR"
  echo "Expected a source checkout directory containing: $SOURCE_DIR/configure"
  exit 1
fi

if ! command -v pkg-config >/dev/null 2>&1; then
  echo "pkg-config is required. Install it first, for example: brew install pkg-config"
  exit 1
fi

export PKG_CONFIG_PATH="${PKG_CONFIG_PATH:-}"
for prefix in /opt/homebrew /usr/local; do
  if [[ -d "$prefix/lib/pkgconfig" ]]; then
    if [[ -n "$PKG_CONFIG_PATH" ]]; then
      export PKG_CONFIG_PATH="$prefix/lib/pkgconfig:$PKG_CONFIG_PATH"
    else
      export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
    fi
  fi
done

if ! pkg-config --exists opus; then
  echo "libopus is required for WebM audio export. Install it first, for example: brew install opus"
  exit 1
fi

OPUS_STATIC_LIB="$(pkg-config --variable=libdir opus)/libopus.a"
if [[ ! -f "$OPUS_STATIC_LIB" ]]; then
  echo "Static libopus not found at: $OPUS_STATIC_LIB"
  echo "Ensure opus was installed with static libraries: brew install opus"
  exit 1
fi

# Force static linking of libopus by creating an isolated directory that contains
# only libopus.a (no .dylib). When pkg-config points here, the linker has no shared
# library to prefer and falls back to the static archive.
OPUS_STATIC_DIR="$BUILD_DIR/opus-static-only"
mkdir -p "$OPUS_STATIC_DIR"
cp "$OPUS_STATIC_LIB" "$OPUS_STATIC_DIR/"

cat > "$OPUS_STATIC_DIR/opus.pc" << EOF
Name: opus
Description: Opus Audio Codec
Version: $(pkg-config --modversion opus)
Libs: -L$OPUS_STATIC_DIR -lopus
Cflags: $(pkg-config --cflags-only-I opus)
EOF

export PKG_CONFIG_PATH="$OPUS_STATIC_DIR${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"

mkdir -p "$INSTALL_DIR" "$OUTPUT_DIR"

echo "==> Building FFmpeg for $TARGET_ID"
echo "==> Source: $SOURCE_DIR"
echo "==> Temp build dir: $BUILD_DIR"

CONFIGURE_ARGS=(
  "--prefix=$INSTALL_DIR"
  "--disable-debug"
  "--disable-doc"
  "--disable-ffplay"
  "--disable-xlib"
  "--disable-libxcb"
  "--enable-ffmpeg"
  "--enable-ffprobe"
  "--enable-avfoundation"
  "--enable-audiotoolbox"
  "--enable-videotoolbox"
  "--enable-libopus"
  "--extra-cflags=-mmacosx-version-min=$DEPLOYMENT_TARGET"
  "--extra-ldflags=-mmacosx-version-min=$DEPLOYMENT_TARGET"
)
printf '%s\n' "${CONFIGURE_ARGS[@]}" > "$CONFIGURE_ARGS_FILE"

pushd "$BUILD_DIR" >/dev/null

"$SOURCE_DIR/configure" "${CONFIGURE_ARGS[@]}"

make -j"${CPU_COUNT:-8}"
make install

popd >/dev/null

cp "$INSTALL_DIR/bin/ffmpeg" "$OUTPUT_DIR/ffmpeg"
if [[ -f "$INSTALL_DIR/bin/ffprobe" ]]; then
  cp "$INSTALL_DIR/bin/ffprobe" "$OUTPUT_DIR/ffprobe"
fi

chmod +x "$OUTPUT_DIR/ffmpeg"
if [[ -f "$OUTPUT_DIR/ffprobe" ]]; then
  chmod +x "$OUTPUT_DIR/ffprobe"
fi

node "$ROOT/scripts/write-ffmpeg-build-manifest.mjs" \
  --source-dir "$SOURCE_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --ffmpeg-path "$OUTPUT_DIR/ffmpeg" \
  --ffprobe-path "$OUTPUT_DIR/ffprobe" \
  --target-id "$TARGET_ID" \
  --deployment-target "$DEPLOYMENT_TARGET" \
  --configure-args-file "$CONFIGURE_ARGS_FILE"

echo "==> Done. Binaries staged at native/bin/ffmpeg/$TARGET_ID"
