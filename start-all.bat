@echo off
REM CarShine Red Sea - Production Server Starter
REM Starts both services fully detached from terminal

setlocal
cd /d "%~dp0"

echo ==========================================
echo   CarShine Red Sea - Starting Services
echo ==========================================
echo.

REM Kill any existing instances
echo Cleaning up any existing processes...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5000" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4173" ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul
timeout /t 1 /nobreak > nul

REM Start Service Agent on port 5000 (fully detached)
echo [1/2] Starting Service Agent (port 5000)...
start "CarShine-Service-Agent" /B /MIN cmd /c "cd /d %~dp0service-agent && node server.js < nul > service-agent.log 2>&1"

REM Start Landing Page on port 4173 (fully detached)
echo [2/2] Starting Landing Page (port 4173)...
start "CarShine-Landing-Page" /B /MIN cmd /c "cd /d %~dp0 && node serve-landing.cjs < nul > landing.log 2>&1"

REM Wait for servers to start
echo.
echo Waiting for servers to start...
timeout /t 5 /nobreak > nul

REM Verify
echo.
echo ==========================================
echo   Status Check
echo ==========================================
echo.

netstat -ano | findstr ":5000" | findstr "LISTENING" > nul 2>&1
if %errorlevel% == 0 (
    echo   Service Agent (5000): RUNNING
) else (
    echo   Service Agent (5000): FAILED - check service-agent.log
)

netstat -ano | findstr ":4173" | findstr "LISTENING" > nul 2>&1
if %errorlevel% == 0 (
    echo   Landing Page (4173): RUNNING
) else (
    echo   Landing Page (4173): FAILED - check landing.log
)

echo.
echo ==========================================
echo   Open These URLs in Your Browser
echo ==========================================
echo.
echo   Service Agent:  http://localhost:5000
echo   Admin Login:    http://localhost:5000/login
echo   API Docs:       http://localhost:5000/api-docs/
echo   Chatbot Demo:   http://localhost:5000/chatbot-demo.html
echo   Health Check:   http://localhost:5000/health
echo.
echo   Landing Page:   http://localhost:4173/
echo   Arabic:         http://localhost:4173/ar/
echo   German:         http://localhost:4173/de/
echo.
echo ==========================================
echo   Login Credentials
echo ==========================================
echo.
echo   Email:    admin@carshineredsea.com
echo   Password: ChangeMe123!
echo.
echo ==========================================
echo.

endlocal