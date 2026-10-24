# 집 PC에 설치하기 (Windows)

집 PC 한 대가 **서버**가 되고, 남편·아내의 휴대폰, 학교 컴퓨터, 노트북은 모두 **웹 브라우저로 접속**합니다.
데이터는 집 PC 한 곳에만 저장되므로 어느 기기에서 보든 같은 내용이 보입니다. 다른 기기에는 아무것도 설치하지 않아요.

```
 남편 휴대폰 ─┐
 남편 학교 PC ─┤                     ┌─ 집 PC ──────────────────┐
 아내 휴대폰 ─┼── https://주소 ──▶ │ 가계부 서버 + DB(SQLite)  │──▶ 구글 시트(자동 사본)
 아내 노트북 ─┘   (Tailscale)       │ 매일 DB 백업              │
                                     └──────────────────────────┘
```

> 집 PC가 꺼져 있거나 절전 상태면 접속이 안 됩니다. 4단계의 절전 해제를 꼭 해 주세요.

## 1. 프로그램 설치 (처음 한 번)

1. **Node.js LTS** 설치: <https://nodejs.org> → LTS 버전 다운로드 → 기본값으로 설치
2. **Git** 설치: <https://git-scm.com/download/win> → 기본값으로 설치
3. 명령 프롬프트(cmd)를 열고 원하는 위치에 코드 받기
   ```bat
   cd %USERPROFILE%
   git clone https://github.com/chojs135/chojs135.git
   cd chojs135
   git checkout claude/cool-cori-9u2yld
   cd gagyebu
   copy .env.example .env
   notepad .env
   ```

## 2. `.env` 채우기

| 항목 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | <https://console.anthropic.com> → API Keys에서 발급한 키 |
| `JWT_SECRET` | 아무 긴 랜덤 문자열. PowerShell에서 `[guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()` 실행 결과를 붙여 넣으면 됨 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | 5단계에서 받은 키 파일 경로 (예: `C:\Users\나\gagyebu-key.json`) |
| `GOOGLE_SHEET_ID` | 이미 채워져 있음 ("우리집 가계부" 시트) |
| `BACKUP_DIR` | (추천) 구글 드라이브 데스크톱 폴더 안의 경로 (예: `G:\내 드라이브\가계부백업`) |

## 3. 실행하고 가계부 만들기

1. `gagyebu` 폴더의 **`start-windows.bat`** 더블클릭 (첫 실행은 설치·빌드 때문에 몇 분 걸림)
2. 브라우저에서 <http://localhost:3001> 접속
3. **새 가계부 만들기**로 첫 번째 사람 가입 → **설정** 탭에서 **초대코드** 확인
4. 배우자는 같은 주소(밖에서는 4단계의 주소)에서 **초대코드로 참여**로 가입

새 가계부는 서버에 처음 한 번만 만들 수 있어서, 주소가 외부에 알려져도 다른 사람이 가입해 API 요금을 쓸 수는 없습니다.

## 4. 밖에서도 접속하기 (Tailscale Funnel, 무료)

집 공유기 설정(포트포워딩) 없이 집 PC에 고정된 `https://` 주소를 붙여 줍니다. 설치는 **집 PC에만** 하면 됩니다.

1. <https://tailscale.com/download/windows> 설치 → 구글 계정으로 로그인
2. 관리 페이지 <https://login.tailscale.com/admin/dns> 에서 **HTTPS Certificates** 켜기
3. 관리자 권한 cmd에서:
   ```bat
   tailscale funnel --bg 3001
   ```
   처음 실행하면 Funnel을 허용하라는 링크가 나옵니다. 링크를 열어 허용한 뒤 다시 실행하세요.
4. 출력되는 `https://내PC이름.xxxx.ts.net` 주소가 우리 가계부 주소입니다.
   - 휴대폰: 주소 접속 → 공유 버튼 → **홈 화면에 추가**하면 앱처럼 쓸 수 있음
   - 학교 PC처럼 같이 쓰는 컴퓨터에서는 다 쓰고 **설정 → 로그아웃**

**PC 자동 실행과 절전 해제**
- `Win + R` → `shell:startup` → 열린 폴더에 `start-windows.bat`의 바로가기를 넣기
- 설정 → 시스템 → 전원 → **절전 모드: 안 함**
- Tailscale은 설치 시 자동 시작되고, `--bg`로 켠 Funnel 설정도 재부팅 후 유지됩니다.

## 5. 구글 시트 연동

"우리집 가계부" 시트는 이미 만들어 두었습니다. 앱이 이 시트에 쓰려면 "서비스 계정"이 필요합니다.

1. <https://console.cloud.google.com> → 새 프로젝트 만들기 (이름: gagyebu)
2. **API 및 서비스 → 라이브러리** → "Google Sheets API" 검색 → **사용**
3. **IAM 및 관리자 → 서비스 계정 → 서비스 계정 만들기** (이름: gagyebu) → 완료
4. 만든 서비스 계정 클릭 → **키 → 키 추가 → 새 키 만들기 → JSON** → 파일 저장
5. `.env`의 `GOOGLE_SERVICE_ACCOUNT_KEY`에 그 파일 경로 입력 → 서버 다시 시작
6. 구글 시트 "우리집 가계부" → **공유** → 서비스 계정 이메일(`gagyebu@...iam.gserviceaccount.com`)을 **편집자**로 추가
7. 앱 **설정 → 구글 스프레드시트 연동 → 지금 동기화**

## 업데이트

새 기능이 추가되면 서버 창을 닫고 `update-windows.bat` → `start-windows.bat` 순서로 실행합니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 밖에서 접속이 안 됨 | 집 PC가 켜져 있는지, 서버 창이 열려 있는지, `tailscale funnel status` |
| 로그인 직후 다시 로그인 화면 | 주소를 `http://` 대신 `https://...ts.net`으로 접속했는지 |
| AI 분석 실패 | `.env`의 `ANTHROPIC_API_KEY`, 콘솔의 결제 수단/잔액 |
| PC가 고장 남 | `BACKUP_DIR`의 최신 `gagyebu-날짜.db`를 새 PC의 `server\data\gagyebu.db`로 복사 |
