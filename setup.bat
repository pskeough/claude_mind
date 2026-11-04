@echo off
REM ====================================================================
REM  Claude Mind - setup bootstrap (Windows, double-clickable)
REM
REM  Exists so a non-technical Windows user can start without opening a
REM  terminal or knowing about ExecutionPolicy. Delegates to setup.ps1;
REM  everything real lives there.
REM ====================================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
echo.
pause
