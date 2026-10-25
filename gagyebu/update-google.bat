@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo 새 버전을 받아서 다시 올립니다.
rem npm이 고쳐 둔 잠금 파일 때문에 git pull이 멈추지 않게 먼저 되돌린다.
git checkout -- package-lock.json client/package-lock.json 2> nul
git pull || goto :err
call npm ci || goto :err
call npm --prefix client ci || goto :err
call node tools\deploy.mjs || goto :err
pause
exit /b 0
:err
echo.
echo 오류가 났어요. 위에 나온 메시지를 캡처해서 보내 주세요.
pause
exit /b 1
