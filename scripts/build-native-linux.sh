#!/usr/bin/env bash
# Builds the Wayland capture helper (native/linux/WaylandCapture), which records
# a screen on Wayland with the pointer kept apart, so the app can draw its own.
# Needs a C compiler and the PipeWire and GIO headers:
#   sudo apt-get install -y gcc pkg-config libpipewire-0.3-dev libglib2.0-dev
# CFLAGS/LDLIBS in the environment replace pkg-config's flags when set.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
SRC="$ROOT/native/linux/WaylandCapture/src/main.c"

case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64) ARCH=arm64 ;;
  *) ARCH="$(uname -m)" ;;
esac
OUT_DIR="$ROOT/native/bin/linux-$ARCH"
OUT="$OUT_DIR/screenforge-wayland-capture"

if [[ -z "${CFLAGS:-}" || -z "${LDLIBS:-}" ]]; then
  if ! pkg-config --exists libpipewire-0.3 gio-unix-2.0; then
    echo "PipeWire or GIO headers are missing. Install them with:" >&2
    echo "  sudo apt-get install -y libpipewire-0.3-dev libglib2.0-dev" >&2
    exit 1
  fi
  CFLAGS="$(pkg-config --cflags libpipewire-0.3 gio-unix-2.0)"
  LDLIBS="$(pkg-config --libs libpipewire-0.3 gio-unix-2.0)"
fi

echo "==> Building screenforge-wayland-capture (linux-$ARCH)..."
mkdir -p "$OUT_DIR"
# shellcheck disable=SC2086 # the flags are word lists
${CC:-cc} -O2 -std=gnu11 -pthread -Wall -Wextra -Werror $CFLAGS "$SRC" -o "$OUT" $LDLIBS -lm
chmod +x "$OUT"
echo "==> Done. Binary at native/bin/linux-$ARCH/screenforge-wayland-capture"
