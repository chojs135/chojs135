@echo off
chcp 65001 > nul
rem 새 버전 코드 받아서 다시 빌드. 실행 후 서버 창을 닫고 start-windows.bat 을 다시 실행.
cd /d "%~dp0"
git pull
call npm run install:all
call npm run build
echo 업데이트 완료. 서버를 다시 시작해 주세요.
pause
