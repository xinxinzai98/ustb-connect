@echo off
chcp 65001 >nul
setlocal
set ELECTRON_RUN_AS_NODE=1
set "USTB_SERVICE=%ProgramFiles%\BKQL Connect Service"
if not exist "%USTB_SERVICE%\USTB Connect.exe" (
  echo 未找到本应用的后台服务。请确认已完成后台服务安装。
  pause
  exit /b 1
)
"%USTB_SERVICE%\USTB Connect.exe" "%USTB_SERVICE%\resources\app\src\stop.cjs"
pause
