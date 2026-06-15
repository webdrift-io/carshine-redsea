@echo off
REM Persistent server startup - detached from terminal
setlocal

cd /d "%~dp0service-agent"

REM Start service agent detached, with stdin redirected
start "CarShine-Service-Agent" /B /MIN cmd /c "node server.js < nul > service-agent.log 2>&1"

echo Started CarShine Service Agent (PID will be in service-agent.log)
endlocal