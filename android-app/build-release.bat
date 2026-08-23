@echo off
REM Dango Android - Build Release APK
setlocal

set ANDROID_SDK=C:\Android\Sdk

echo === Dango: Building Release APK ===

cd /d "%~dp0"

REM Check payload exists
if not exist "payload\bin\node" (
    echo.
    echo [!] Incomplete payload. Run: python fetch-termux-node.py
    echo.
    exit /b 1
)

if not exist "payload\npm\bin\npm-cli.js" (
    echo.
    echo [!] Incomplete payload. Run: python fetch-termux-node.py
    echo.
    exit /b 1
)

echo.
echo [1/2] Building release APK...
call gradlew.bat app:clean app:assembleRelease --no-daemon
if errorlevel 1 (
    echo.
    echo [!] Build failed.
    exit /b 1
)

echo.
echo [2/2] Done!
echo APK: android-app\app\build\outputs\apk\release\app-release.apk
echo.
echo Install: adb install -r android-app\app\build\outputs\apk\release\app-release.apk
echo.
