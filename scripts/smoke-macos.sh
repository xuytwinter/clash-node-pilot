#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
cd "$ROOT"
[[ "$(uname -s)" == Darwin ]] || { echo 'macOS smoke requires Darwin' >&2; exit 1; }
VERSION="$(node -p "require('./package.json').version")"
case "$(uname -m)" in arm64) HOST_ARCH=arm64;; x86_64) HOST_ARCH=x64;; *) exit 1;; esac
ARCH="${ARCH:-${1:-$HOST_ARCH}}"
[[ "$ARCH" == "$HOST_ARCH" ]] || { echo 'Architecture mismatch' >&2; exit 1; }
DMG="$ROOT/outputs/clash-node-pilot-v$VERSION-macos-$ARCH.dmg"
(cd "$ROOT/outputs" && shasum -a 256 -c "$(basename "$DMG").sha256")
SMOKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/clash pilot smoke.XXXXXX")"
MOUNT_POINT="$SMOKE_ROOT/mounted"
MOUNTED=0
cleanup() {
  if [[ "$MOUNTED" == 1 ]]; then hdiutil detach "$MOUNT_POINT" -quiet || return 1; fi
  rm -rf -- "$SMOKE_ROOT"
}
trap cleanup EXIT
mkdir -p "$MOUNT_POINT" "$SMOKE_ROOT/installed"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT_POINT" "$DMG" -quiet
MOUNTED=1
[[ "$(readlink "$MOUNT_POINT/Applications")" == /Applications ]]
codesign --verify --deep --strict "$MOUNT_POINT/Clash Node Pilot.app"
ditto "$MOUNT_POINT/Clash Node Pilot.app" "$SMOKE_ROOT/installed/Clash Node Pilot.app"
hdiutil detach "$MOUNT_POINT" -quiet
MOUNTED=0
node scripts/smoke-macos.js "$SMOKE_ROOT/installed/Clash Node Pilot.app" "$SMOKE_ROOT" "$ARCH"
