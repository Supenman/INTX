@echo off
setlocal

echo ========================================
echo  BeastTV - Stop Development Server
echo ========================================
echo.

set "FOUND=0"

for %%P in (8000 5173) do (
  echo Checking port %%P...
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    set "FOUND=1"
    echo Stopping PID %%A on port %%P...
    taskkill /PID %%A /F >nul 2>nul
    if errorlevel 1 (
      echo   Could not stop PID %%A. It may already be closed or require permission.
    ) else (
      echo   Stopped PID %%A.
    )
  )
)

if "%FOUND%"=="0" (
  echo No BeastTV development services were found on ports 8000 or 5173.
) else (
  echo.
  echo BeastTV development services have been stopped.
)

echo.
pause
