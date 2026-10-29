@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title NetWatch Live - Tunnel Publik

if exist "live-auth.cmd" call "live-auth.cmd"

if not defined NETWATCH_USER goto :noauth
if not defined NETWATCH_PASS goto :noauth
goto :authok
:noauth
echo [!] live-auth.cmd belum ada atau kosong.
echo     File itu berisi username/password dashboard publik.
echo     Buat file live-auth.cmd berisi dua baris:
echo         set NETWATCH_USER=netwatch
echo         set NETWATCH_PASS=passwordAnda
echo.
pause
exit /b 1
:authok

set NETWATCH_DEMO=0

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js tidak ditemukan. Install dari https://nodejs.org lalu coba lagi.
  pause
  exit /b 1
)

set "CF=%LOCALAPPDATA%\cloudflared\cloudflared.exe"
if not exist "%CF%" (
  echo cloudflared belum ada, mengunduh...
  powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; New-Item -ItemType Directory -Force '%LOCALAPPDATA%\cloudflared' | Out-Null; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CF%' -UseBasicParsing"
)
if not exist "%CF%" (
  echo [!] Gagal mengunduh cloudflared. Unduh manual dari:
  echo     https://github.com/cloudflare/cloudflared/releases
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   NETWATCH LIVE - MONITORING JARINGAN ASLI
echo ============================================================
echo   Server lokal : http://127.0.0.1:8787
echo   Login        : tidak perlu (link admin dibuka otomatis)
echo.
echo   Tunnel publik akan dibuat. Salin alamat
echo   https://xxxxx.trycloudflare.com yang muncul di bawah.
echo.
echo   PENTING: alamat tunnel berubah setiap kali dijalankan.
echo   Biarkan jendela ini tetap terbuka selama monitoring.
echo ============================================================
echo.

set "NW_TOKEN="
for /f "usebackq delims=" %%T in (`node "tools\admin-token.js"`) do set "NW_TOKEN=%%T"
if defined NW_TOKEN set "ADMIN_URL=http://127.0.0.1:8787/?k=!NW_TOKEN!"

start "NetWatch Server" /min cmd /c "node server.js --no-open"

rem beri waktu server menyala sebelum tunnel diarahkan
timeout /t 3 /nobreak >nul

if defined ADMIN_URL (
  echo   Link admin (langsung masuk, tanpa login):
  echo   !ADMIN_URL!
  echo   Simpan link itu sebagai bookmark.
  echo.
  start "" "!ADMIN_URL!"
) else (
  echo   [!] Link admin tidak bisa dibuat. Buka http://127.0.0.1:8787
  echo       lalu login dengan %NETWATCH_USER%.
  echo.
)

"%CF%" tunnel --url http://127.0.0.1:8787 --no-autoupdate

echo.
echo Tunnel berhenti. Tekan tombol apa saja untuk menutup.
pause >nul
