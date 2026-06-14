@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "NODE_EXE=node"
set "LOCAL_NODE=%CD%\.runtime\node\node.exe"
set "NODE_MAJOR="
if exist "%LOCAL_NODE%" (
  for /f %%v in ('"%LOCAL_NODE%" -p "Number(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%v"
  if defined NODE_MAJOR if !NODE_MAJOR! GEQ 24 (
    set "NODE_EXE=%LOCAL_NODE%"
    set "PATH=%CD%\.runtime\node;%PATH%"
    goto run_node
  )
)

set "NODE_MAJOR="
for /f %%v in ('node -p "Number(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%v"
if defined NODE_MAJOR if !NODE_MAJOR! GEQ 24 goto run_node

where powershell >nul 2>nul
if errorlevel 1 (
  echo Node.js 24+ is required, and PowerShell is not available to configure a local Node.js runtime.
  echo Install Node.js from https://nodejs.org/ and run this launcher again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\bootstrap-node.ps1" -Root "%CD%"
if errorlevel 1 (
  pause
  exit /b 1
)

set "NODE_EXE=%LOCAL_NODE%"
set "PATH=%CD%\.runtime\node;%PATH%"

:run_node
"%NODE_EXE%" scripts\quick-start.mjs %*
set "exitCode=%ERRORLEVEL%"
echo.
if not "%AI_DND_NO_PAUSE%"=="1" pause
exit /b %exitCode%
