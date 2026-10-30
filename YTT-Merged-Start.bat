@echo off
setlocal
title YTT - Merged campaigns
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0artifacts\data-merge-20261030-merge1\manage.ps1" up -OpenBrowser
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Merged YTT could not start. The existing data was not reset.
echo See the error above and check Docker Desktop.
pause
exit /b 1
