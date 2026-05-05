@echo off
echo Clearing cache and rebuilding frontend...
cd /d "%~dp0frontend"
rmdir /s /q node_modules\.vite 2>nul
node script/build.mjs
echo.
echo Done! Press Ctrl+Shift+R in your browser to reload.
pause
