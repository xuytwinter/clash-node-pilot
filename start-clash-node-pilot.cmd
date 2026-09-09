@echo off
setlocal
cd /d "%~dp0"
wscript.exe "%~dp0start-clash-node-pilot.vbs"
exit /b %errorlevel%
