@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================
REM  DeepSeek Agent — Convenience Launcher (Windows)
REM ------------------------------------------------------------
REM  1. Checks that the NekoBox proxy is listening on 127.0.0.1:2080
REM  2. Optionally routes the agent through that proxy
REM  3. Starts the DeepSeek browser agent
REM ============================================================

title DeepSeek Agent Launcher

set "PROXY_HOST=127.0.0.1"
set "PROXY_PORT=2080"
set "AGENT_DIR=%~dp0"

REM Allow overriding the port via the first argument
if not "%~1"=="" set "PROXY_PORT=%~1"

echo.
echo  ============================================================
echo   DeepSeek Agent Launcher
echo  ============================================================
echo.

REM ---------- Step 1: Check the proxy port ----------
echo  [1/3] Checking proxy at %PROXY_HOST%:%PROXY_PORT% ...

set "LISTENING="
for /f "tokens=*" %%L in ('netstat -ano ^| findstr ":%PROXY_PORT% " ^| findstr /I "LISTENING"') do (
    set "LISTENING=1"
)

if defined LISTENING (
    echo        [OK] Proxy port %PROXY_PORT% is LISTENING.
) else (
    echo        [WARN] Nothing is listening on port %PROXY_PORT%.
    echo               Is NekoBox running with the proxy enabled?
    echo.
    set /p "CONTINUE=        Continue anyway? [y/N]: "
    if /I not "!CONTINUE!"=="y" (
        echo.
        echo        Aborted. Start NekoBox first, then re-run this script.
        echo.
        pause
        exit /b 1
    )
)

REM ---------- Step 2: Configure proxy env for the agent ----------
echo.
echo  [2/3] Configuring environment ...

set /p "USEPROXY=  Route the agent through the proxy? [Y/n]: "
if /I "!USEPROXY!"=="n" (
    echo        Skipping proxy environment variables.
) else (
    set "HTTP_PROXY=http://%PROXY_HOST%:%PROXY_PORT%"
    set "HTTPS_PROXY=http://%PROXY_HOST%:%PROXY_PORT%"
    set "ALL_PROXY=socks5://%PROXY_HOST%:%PROXY_PORT%"
    echo        HTTP_PROXY  = !HTTP_PROXY!
    echo        HTTPS_PROXY = !HTTPS_PROXY!
    echo        ALL_PROXY   = !ALL_PROXY!
)

REM ---------- Step 3: Launch the agent ----------
echo.
echo  [3/3] Starting DeepSeek Agent ...
echo  ------------------------------------------------------------
echo.

cd /d "%AGENT_DIR%"

where dsa >nul 2>nul
if %errorlevel%==0 (
    call dsa %*
) else (
    call node "%AGENT_DIR%src\index.js" %*
)

set "EXITCODE=%errorlevel%"

echo.
echo  ------------------------------------------------------------
echo   DeepSeek Agent exited with code %EXITCODE%.
echo  ------------------------------------------------------------
pause
exit /b %EXITCODE%
