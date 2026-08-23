#!/usr/bin/env bash
# Dango Android - Build Release APK
set -e

cd "$(dirname "$0")"

echo "=== Dango: Building Release APK ==="

if [ ! -f "payload/arm64-v8a/bin/node" ] && [ ! -f "payload/bin/node" ]; then
    echo ""
    echo "[!] Incomplete payload: node binary missing. Run: python3 fetch-termux-node.py"
    exit 1
fi

if [ ! -f "payload/common/npm/bin/npm-cli.js" ] && [ ! -f "payload/npm/bin/npm-cli.js" ]; then
    echo ""
    echo "[!] Incomplete payload: npm missing. Run: python3 fetch-termux-node.py"
    exit 1
fi

echo ""
echo "[1/2] Building release APK..."
./gradlew app:clean app:assembleRelease --no-daemon

echo ""
echo "[2/2] Done!"
echo "APK: app/build/outputs/apk/release/com.serifpersia.dango-universal.apk"
echo ""
echo "Install: adb install -r app/build/outputs/apk/release/com.serifpersia.dango-universal.apk"
