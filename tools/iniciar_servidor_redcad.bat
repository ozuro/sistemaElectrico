@echo off
setlocal
title Generador local RedCAD
cd /d "%~dp0.."
echo Iniciando generador local RedCAD...
echo.
echo Verificando Microsoft Excel COM...
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "tools\verificar_excel_com.ps1"
if errorlevel 1 (
  echo.
  echo No se puede generar XLS RedCAD sin Microsoft Excel de escritorio instalado.
  echo Instale/active Excel, abra Excel una vez manualmente, cierrelo y vuelva a ejecutar este BAT.
  pause
  exit /b 1
)
echo.
echo Mantenga esta ventana abierta.
echo En el navegador presione "Generar XLS RedCAD".
echo.
node tools\redcad_local_server.js
pause
