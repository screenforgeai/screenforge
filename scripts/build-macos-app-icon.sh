#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="${1:-$ROOT_DIR/src/assets/app-icon.png}"
OUTPUT_ICON="${2:-$ROOT_DIR/build/icons/screenforge.icns}"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_ICON")"
sips -s format icns "$SOURCE_ICON" --out "$OUTPUT_ICON" >/dev/null
echo "$OUTPUT_ICON"
