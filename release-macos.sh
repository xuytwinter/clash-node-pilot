#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:-0.1.0}"
NODE_VERSION="${NODE_VERSION:-22.23.1}"
ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_VERSION="$(node -p "require('$ROOT/package.json').version")"
if [[ "$PACKAGE_VERSION" != "$VERSION" ]]; then
  echo "package.json version $PACKAGE_VERSION does not match release version $VERSION" >&2
  exit 1
fi

CACHE_DIR="$ROOT/work/node-runtime-cache"
BUILD_DIR="$ROOT/work/release-macos"
OUT_DIR="$ROOT/outputs"
mkdir -p "$CACHE_DIR" "$BUILD_DIR" "$OUT_DIR"
rm -f "$OUT_DIR"/clash-node-pilot-v"$VERSION"-darwin-*.zip "$OUT_DIR"/clash-node-pilot-v"$VERSION"-darwin-*.zip.sha256

CHECKSUMS="$CACHE_DIR/SHASUMS256.txt"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$CHECKSUMS"

ITEMS=(
  package.json README.md LICENSE CHANGELOG.md SECURITY.md RELEASE_NOTES.md
  server.js regions.json src public docs start-clash-node-pilot.command
)

for ARCH in arm64 x64; do
  NODE_BASE="node-v$NODE_VERSION-darwin-$ARCH"
  NODE_ARCHIVE="$NODE_BASE.tar.gz"
  NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE"
  DOWNLOAD="$CACHE_DIR/$NODE_ARCHIVE"
  [[ -f "$DOWNLOAD" ]] || curl -fsSL "$NODE_URL" -o "$DOWNLOAD"
  EXPECTED="$(awk -v name="$NODE_ARCHIVE" '$2 == name {print $1}' "$CHECKSUMS")"
  ACTUAL="$(shasum -a 256 "$DOWNLOAD" | awk '{print $1}')"
  [[ "$ACTUAL" == "$EXPECTED" ]] || { echo "Node runtime checksum mismatch for $NODE_ARCHIVE" >&2; exit 1; }

  STAGE_NAME="clash-node-pilot-v$VERSION-darwin-$ARCH"
  STAGE_DIR="$BUILD_DIR/$STAGE_NAME"
  rm -rf "$STAGE_DIR" "$BUILD_DIR/$NODE_BASE"
  mkdir -p "$STAGE_DIR/runtime"
  tar -xzf "$DOWNLOAD" -C "$BUILD_DIR"
  cp "$BUILD_DIR/$NODE_BASE/bin/node" "$STAGE_DIR/runtime/node"
  chmod 755 "$STAGE_DIR/runtime/node"
  for LICENSE_FILE in LICENSE README.md CHANGELOG.md; do
    [[ -f "$BUILD_DIR/$NODE_BASE/$LICENSE_FILE" ]] && cp "$BUILD_DIR/$NODE_BASE/$LICENSE_FILE" "$STAGE_DIR/runtime/NODE-$LICENSE_FILE"
  done
  cat > "$STAGE_DIR/runtime/NODE-RUNTIME.txt" <<EOF
Clash Node Pilot $VERSION macOS Preview runtime
Node.js: v$NODE_VERSION
Architecture: darwin-$ARCH
Source: $NODE_URL
Node archive SHA256: $ACTUAL
Unsigned preview: yes
EOF
  for ITEM in "${ITEMS[@]}"; do
    [[ -e "$ROOT/$ITEM" ]] || { echo "Required release file missing: $ITEM" >&2; exit 1; }
    cp -R "$ROOT/$ITEM" "$STAGE_DIR/"
  done
  chmod 755 "$STAGE_DIR/start-clash-node-pilot.command"
  (cd "$BUILD_DIR" && zip -qr "$OUT_DIR/$STAGE_NAME-portable.zip" "$STAGE_NAME")
  shasum -a 256 "$OUT_DIR/$STAGE_NAME-portable.zip" | sed "s# .*/#  #" > "$OUT_DIR/$STAGE_NAME-portable.zip.sha256"
  echo "Created $OUT_DIR/$STAGE_NAME-portable.zip"
  echo "Created $OUT_DIR/$STAGE_NAME-portable.zip.sha256"
done
