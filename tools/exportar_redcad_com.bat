@echo off
setlocal
set "SCRIPT=%~dp0exportar_redcad_com.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%SCRIPT%" %*
pause
