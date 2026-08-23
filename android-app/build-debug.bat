@echo off
REM Dango Android - Build Debug APK
setlocal

set ANDROID_SDK=C:\Android\Sdk

echo === Dango: Building Debug APK ===

cd /d "%~dp0"

REM Check payload exists
set HAS_NODE=0
if exist "payload\arm64-v8a\bin\node" set HAS_NODE=1
if exist "payload\bin\node" set HAS_NODE=1

set HAS_NPM=0
if exist "payload\common\npm\bin\npm-cli.js" set HAS_NPM=1
if exist "payload\npm\bin\npm-cli.js" set HAS_NPM=1

if "%HAS_NODE%"=="0" (
    echo.
    echo [!] Incomplete payload: node binary missing. Run: python fetch-termux-node.py
    echo.
    exit /b 1
)

if "%HAS_NPM%"=="0" (
    echo.
    echo [!] Incomplete payload: npm missing. Run: python fetch-termux-node.py
    echo.
    exit /b 1
)

echo.
echo [1/2] Building debug APK...
call gradlew.bat app:clean app:assembleDebug --no-daemon
if errorlevel 1 (
    echo.
    echo [!] Build failed.
    exit /b 1
)

echo.
echo [2/2] Done!
echo APK: android-app\app\build\outputs\apk\debug\com.serifpersia.dango-universal-debug.apk
echo.
echo Install: adb install -r android-app\app\build\outputs\apk\debug\com.serifpersia.dango-universal-debug.apk
echo.
