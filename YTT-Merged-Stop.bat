@echo off
setlocal
title YTT - Stop merged campaigns
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0artifacts\data-merge-20261030-merge1\manage.ps1" stop
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Could not stop the merged environment. Data volumes were not removed.
pause
exit /b 1
