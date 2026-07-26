@echo off
cd /d "%~dp0"
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"
start "Clash Node Pilot" /min "%NODE_EXE%" server.js
timeout /t 2 /nobreak >nul
if not "%CLASH_PILOT_NO_BROWSER%"=="1" start "" http://127.0.0.1:3210
