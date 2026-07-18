@echo off
cd /d "%~dp0"
start "Clash Node Pilot" /min node.exe server.js
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:3210
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
