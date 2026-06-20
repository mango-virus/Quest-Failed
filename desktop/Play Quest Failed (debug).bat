@echo off
REM ============================================================
REM  DEBUG launcher — same as "Play Quest Failed.bat" but opens
REM  the Chrome DevTools remote-debugging port (9222) so Claude
REM  can inspect/verify the live HUD. Close any running instance
REM  first (single-instance lock). Use the normal launcher for play.
REM ============================================================
setlocal
set "HERE=%~dp0"
set "ELECTRON=%HERE%node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" (
  echo Electron isn't installed yet. Installing dependencies once...
  pushd "%HERE%"
  call npm install
  popd
)

start "" "%ELECTRON%" "%HERE%." --remote-debugging-port=9222
exit
