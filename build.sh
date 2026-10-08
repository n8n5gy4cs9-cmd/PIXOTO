#!/bin/sh
# Build Pixoto for deployment: copies the static app/ folder (unchanged) into DIST/.
# There is no bundler, transpiler or npm — the app is already deploy-ready, so "build"
# means a clean copy. Upload DIST/ to any web host.
set -e
cd "$(dirname "$0")"

DIST="DIST"
APP="app"

rm -rf "$DIST"
mkdir -p "$DIST"

cp -R "$APP/." "$DIST/"

printf 'Built %s/ from %s/ (%s files).\n' "$DIST" "$APP" "$(find "$DIST" -type f | wc -l | tr -d ' ')"
