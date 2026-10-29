@echo off
setlocal
title YTT - Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\docker.ps1" up -OpenBrowser
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo YTT could not start. See the error above.
echo Make sure Docker Desktop is running with Linux containers.
pause
exit /b 1
