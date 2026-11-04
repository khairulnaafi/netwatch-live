@echo off
REM Nyalakan hotspot PC dan jaga supaya tetap hidup selama NetWatch berjalan.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\hotspot-watch.ps1" %*
pause
