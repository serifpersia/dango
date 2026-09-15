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

for /f "delims=" %%V in ('node "%~dp0app-version.js"') do set APP_VERSION=%%V
set APK_NAME=com.serifpersia.dango-v%APP_VERSION%-universal-debug.apk
set APK_PATH=app\build\outputs\apk\debug\%APK_NAME%

if not exist "%APK_PATH%" (
    echo.
    echo [!] Expected APK not found: %APK_PATH%
    dir /b app\build\outputs\apk\debug\
    exit /b 1
)

echo.
echo [2/2] Done!
echo APK: android-app\%APK_PATH%
echo Version: %APP_VERSION%
echo.
echo Install: adb install -r android-app\%APK_PATH%
echo.
