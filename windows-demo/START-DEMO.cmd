@echo off
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0runtime\python\python.exe" -I "%~dp0launcher.py"
set "TCG_DEMO_EXIT=%errorlevel%"
if not "%TCG_DEMO_EXIT%"=="0" pause
exit /b %TCG_DEMO_EXIT%
