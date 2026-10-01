@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
    echo Потрібен Node.js 24 LTS: https://nodejs.org/en/download
    echo Після встановлення запустіть цей файл ще раз.
    pause
    exit /b 1
)
node scripts\start-editor.js
if errorlevel 1 pause
