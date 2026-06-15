@echo off
REM Multi-Platform Marketing Orchestrator - Windows Service Script
REM 
REM This script starts the orchestrator in scheduled mode.
REM It will:
REM  - Validate config on startup
REM  - Check every minute for scheduled post times
REM  - Run full pipeline at each scheduled time
REM  - Send alerts to logs/alerts.log on failures
REM
REM Add to Windows Task Scheduler:
REM   Program: node
REM   Arguments: "C:\path\to\tiktok-marketing\orchestrator.js" --schedule
REM   Working dir: C:\path\to\tiktok-marketing
REM   Trigger: At system startup
REM   Run with highest privileges: No

setlocal
cd /d "%~dp0"

echo [%date% %time%] Starting Multi-Platform Orchestrator in scheduled mode...

node orchestrator.js --schedule

endlocal