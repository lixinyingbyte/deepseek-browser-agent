@echo off
chcp 65001 >nul
title DeepSeek Agent - Web UI
set DSA_LANG=zh
cd /d "%~dp0"
echo.
echo   正在启动 DeepSeek Agent Web 界面...
echo   启动后浏览器会自动打开 http://127.0.0.1:4765
echo   关闭此窗口即可停止服务。
echo.
node "%~dp0src\ui\server.js"
echo.
echo   服务已停止。按任意键关闭窗口...
pause >nul
