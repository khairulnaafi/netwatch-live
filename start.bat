@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js tidak ditemukan.
  echo   Install Node.js 18+ dari https://nodejs.org lalu jalankan lagi file ini.
  echo.
  pause
  exit /b 1
)

echo.
echo   Menjalankan NetWatch Live...
echo   Browser akan terbuka otomatis di http://127.0.0.1:8787
echo   Tekan Ctrl+C di jendela ini untuk berhenti.
echo.

node server.js
if errorlevel 1 (
  echo.
  echo   Server berhenti dengan error. Periksa pesan di atas.
  pause
)
endlocal
