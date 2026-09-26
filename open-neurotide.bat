@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   NeuroTide 本地启动器
echo   ----------------------------------------
echo   本窗口是本地静态服务器（仅服务本机，
echo   不会上传任何数据）。关闭窗口即停止。
echo.

if not exist "dist\index.html" (
  echo   首次运行，正在构建产物...
  call npm run build
  echo.
)

echo   正在启动并打开浏览器...
call npm run preview -- --port 4173 --strictPort --open

echo.
echo   服务已停止，按任意键关闭窗口。
pause >nul