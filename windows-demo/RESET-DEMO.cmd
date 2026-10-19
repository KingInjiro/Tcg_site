@echo off
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0runtime\python\python.exe" -I "%~dp0launcher.py" --reset
set "TCG_DEMO_EXIT=%errorlevel%"
pause
exit /b %TCG_DEMO_EXIT%
