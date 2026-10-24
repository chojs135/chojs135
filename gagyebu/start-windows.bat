@echo off
chcp 65001 > nul
rem 우리집 가계부 서버 실행 (집 PC용). 시작 프로그램에 바로가기를 넣어 두면 PC를 켤 때 자동 실행된다.
cd /d "%~dp0"
if not exist server\node_modules call npm run install:all
if not exist client\dist call npm run build
call npm start
