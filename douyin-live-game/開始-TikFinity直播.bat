@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 彈幕攻城戰 - TikFinity

echo ==================================================
echo   彈幕攻城戰  x  TikFinity  x  TikTok LIVE Studio
echo ==================================================
echo.
echo  1. 開啟 TikFinity 桌面版，登入並連上你的 TikTok 帳號
echo  2. 在 TikTok LIVE Studio 新增「連結」來源，網址填：
echo        http://localhost:3000/
echo     解析度：寬 1080  高 1920
echo  3. 想先測試：用瀏覽器打開 http://localhost:3000/?sim=1
echo.
echo  直播期間請不要關閉這個視窗。
echo.

where node >nul 2>nul
if errorlevel 1 goto ps
node bridge\server.js
goto end

:ps
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" -Port 3000

:end
pause
