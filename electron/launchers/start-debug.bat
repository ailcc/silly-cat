@echo off
rem SillyCat Electron demo: start with a magenta/cyan debug frame around the window
cd /d "%~dp0"
set SILLYCAT_DEBUG=1
start "" "SillyCatElectronDemo.exe"
