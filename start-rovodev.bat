@echo off
setlocal EnableDelayedExpansion
title Rovo Dev for OpenCode
color 0A

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%.") do set "SCRIPT_DIR=%%~fI"

echo.
echo  ========================================================
echo   Rovo Dev Proxy Starter for OpenCode
echo  ========================================================
echo.

REM ── Check prerequisites ──

where bun >nul 2>&1
if %ERRORLEVEL% neq 0 (
    color 0C
    echo  [ERROR] Bun is not installed or not in PATH.
    echo          Install from: https://bun.sh
    echo.
    pause
    exit /b 1
)
echo  [OK] bun found

REM ── Find acli: check PATH first, then common locations ──
set "ACLI_CMD="
where acli >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set "ACLI_CMD=acli"
) else if exist "%USERPROFILE%\acli.exe" (
    set "ACLI_CMD=%USERPROFILE%\acli.exe"
) else if exist "%LOCALAPPDATA%\Programs\acli\acli.exe" (
    set "ACLI_CMD=%LOCALAPPDATA%\Programs\acli\acli.exe"
) else if exist "%APPDATA%\npm\acli.cmd" (
    set "ACLI_CMD=%APPDATA%\npm\acli.cmd"
)

if not defined ACLI_CMD (
    color 0C
    echo  [ERROR] Atlassian CLI ^(acli^) not found.
    echo.
    echo          Searched:
    echo            - PATH
    echo            - %USERPROFILE%\acli.exe
    echo            - %LOCALAPPDATA%\Programs\acli\acli.exe
    echo            - %APPDATA%\npm\acli.cmd
    echo.
    echo          Install it or move acli.exe to one of the above.
    echo          Then authenticate:  acli rovodev auth login
    echo.
    pause
    exit /b 1
)

echo  [OK] acli found: %ACLI_CMD%
echo.

REM ── Find git and make it visible to child processes ──
set "GIT_CMD="
where git >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "delims=" %%G in ('where git') do (
        if not defined GIT_CMD set "GIT_CMD=%%G"
    )
) else if exist "%ProgramFiles%\Git\cmd\git.exe" (
    set "GIT_CMD=%ProgramFiles%\Git\cmd\git.exe"
) else if exist "%ProgramFiles%\Git\bin\git.exe" (
    set "GIT_CMD=%ProgramFiles%\Git\bin\git.exe"
) else if exist "%LocalAppData%\Programs\Git\cmd\git.exe" (
    set "GIT_CMD=%LocalAppData%\Programs\Git\cmd\git.exe"
) else if exist "%LocalAppData%\Programs\Git\bin\git.exe" (
    set "GIT_CMD=%LocalAppData%\Programs\Git\bin\git.exe"
) else if exist "D:\App\Git\cmd\git.exe" (
    set "GIT_CMD=D:\App\Git\cmd\git.exe"
) else if exist "D:\App\Git\mingw64\bin\git.exe" (
    set "GIT_CMD=D:\App\Git\mingw64\bin\git.exe"
)

if defined GIT_CMD (
    for %%I in ("%GIT_CMD%") do set "GIT_DIR=%%~dpI"
    set "PATH=%GIT_DIR%;%PATH%"
    set "GIT_PATH=%GIT_CMD%"
    echo  [OK] git found: %GIT_CMD%
) else (
    echo  [WARN] git not found. Rovo Dev may fall back to C:\Users\... and log git-ai warnings.
)
echo.

REM ── Configurable ports ──
set ROVODEV_PORT=8123
set PROXY_PORT=4100

REM ── Check if Rovo Dev is actually running on the port ──
curl -sf http://localhost:%ROVODEV_PORT%/healthcheck >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [WARN] Rovo Dev already responding on port %ROVODEV_PORT%.
    echo         Skipping 'acli rovodev serve'.
    goto :start_proxy
)

REM ── Also check if something else is LISTENING on the port ──
netstat -ano 2>nul | findstr ":%ROVODEV_PORT% " | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [WARN] Port %ROVODEV_PORT% already in use by another process.
    echo         If Rovo Dev isn't running, kill that process first.
    echo         Trying to start anyway...
)

REM ── Start Rovo Dev serve mode in a new window ──
echo  Starting '%ACLI_CMD% rovodev serve %ROVODEV_PORT% --disable-session-token' ...
start "RovoDev Serve (port %ROVODEV_PORT%)" /D "%SCRIPT_DIR%" cmd /k "set PATH=%PATH% && set GIT_PATH=%GIT_PATH% && "%ACLI_CMD%" rovodev serve %ROVODEV_PORT% --disable-session-token"

echo  Waiting for Rovo Dev to initialize (8s)...
timeout /t 8 /nobreak >nul

REM ── Verify Rovo Dev is up ──
curl -sf http://localhost:%ROVODEV_PORT%/healthcheck >nul 2>&1
if %ERRORLEVEL% neq 0 (
    color 0E
    echo.
    echo  [WARN] Could not reach Rovo Dev healthcheck yet.
    echo         It may still be starting. Continuing anyway...
    echo.
) else (
    echo  [OK] Rovo Dev is healthy on port %ROVODEV_PORT%
)

:start_proxy
echo.
echo  Starting OpenAI proxy on port %PROXY_PORT% ...
echo  (Press Ctrl+C to stop)
echo.
echo  --------------------------------------------------------
echo   When OpenCode asks for auth, select:
echo     "Rovo Dev (Local Proxy)"
echo   and enter any text as the API key (e.g. "rovodev").
echo  --------------------------------------------------------
echo.

bun "%SCRIPT_DIR%\rovodev-proxy.ts" --rovodev-port %ROVODEV_PORT% --proxy-port %PROXY_PORT%

REM ── If proxy exits, offer to clean up ──
echo.
echo  Proxy stopped.
echo.
set /p CLEANUP="  Kill Rovo Dev serve too? (Y/N): "
if /i "!CLEANUP!"=="Y" (
    echo  Stopping Rovo Dev...
    taskkill /FI "WINDOWTITLE eq RovoDev Serve*" >nul 2>&1
    echo  Done.
)

pause
