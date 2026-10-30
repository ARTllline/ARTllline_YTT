@echo off
setlocal
title YTT - Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local.ps1" stop
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo YTT could not stop. See the error above.
pause
exit /b 1
