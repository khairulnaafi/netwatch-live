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
echo   Login        : %NETWATCH_USER% / (lihat live-auth.cmd)
echo.
echo   Tunnel publik akan dibuat. Salin alamat
echo   https://xxxxx.trycloudflare.com yang muncul di bawah.
echo.
echo   PENTING: alamat tunnel berubah setiap kali dijalankan.
echo   Biarkan jendela ini tetap terbuka selama monitoring.
echo ============================================================
echo.

start "NetWatch Server" /min cmd /c "node server.js --no-open"

rem beri waktu server menyala sebelum tunnel diarahkan
timeout /t 3 /nobreak >nul

"%CF%" tunnel --url http://127.0.0.1:8787 --no-autoupdate

echo.
echo Tunnel berhenti. Tekan tombol apa saja untuk menutup.
pause >nul
