@echo off
setlocal
title YTT - Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local.ps1" start -OpenBrowser
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo YTT could not start. See the error above.
echo Check local PHP, Node and MySQL. See docs\LOCAL_DEVELOPMENT.md.
pause
exit /b 1
