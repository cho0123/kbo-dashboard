@echo off
chcp 65001 >nul
title 로컬 다운로드 서버
cd /d "%~dp0"

echo ========================================
echo   로컬 다운로드 서버 (포트 3838)
echo ========================================
echo.
echo  브라우저에서 대시보드 Shorts3 패널의
echo  "로컬 다운로드"를 사용할 수 있습니다.
echo.
echo  서버를 끄려면 이 창을 닫으세요.
echo ========================================
echo.

node local-server.js
if errorlevel 1 (
  echo.
  echo [오류] node 실행에 실패했습니다. Node.js 설치 여부를 확인하세요.
  pause
)
