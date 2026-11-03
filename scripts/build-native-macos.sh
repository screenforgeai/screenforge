#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
SRC_DIR="$ROOT/native/macos/ScreenforgeCapture/Sources/ScreenforgeCapture"
BIN_DIR="$ROOT/native/bin"
MODULE_CACHE_DIR="${TMPDIR:-/tmp}/screenforge-clang-module-cache"

echo "==> Building ScreenforgeCapture Objective-C helper..."

mkdir -p "$BIN_DIR"
mkdir -p "$MODULE_CACHE_DIR"

clang \
  -fobjc-arc \
  -fmodules \
  -fmodules-cache-path="$MODULE_CACHE_DIR" \
  -mmacosx-version-min=13.0 \
  -O2 \
  -framework Foundation \
  -framework AppKit \
  -framework ScreenCaptureKit \
  -framework AVFoundation \
  -framework CoreMedia \
  -framework CoreGraphics \
  "$SRC_DIR/CaptureEngine.m" \
  "$SRC_DIR/EventMonitor.m" \
  "$SRC_DIR/main.m" \
  -o "$BIN_DIR/ScreenforgeCapture"

chmod +x "$BIN_DIR/ScreenforgeCapture"

echo "==> Done. Binary at native/bin/ScreenforgeCapture"
