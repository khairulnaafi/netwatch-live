@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title NetWatch Agent - Wi-Fi sekitar perangkat ini

set "SERVER="
set "KEY="
set "NAME="

rem --- Prioritas 1: argumen baris perintah ---
if not "%~1"=="" set "SERVER=%~1"
if not "%~2"=="" set "KEY=%~2"
if not "%~3"=="" set "NAME=%~3"

rem --- Prioritas 2: agent-config.txt (baris 1 server, 2 kunci, 3 nama) ---
if not defined SERVER if exist "agent-config.txt" (
  set /a n=0
  for /f "usebackq delims=" %%A in ("agent-config.txt") do (
    set /a n+=1
    if !n!==1 set "SERVER=%%A"
    if !n!==2 set "KEY=%%A"
    if !n!==3 set "NAME=%%A"
  )
)

echo ============================================================
echo   NETWATCH AGENT
echo   Mengirim Wi-Fi di sekitar laptop ini ke dashboard NetWatch.
echo ============================================================
echo.

if not defined SERVER set /p SERVER=Alamat dashboard (contoh https://xxxxx.trycloudflare.com): 
if not defined KEY set /p KEY=Kunci agent: 
if not defined NAME set /p NAME=Nama lokasi (contoh: Laptop Budi): 

if not defined SERVER (
  echo [!] Alamat dashboard tidak boleh kosong.
  pause
  exit /b 1
)
if not defined KEY (
  echo [!] Kunci agent tidak boleh kosong.
  pause
  exit /b 1
)
if not defined NAME set "NAME=%COMPUTERNAME%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1" -Server "%SERVER%" -Key "%KEY%" -Name "%NAME%"

echo.
echo Agent berhenti.
pause
