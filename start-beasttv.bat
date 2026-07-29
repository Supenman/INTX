@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ========================================
echo  BeastTV - Start Development Server
echo ========================================
echo Project: %ROOT%
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python was not found. Please install Python first.
  pause
  exit /b 1
)

if not exist "%ROOT%node_modules" (
  echo [1/4] Installing frontend dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [1/4] Frontend dependencies already installed.
)

if not exist "%ROOT%backend\venv\Scripts\python.exe" (
  echo [2/4] Creating backend virtual environment...
  python -m venv "%ROOT%backend\venv"
  if errorlevel 1 (
    echo [ERROR] Failed to create Python virtual environment.
    pause
    exit /b 1
  )
)

set "PYTHON=%ROOT%backend\venv\Scripts\python.exe"

"%PYTHON%" -c "import fastapi, uvicorn, httpx" >nul 2>nul
if errorlevel 1 (
  echo [3/4] Installing backend dependencies...
  "%PYTHON%" -m pip install fastapi uvicorn httpx python-dotenv
  if errorlevel 1 (
    echo [ERROR] Backend dependency installation failed.
    pause
    exit /b 1
  )
) else (
  echo [3/4] Backend dependencies already installed.
)

echo [4/4] Starting services...
echo.

:: Backend in the same console (background) — closes when this window closes
start /B "" cmd /c "pushd "%ROOT%backend" && "%PYTHON%" main.py" > backend.log 2>&1
timeout /t 2 /nobreak >nul

:: Frontend in the foreground
echo Backend:  http://127.0.0.1:7352  (log: backend.log)
echo Frontend: http://localhost:7351
echo.
echo Close this window to stop all services.
echo.
start "" "http://localhost:7351"
pushd "%ROOT%" && npm run dev

:: Ctrl+C fallback — clean up backend if npm exits first
echo.
echo Stopping backend...
for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":7352 .*LISTENING"') do (
  taskkill /PID %%A /F >nul 2>nul
)
echo All services stopped.
pause
