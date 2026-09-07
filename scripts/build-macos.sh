#!/usr/bin/env bash
set -euo pipefail

# Build the unsigned/ad-hoc signed macOS preview for the architecture of the
# runner. The caller may set ARCH to make the contract explicit in CI.
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
[[ "$(uname -s)" == Darwin ]] || { echo "macOS build must run on Darwin" >&2; exit 1; }
cd "$ROOT"
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
NODE_VERSION="${NODE_VERSION:-22.23.1}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION must be semantic x.y.z" >&2; exit 1; }
[[ "$NODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "NODE_VERSION must be x.y.z" >&2; exit 1; }
BUNDLE_IDENTIFIER="${BUNDLE_IDENTIFIER:-com.clashnodepilot.app}"
[[ "$BUNDLE_IDENTIFIER" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Invalid BUNDLE_IDENTIFIER" >&2; exit 1; }
HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
  arm64) DEFAULT_ARCH=arm64 ;;
  x86_64) DEFAULT_ARCH=x64 ;;
  *) echo "Unsupported macOS runner architecture: $HOST_ARCH" >&2; exit 1 ;;
esac
ARCH="${ARCH:-$DEFAULT_ARCH}"
case "$ARCH" in arm64|x64) ;; *) echo "ARCH must be arm64 or x64" >&2; exit 1 ;; esac
[[ "$ARCH" == "$DEFAULT_ARCH" ]] || {
  echo "ARCH=$ARCH does not match uname -m=$HOST_ARCH" >&2
  exit 1
}
SWIFT_ARCH="$ARCH"
[[ "$ARCH" == x64 ]] && SWIFT_ARCH=x86_64

for command_name in node curl shasum tar swiftc hdiutil codesign git; do
  command -v "$command_name" >/dev/null || { echo "Required command missing: $command_name" >&2; exit 1; }
done

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
[[ "$PACKAGE_VERSION" == "$VERSION" ]] || {
  echo "package.json version $PACKAGE_VERSION does not match VERSION=$VERSION" >&2
  exit 1
}

SOURCE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
SOURCE_STATUS="$(git -C "$ROOT" status --porcelain=v1 --untracked-files=normal)"
[[ -z "$SOURCE_STATUS" ]] || {
  echo "macOS release requires a clean source tree; uncommitted files found" >&2
  printf '%s\n' "$SOURCE_STATUS" >&2
  exit 1
}

OUT_DIR="$ROOT/outputs"
WORK_DIR="$ROOT/work"
mkdir -p "$OUT_DIR" "$WORK_DIR"
BUILD_DIR="$(mktemp -d "$WORK_DIR/macos-build.XXXXXX")"
cleanup() { rm -rf -- "$BUILD_DIR"; }
trap cleanup EXIT

CACHE_DIR="$BUILD_DIR/cache"
mkdir -p "$CACHE_DIR"
CHECKSUMS="$CACHE_DIR/SHASUMS256.txt"
NODE_BASE="node-v$NODE_VERSION-darwin-$ARCH"
NODE_ARCHIVE="$NODE_BASE.tar.gz"
NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE"
NODE_DOWNLOAD="$CACHE_DIR/$NODE_ARCHIVE"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$CHECKSUMS"
curl -fsSL "$NODE_URL" -o "$NODE_DOWNLOAD"
EXPECTED_NODE_SHA="$(awk -v name="$NODE_ARCHIVE" '$2 == name { print $1; exit }' "$CHECKSUMS")"
[[ "$EXPECTED_NODE_SHA" =~ ^[[:xdigit:]]{64}$ ]] || { echo "No checksum for $NODE_ARCHIVE" >&2; exit 1; }
NODE_SHA="$(shasum -a 256 "$NODE_DOWNLOAD" | awk '{print $1}')"
[[ "$NODE_SHA" == "$EXPECTED_NODE_SHA" ]] || { echo "Node runtime checksum mismatch" >&2; exit 1; }

APP_NAME="Clash Node Pilot.app"
APP_DIR="$BUILD_DIR/$APP_NAME"
APP_CONTENTS="$APP_DIR/Contents"
APP_ROOT="$APP_CONTENTS/Resources/app"
mkdir -p "$APP_CONTENTS/MacOS" "$APP_ROOT/runtime" "$APP_CONTENTS/Resources"
tar -xzf "$NODE_DOWNLOAD" -C "$BUILD_DIR"
cp "$BUILD_DIR/$NODE_BASE/bin/node" "$APP_ROOT/runtime/node"
chmod 755 "$APP_ROOT/runtime/node"
for license_file in LICENSE README.md CHANGELOG.md; do
  [[ -f "$BUILD_DIR/$NODE_BASE/$license_file" ]] && cp "$BUILD_DIR/$NODE_BASE/$license_file" "$APP_ROOT/runtime/NODE-$license_file"
done
cat > "$APP_ROOT/runtime/NODE-RUNTIME.txt" <<EOF
Clash Node Pilot macOS runtime
Node.js: v$NODE_VERSION
Architecture: darwin-$ARCH
Source: $NODE_URL
Node archive SHA256: $NODE_SHA
EOF

# Keep this list explicit. In particular, test fixtures, outputs and private
# runtime state must never become part of a release application.
git archive HEAD package.json README.md README.zh-CN.md LICENSE CHANGELOG.md SECURITY.md RELEASE_NOTES.md server.js regions.json src public docs scripts/benchmark.js scripts/demo.js | tar -xf - -C "$APP_ROOT"

LAUNCHER_SOURCE="$ROOT/packaging/macos/ClashNodePilot.swift"
PLIST_SOURCE="$ROOT/packaging/macos/Info.plist.in"
[[ -f "$LAUNCHER_SOURCE" ]] || { echo "Missing macOS launcher: $LAUNCHER_SOURCE" >&2; exit 1; }
[[ -f "$PLIST_SOURCE" ]] || { echo "Missing macOS Info.plist: $PLIST_SOURCE" >&2; exit 1; }
swiftc -O -parse-as-library -target "$SWIFT_ARCH-apple-macos13" -o "$APP_CONTENTS/MacOS/ClashNodePilot" "$LAUNCHER_SOURCE"
chmod 755 "$APP_CONTENTS/MacOS/ClashNodePilot"
sed -e "s|\$(BUNDLE_IDENTIFIER)|$BUNDLE_IDENTIFIER|g" \
    -e "s|\$(VERSION)|$VERSION|g" \
    -e 's|<key>LSMinimumSystemVersion</key><string>12\.0</string>|<key>LSMinimumSystemVersion</key><string>13.0</string>|' \
    -e "s|__VERSION__|$VERSION|g" -e "s|__ARCH__|$ARCH|g" \
    "$PLIST_SOURCE" > "$APP_CONTENTS/Info.plist"

export SOURCE_SHA NODE_VERSION NODE_ARCHIVE NODE_SHA ARCH VERSION BUNDLE_IDENTIFIER
node - "$APP_ROOT/BUILD-INFO.json" <<'NODE'
const fs = require('node:fs');
const [,, output] = process.argv;
const e = process.env;
fs.writeFileSync(output, JSON.stringify({
  version: e.VERSION,
  sourceSha: e.SOURCE_SHA,
  sourceWorkingTree: 'clean',
  sourceStatus: [],
  nodeVersion: `v${e.NODE_VERSION}`,
  nodeArchive: e.NODE_ARCHIVE,
  nodeArchiveSha256: e.NODE_SHA,
  architecture: e.ARCH,
  macOSDeploymentTarget: '13.0',
  signingMode: 'ad-hoc',
  developerId: false,
  notarized: false
}, null, 2) + '\n');
NODE

# Ad-hoc signing is intentionally truthful: this is not a Developer ID or
# notarized artifact. Sign after all files are in place and verify the result.
codesign --force --deep --sign - "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"
test -x "$APP_CONTENTS/MacOS/ClashNodePilot" && test -x "$APP_ROOT/runtime/node"
"$APP_ROOT/runtime/node" --version | grep -Fx "v$NODE_VERSION" >/dev/null

DMG_NAME="clash-node-pilot-v$VERSION-macos-$ARCH.dmg"
DMG_PATH="$OUT_DIR/$DMG_NAME"
[[ ! -e "$DMG_PATH" && ! -e "$DMG_PATH.sha256" && ! -e "$DMG_PATH.build.json" ]] || {
  echo "Refusing to overwrite existing release output: $DMG_PATH" >&2
  exit 1
}
DMG_ROOT="$BUILD_DIR/dmg"
mkdir -p "$DMG_ROOT"
cp -R "$APP_DIR" "$DMG_ROOT/"
ln -s /Applications "$DMG_ROOT/Applications"
hdiutil create -quiet -volname "Clash Node Pilot $VERSION" -srcfolder "$DMG_ROOT" -format UDZO "$DMG_PATH"
DMG_SHA="$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
printf '%s  %s\n' "$DMG_SHA" "$DMG_NAME" > "$DMG_PATH.sha256"

BUILD_JSON="$DMG_PATH.build.json"
export DMG_PATH DMG_NAME VERSION SOURCE_SHA NODE_VERSION NODE_ARCHIVE NODE_SHA ARCH
node - "$BUILD_JSON" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [,, output] = process.argv;
const env = process.env;
const digest = crypto.createHash('sha256').update(fs.readFileSync(env.DMG_PATH)).digest('hex');
const manifest = {
  version: env.VERSION,
  artifact: env.DMG_NAME,
  artifactSha256: digest,
  sourceSha: env.SOURCE_SHA,
  sourceWorkingTree: 'clean',
  sourceStatus: [],
  nodeVersion: `v${env.NODE_VERSION}`,
  nodeArchive: env.NODE_ARCHIVE,
  nodeArchiveSha256: env.NODE_SHA,
  architecture: env.ARCH,
  macOSDeploymentTarget: '13.0',
  signingMode: 'ad-hoc',
  developerId: false,
  notarized: false
};
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
NODE

echo "Created $DMG_PATH"
echo "Created $DMG_PATH.sha256"
echo "Created $BUILD_JSON"
