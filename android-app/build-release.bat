@echo off
REM Dango Android - Build Release APK
setlocal

set ANDROID_SDK=C:\Android\Sdk

echo === Dango: Building Release APK ===

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
echo [1/2] Building release APK...
call gradlew.bat app:clean app:assembleRelease --no-daemon
if errorlevel 1 (
    echo.
    echo [!] Build failed.
    exit /b 1
)

for /f "delims=" %%V in ('node "%~dp0app-version.js"') do set APP_VERSION=%%V
set APK_ARM64=app\build\outputs\apk\arm64\release\com.serifpersia.dango-v%APP_VERSION%-arm64-v8a.apk
set APK_ARMV7=app\build\outputs\apk\armv7\release\com.serifpersia.dango-v%APP_VERSION%-armeabi-v7a.apk

if not exist "%APK_ARM64%" (
    echo.
    echo [!] Expected APK not found: %APK_ARM64%
    dir /b app\build\outputs\apk\arm64\release\
    exit /b 1
)

if not exist "%APK_ARMV7%" (
    echo.
    echo [!] Expected APK not found: %APK_ARMV7%
    dir /b app\build\outputs\apk\armv7\release\
    exit /b 1
)

echo.
echo [2/2] Done!
echo APK (arm64-v8a): android-app\%APK_ARM64%
echo APK (armeabi-v7a): android-app\%APK_ARMV7%
echo Version: %APP_VERSION%
echo.
echo Install: adb install -r android-app\%APK_ARM64%
echo.
