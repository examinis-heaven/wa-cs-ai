@echo off
setlocal
echo Menjalankan setup WA CS AI (Windows)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Setup gagal. Periksa pesan di atas.
  pause
  exit /b 1
)
echo.
pause
