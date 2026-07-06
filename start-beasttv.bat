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
echo Backend:  http://127.0.0.1:8000
echo Frontend: http://localhost:5173
echo.

start "BeastTV Backend" cmd /k "pushd "%ROOT%backend" && "%PYTHON%" main.py"
timeout /t 2 /nobreak >nul
start "BeastTV Frontend" cmd /k "pushd "%ROOT%" && npm run dev"
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"

echo BeastTV is starting. If the browser opens before Vite is ready, refresh after a few seconds.
echo To stop both services, run stop-beasttv.bat.
echo.
pause
