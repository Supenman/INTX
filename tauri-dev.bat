@echo off
call "C:/Program Files/Microsoft Visual Studio/2022/Community/VC/Auxiliary/Build/vcvars64.bat" -vcvars_ver=14.44
cd /d "%~dp0"

REM clean up old dev server if any
for /f %%p in ('powershell -NoProfile -Command "& {Get-NetTCPConnection -LocalPort 7351 -ErrorAction SilentlyContinue | Select -ExpandProperty OwningProcess}"') do taskkill /F /PID %%p 2>nul

npx tauri dev
pause
