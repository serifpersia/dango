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
APK_NAME="com.serifpersia.dango-v${APP_VERSION}-universal-debug.apk"
APK_PATH="app/build/outputs/apk/debug/${APK_NAME}"

if [ ! -f "$APK_PATH" ]; then
    echo ""
    echo "[!] Expected APK not found: $APK_PATH"
    ls "app/build/outputs/apk/debug/"
    exit 1
fi

echo ""
echo "[2/2] Done!"
echo "APK: $APK_PATH"
echo "Version: $APP_VERSION"
echo ""
echo "Install: adb install -r $APK_PATH"
