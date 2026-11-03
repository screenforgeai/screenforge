#!/usr/bin/env bash
set -euo pipefail

# Stages the Linux app icon (PNG). deb/rpm/AppImage makers and the .desktop
# entry consume a plain PNG, unlike macOS (.icns) and Windows (.ico).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
SOURCE_ICON="$ROOT_DIR/src/assets/app-icon.png"
DEST_DIR="$ROOT_DIR/build/icons"
DEST_ICON="$DEST_DIR/screenforge.png"

if [ ! -f "$SOURCE_ICON" ]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
cp "$SOURCE_ICON" "$DEST_ICON"

echo "Linux app icon staged:"
ls -lh "$DEST_ICON"
