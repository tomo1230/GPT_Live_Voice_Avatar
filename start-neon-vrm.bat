@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [NEON] Node.js 20 or later is required.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [NEON] Installing local dependencies...
  call npm install
  if errorlevel 1 (
    echo [NEON] Dependency installation failed.
    pause
    exit /b 1
  )
)

powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4782/' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if errorlevel 1 (
  echo [NEON] Starting local VRM server...
  start "NEON VRM Server" /min cmd.exe /k "cd /d ""%~dp0"" && npm start"

  set "NEON_READY="
  for /l %%I in (1,1,20) do (
    if not defined NEON_READY (
      timeout /t 1 /nobreak >nul
      powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4782/' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
      if not errorlevel 1 set "NEON_READY=1"
    )
  )

  if not defined NEON_READY (
    echo [NEON] Server did not become ready.
    pause
    exit /b 1
  )
) else (
  echo [NEON] Server is already running.
)

echo [NEON] Opening http://127.0.0.1:4782
start "" "http://127.0.0.1:4782"
exit /b 0
