#!/bin/sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
NODE_EXE="$APP_DIR/runtime/node"
if [ ! -x "$NODE_EXE" ]; then
  NODE_EXE="$(command -v node || true)"
fi
if [ -z "$NODE_EXE" ]; then
  echo "Node.js runtime not found. Use the packaged macOS Preview or install Node.js 18+ for source runs."
  exit 1
fi

export CLASH_PILOT_DISABLE_AUTO_LOOP="${CLASH_PILOT_DISABLE_AUTO_LOOP:-0}"
cd "$APP_DIR"
exec "$NODE_EXE" server.js
