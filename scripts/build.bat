@echo off
setlocal

pushd "%~dp0.." || exit /b 1

echo Building minetacs.wasm
cargo build --release --target wasm32-unknown-unknown --lib
if errorlevel 1 goto :error

copy /Y "target\wasm32-unknown-unknown\release\minetacs.wasm" "public\minetacs.wasm" >nul
if errorlevel 1 goto :error

echo Finished %CD%\public\index.html
popd
exit /b 0

:error
set "exit_code=%errorlevel%"
popd
exit /b %exit_code%
