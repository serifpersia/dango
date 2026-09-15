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
APK_NAME="com.serifpersia.dango-v${APP_VERSION}-universal.apk"
APK_PATH="app/build/outputs/apk/release/${APK_NAME}"

if [ ! -f "$APK_PATH" ]; then
    echo ""
    echo "[!] Expected APK not found: $APK_PATH"
    ls "app/build/outputs/apk/release/"
    exit 1
fi

echo ""
echo "[2/2] Done!"
echo "APK: $APK_PATH"
echo "Version: $APP_VERSION"
echo ""
echo "Install: adb install -r $APK_PATH"
