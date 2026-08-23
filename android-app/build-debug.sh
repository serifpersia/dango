#!/usr/bin/env bash
# Dango Android - Build Debug APK
set -e

cd "$(dirname "$0")"

echo "=== Dango: Building Debug APK ==="

if [ ! -f "payload/bin/node" ] || [ ! -f "payload/npm/bin/npm-cli.js" ]; then
    echo ""
    echo "[!] Incomplete payload. Run: python3 fetch-termux-node.py"
    exit 1
fi

echo ""
echo "[1/2] Building debug APK..."
./gradlew app:clean app:assembleDebug --no-daemon

echo ""
echo "[2/2] Done!"
echo "APK: app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "Install: adb install -r app/build/outputs/apk/debug/app-debug.apk"
