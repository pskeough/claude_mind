@echo off
rem Launcher for the Claude Mind scheduled jobs (registered by install-jobs.mjs).
rem Task Scheduler starts every job in C:\Windows\System32, where `node --import tsx`
rem cannot resolve tsx and the jobs die on start. Run each job from the vault instead.
rem   run-job.cmd "<node.exe>" <args...>
cd /d "%~dp0.."
%*
