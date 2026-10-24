# 💰 우리집 가계부

부부가 함께 쓰는 웹 가계부. 은행·카드 내역서(PDF/엑셀/CSV), 영수증 사진, 아파트 관리비 고지서 스크린샷을
올리면 AI(Claude)가 거래를 뽑아 **지출/수입/이체**와 **카테고리·세부항목**으로 분류해 준다.

- 기존 앱 분석과 설계 이유: [docs/ANALYSIS.md](docs/ANALYSIS.md)

## 구성

| 영역 | 기술 | 위치 |
|---|---|---|
| 프론트엔드 | React + Vite + TypeScript, Recharts | `client/` |
| 백엔드 | Node.js + Express (tsx로 TypeScript 실행) | `server/` |
| 데이터베이스 | SQLite (`server/data/gagyebu.db`) | 원본 데이터 |
| AI 분석 | Claude API (`claude-opus-5-5`, 구조화 출력) | `server/src/ai.ts` |
| 구글 시트 | Google Sheets API (서비스 계정) | 보기/백업용 사본, 자동 동기화 |

구글 시트를 **원본 DB로 쓰지 않은 이유**: 동시 수정 충돌, 느린 속도, API 호출 제한 때문.
대신 SQLite를 원본으로 두고 내역이 바뀔 때마다 시트 전체를 다시 써서, 시트에서는 언제나 최신 내역을
보고 필터·피벗을 자유롭게 할 수 있게 했다.

## 실행

```bash
cd gagyebu
npm run install:all
cp .env.example .env      # ANTHROPIC_API_KEY, JWT_SECRET 채우기

# 개발 모드 (터미널 2개)
npm run dev:server        # http://localhost:3001
npm run dev:client        # http://localhost:5173  ← 여기로 접속

# 배포 모드 (서버 하나가 화면까지 같이 제공)
npm run build && npm start   # http://localhost:3001
```

1. 첫 사람이 **새 가계부 만들기**로 가입
2. 설정 화면의 **초대코드**를 배우자에게 전달 → 배우자는 **초대코드로 참여**로 가입
3. **올리기** 탭에서 파일 업로드 → 검토 → 저장

## 구글 시트 연동 (선택)

1. [Google Cloud Console](https://console.cloud.google.com)에서 프로젝트 생성 → **Google Sheets API** 사용 설정
2. IAM → 서비스 계정 생성 → 키(JSON) 다운로드
3. `.env`에 `GOOGLE_SERVICE_ACCOUNT_KEY=/경로/service-account.json` 설정 후 서버 재시작
4. 구글 시트를 하나 만들고, 서비스 계정 이메일(`...@...iam.gserviceaccount.com`)을 **편집자**로 공유
5. 앱 **설정 → 구글 스프레드시트 연동**에 시트 주소 붙여 넣기 → **지금 동기화**

이후엔 내역이 바뀔 때마다 `거래내역`, `월별요약` 탭이 자동으로 갱신된다.

## 배포

SQLite 파일이 남아 있어야 하므로 **디스크가 유지되는 곳**에 배포한다.
(예: Fly.io + volume, Railway + volume, 집의 NAS/미니PC, 작은 VPS)
`DATA_DIR`을 영구 디스크 경로로 지정하고, HTTPS 뒤에서 `npm start`로 실행하면 된다.

## 주요 기능

- AI 업로드 분석: PDF · JPG/PNG/WEBP · XLSX · CSV(EUC-KR 자동 인식), 여러 파일 한 번에
- 검토 화면: 항목별 수정/제외, 중복 의심·확인 필요·규칙 적용 배지
- 분류 학습: 분류를 고치면 가맹점 규칙으로 저장 → 다음 업로드부터 우선 적용
- 카드대금·적금·내 계좌 이체는 `이체`로 분리해 지출 이중 집계 방지
- 대시보드: 수입/지출/남은 돈/저축률, 전월 대비, 카테고리별 지출과 예산, 12개월 추이, 일별 지출,
  많이 쓴 곳, 사람별 합계, 세부항목별 합계, 이상 지출 체크포인트
- 내역: 월별 목록, 검색·필터, 직접 입력/수정/삭제, CSV 내보내기
- 설정: 초대코드, 월 예산, 카테고리·세부항목 편집, 자동 분류 규칙 관리, 구글 시트 연동
