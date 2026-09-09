@echo off
setlocal EnableDelayedExpansion

cls

if not "%~1"=="" (
    set "choice=%~1"
    goto process_choice
)

:menu

echo.
echo ---------------------------------------------
echo                     dango                    
echo ---------------------------------------------
echo https://github.com/serifpersia/dango
echo ---------------------------------------------
echo.
echo Please choose a mode to run:
echo   1) Development (Install all deps, build, and run hot-reload)
echo   2) Production  (Run pre-built version)
echo.

set /p choice="Enter your choice (1 or 2): "
echo.

:process_choice
if "!choice!"=="1" goto execute_dev
if "!choice!"=="2" goto execute_prod

echo Invalid choice. Please try again.
timeout /t 2 >nul
goto menu

:execute_dev
echo Running in DEVELOPMENT mode...
echo.
echo --^> Installing all dependencies...
call npm install
echo.
echo --^> Starting Development Server...
node orchestrator.js dev
goto end

:execute_prod
echo Running in PRODUCTION mode...
echo.

if /i "%~2"=="rebuild" goto force_build
if /i "%~2"=="--rebuild" goto force_build
if exist "server\dist\server.js" if exist "client\dist" (
    echo --^> Pre-built files found. Skipping build... (use 'run.bat 2 rebuild' to force rebuild after git pull)
    goto after_build
)
:do_build
echo --^> Build missing. Installing and Building...
call npm install
if !errorlevel! neq 0 (
    echo Error: Install failed!
    pause
    exit /b 1
)
call npm run build
if !errorlevel! neq 0 (
    echo Error: Build failed!
    pause
    exit /b 1
)
goto after_build
:force_build
echo --^> Rebuild requested. Installing and Building...
call npm install
call npm run build
:after_build

echo.
echo --^> Starting application in production mode...
node orchestrator.js prod
goto end

:end
endlocal
