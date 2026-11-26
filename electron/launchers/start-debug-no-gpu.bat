@echo off
rem SillyCat Electron demo: debug frame + GPU disabled
cd /d "%~dp0"
set SILLYCAT_DEBUG=1
start "" "SillyCatElectronDemo.exe" --disable-gpu
