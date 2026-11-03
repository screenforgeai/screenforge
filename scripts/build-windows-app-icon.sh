#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="${1:-$ROOT_DIR/src/assets/app-icon.png}"
OUTPUT_ICON="${2:-$ROOT_DIR/build/icons/screenforge.ico}"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_ICON")"

magick "$SOURCE_ICON" \
  \( -clone 0 -resize 256x256 \) \
  \( -clone 0 -resize 128x128 \) \
  \( -clone 0 -resize 64x64 \) \
  \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 16x16 \) \
  -delete 0 \
  "$OUTPUT_ICON"

echo "$OUTPUT_ICON"
