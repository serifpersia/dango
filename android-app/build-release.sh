#!/usr/bin/env bash
# Dango Android - Build Release APK
set -e

cd "$(dirname "$0")"

echo "=== Dango: Building Release APK ==="

if [ ! -f "payload/bin/node" ] || [ ! -f "payload/npm/bin/npm-cli.js" ]; then
    echo ""
    echo "[!] Incomplete payload. Run: python3 fetch-termux-node.py"
    exit 1
fi

echo ""
echo "[1/2] Building release APK..."
./gradlew app:clean app:assembleRelease --no-daemon

echo ""
echo "[2/2] Done!"
echo "APK: app/build/outputs/apk/release/app-release.apk"
echo ""
echo "Install: adb install -r app/build/outputs/apk/release/app-release.apk"
