@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo 새 버전을 받아서 다시 올립니다.
git pull || goto :err
call npm install || goto :err
call npm --prefix client install || goto :err
call node tools\deploy.mjs || goto :err
pause
exit /b 0
:err
echo.
echo 오류가 났어요. 위에 나온 메시지를 캡처해서 보내 주세요.
pause
exit /b 1
