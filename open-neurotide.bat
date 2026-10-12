@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   NeuroTide 本地启动器
echo   ----------------------------------------
echo   本窗口是本地静态服务器（仅监听 127.0.0.1，
echo   不会上传任何数据）。关闭窗口即停止。
echo.
echo   为什么需要服务器：截图 OCR 要加载识别引擎，
echo   浏览器在 file:// 下不会发这些请求，故 OCR 模式需走 http://。
echo   不用 OCR 的话，直接双击 index.html 也能用。
echo.

set "SERVE=%~dp0scripts\serve.ps1"

if not exist "dist\index.html" (
  echo   未找到 dist\index.html。
  echo   源码仓库请先运行 npm run build；分发包应直接包含 index.html。
  echo.
  pause
  exit /b 1
)

if not exist "%SERVE%" (
  echo   未找到 scripts\serve.ps1，无法启动本地服务器。
  echo.
  pause
  exit /b 1
)

echo   正在启动并打开浏览器...
rem -ExecutionPolicy Bypass 只对本进程生效，不会改动机器的全局执行策略
powershell -NoProfile -ExecutionPolicy Bypass -File "%SERVE%" -Port 4173 -Root "%~dp0dist"

echo.
echo   服务已停止，按任意键关闭窗口。
pause >nul
