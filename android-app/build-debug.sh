#!/usr/bin/env bash
# Dango Android - Build Debug APK
set -e

cd "$(dirname "$0")"

echo "=== Dango: Building Debug APK ==="

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
echo "[1/2] Building debug APK..."
./gradlew app:clean app:assembleDebug --no-daemon

APP_VERSION=$(node "$(dirname "$0")/app-version.js")
APK_ARM64="app/build/outputs/apk/arm64/debug/com.serifpersia.dango-v${APP_VERSION}-arm64-v8a-debug.apk"
APK_ARMV7="app/build/outputs/apk/armv7/debug/com.serifpersia.dango-v${APP_VERSION}-armeabi-v7a-debug.apk"

if [ ! -f "$APK_ARM64" ] || [ ! -f "$APK_ARMV7" ]; then
    echo ""
    echo "[!] Expected APKs not found"
    ls "app/build/outputs/apk/arm64/debug/" "app/build/outputs/apk/armv7/debug/"
    exit 1
fi

echo ""
echo "[2/2] Done!"
echo "APK (arm64-v8a): $APK_ARM64"
echo "APK (armeabi-v7a): $APK_ARMV7"
echo "Version: $APP_VERSION"
echo ""
echo "Install: adb install -r $APK_ARM64"
