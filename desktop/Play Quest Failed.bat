@echo off
REM ============================================================
REM  Double-click launcher for the Quest Failed desktop build.
REM  Opens the game in its own window and closes this console
REM  immediately (the game keeps running independently).
REM ============================================================
setlocal
set "HERE=%~dp0"
set "ELECTRON=%HERE%node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" (
  echo Electron isn't installed yet. Installing dependencies once...
  echo This can take a few minutes.
  pushd "%HERE%"
  call npm install
  popd
)

REM Launch detached so this console window can close right away.
start "" "%ELECTRON%" "%HERE%."
exit
