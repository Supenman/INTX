@echo off
setlocal

echo ========================================
echo  BeastTV - Stop Development Server
echo ========================================
echo.

set "FOUND=0"

:: Backend (port 7352)
for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":7352 .*LISTENING"') do (
  set "FOUND=1"
  echo Stopping backend (PID %%A)...
  taskkill /PID %%A /F >nul 2>nul
  echo   Backend stopped.
)

:: Frontend (port 7351)
for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":7351 .*LISTENING"') do (
  set "FOUND=1"
  echo Stopping frontend (PID %%A)...
  taskkill /PID %%A /F >nul 2>nul
  echo   Frontend stopped.
)

if "%FOUND%"=="0" (
  echo No BeastTV development services were found.
) else (
  echo.
  echo BeastTV has been shut down.
)

echo.
pause
