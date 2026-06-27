@echo off
REM ====================================================================
REM  Claude Mind - one-click launcher (Windows)
REM  Starts the retrieval daemon, the ambient watcher, and the web
REM  console (each only if not already running), then opens the console.
REM ====================================================================
cd /d "%~dp0"
echo Starting Claude Mind...

powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 7077 -State Listen -EA SilentlyContinue)) { Start-Process node -ArgumentList '--import','tsx','.claude\bin\lkhs-daemon.ts' -WorkingDirectory '%~dp0' -WindowStyle Hidden; 'started daemon' } else { 'daemon already up' }"
powershell -NoProfile -Command "if (-not (Get-Process node -EA SilentlyContinue | Where-Object { (Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.Id)).CommandLine -match 'ambient-watcher' })) { Start-Process node -ArgumentList '--import','tsx','.claude\bin\ambient-watcher.ts' -WorkingDirectory '%~dp0' -WindowStyle Hidden; 'started watcher' } else { 'watcher already up' }"
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 7099 -State Listen -EA SilentlyContinue)) { Start-Process node -ArgumentList '--import','tsx','.claude\bin\lkhs-web.ts' -WorkingDirectory '%~dp0' -WindowStyle Hidden; 'started web console' } else { 'console already up' }"

echo Waiting for the console to warm up...
powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){ try{ Invoke-RestMethod http://127.0.0.1:7099/api/overview -TimeoutSec 1 | Out-Null; break }catch{ Start-Sleep 1 } }"

start "" http://127.0.0.1:7099
echo.
echo  Claude Mind Console:  http://127.0.0.1:7099
echo  (leave this window; the services run in the background)
timeout /t 4 >nul
