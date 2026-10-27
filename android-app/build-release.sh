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

APP_VERSION=$(node "$(dirname "$0")/app-version.js")
APK_ARM64="app/build/outputs/apk/arm64/release/com.serifpersia.dango-v${APP_VERSION}-arm64-v8a.apk"
APK_ARMV7="app/build/outputs/apk/armv7/release/com.serifpersia.dango-v${APP_VERSION}-armeabi-v7a.apk"

if [ ! -f "$APK_ARM64" ] || [ ! -f "$APK_ARMV7" ]; then
    echo ""
    echo "[!] Expected APKs not found"
    ls "app/build/outputs/apk/arm64/release/" "app/build/outputs/apk/armv7/release/"
    exit 1
fi

echo ""
echo "[2/2] Done!"
echo "APK (arm64-v8a): $APK_ARM64"
echo "APK (armeabi-v7a): $APK_ARMV7"
echo "Version: $APP_VERSION"
echo ""
echo "Install: adb install -r $APK_ARM64"
