@echo off
rem SillyCat Electron demo: start with GPU disabled (software rendering)
cd /d "%~dp0"
start "" "SillyCatElectronDemo.exe" --disable-gpu
