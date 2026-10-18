@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 彈幕攻城戰 - TikTok

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js，請先到 https://nodejs.org 下載安裝 LTS 版本，裝好後再雙擊這個檔案。
  pause
  exit /b
)

if not exist "node_modules\tiktok-live-connector" (
  echo 第一次使用，正在安裝需要的套件...
  call npm install
)

set "TT="
if exist tiktok-account.txt set /p TT=<tiktok-account.txt
if "%TT%"=="" (
  set /p TT=請輸入你的 TikTok 帳號（@ 後面那串，例如 abc123）：
)
set "TT=%TT:@=%"
>tiktok-account.txt echo %TT%

echo.
echo  遊戲網址（貼到 TikTok LIVE Studio 的「連結」來源）：
echo     http://localhost:3000/
echo  想先測試：用瀏覽器打開 http://localhost:3000/?sim=1
echo  要換帳號：刪掉 tiktok-account.txt 再重開
echo  開播後會自動連上直播間；這個視窗直播期間請不要關。
echo.
node bridge\server.js --tiktok %TT%
pause
