@echo off
setlocal EnableDelayedExpansion

cls

if not "%1"=="" (
    set "choice=%1"
    goto process_choice
)

:menu

powershell -NoProfile -Command ^
    "Write-Host '';" ^
    "Write-Host '---------------------------------------------' -ForegroundColor Yellow;" ^
    "Write-Host '                dango' -ForegroundColor Cyan;" ^
    "Write-Host '---------------------------------------------' -ForegroundColor Yellow;" ^
    "Write-Host 'https://github.com/serifpersia/dango' -ForegroundColor Blue;" ^
    "Write-Host '---------------------------------------------' -ForegroundColor Yellow;" ^
    "Write-Host '';" ^
    "Write-Host 'Please choose a mode to run:' -ForegroundColor Yellow"

echo   1) Development (Install all deps, build, and run hot-reload)
echo   2) Production  (Run pre-built version)
echo.

set /p choice="Enter your choice (1 or 2): "
echo.

:process_choice
if "%choice%"=="1" goto execute_dev
if "%choice%"=="2" goto execute_prod

powershell -NoProfile -Command "Write-Host 'Invalid choice. Please try again.' -ForegroundColor Red"
timeout /t 2 >nul
goto menu

:execute_dev
powershell -NoProfile -Command "Write-Host 'Running in DEVELOPMENT mode...' -ForegroundColor Cyan"
echo.
echo --^> Installing all dependencies...
call npm install
echo.
echo --^> Starting Development Server...
node orchestrator.js dev
goto end

:execute_prod
powershell -NoProfile -Command "Write-Host 'Running in PRODUCTION mode...' -ForegroundColor Green"
echo.

if exist "server\dist\server.js" if exist "client\dist" (
    echo --^> Pre-built files found. Skipping build...
) else (
    echo --^> Build missing. Installing and Building...
    call npm install
    if !errorlevel! neq 0 (
        powershell -NoProfile -Command "Write-Host 'Error: Install failed!' -ForegroundColor Red"
        pause
        exit /b 1
    )
    call npm run build
    if !errorlevel! neq 0 (
        powershell -NoProfile -Command "Write-Host 'Error: Build failed!' -ForegroundColor Red"
        pause
        exit /b 1
    )
)

echo.
echo --^> Ensuring Production Dependencies for server...
cd server
call npm install --omit=dev
cd ..

echo.
echo --^> Starting application in production mode...
node orchestrator.js prod
goto end

:end
endlocal