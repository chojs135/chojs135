@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo.
echo [1/3] 필요한 프로그램을 설치합니다. (몇 분 걸려요)
call npm ci || goto :err
call npm --prefix client ci || goto :err
echo.
echo [2/3] 구글 로그인: 브라우저가 열리면 가계부 시트가 있는 구글 계정으로 로그인하고 [허용]을 눌러 주세요.
call npx clasp login || goto :err
echo.
echo [3/3] 구글 시트에 가계부를 올립니다.
call node tools\deploy.mjs || goto :err
pause
exit /b 0
:err
echo.
echo 오류가 났어요. 위에 나온 메시지를 캡처해서 보내 주세요.
pause
exit /b 1
