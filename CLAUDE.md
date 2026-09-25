# dor6-club — 도륙(Dor6) 클럽원 전용 정보 사이트

> 본 문서는 **② 기획자 단계** 산출물(기획서)입니다. 마스터 기획서를 구체 설계로 확장했습니다.
> 사용자 승인(**✅ 기획 완료**) 이후에만 ③ 개발 단계로 전환합니다.
> 형제 프로젝트 `uni-match`, `task-manager`와 동일 기술 계열(순수 HTML/CSS/JS + Node.js 스크립트 + GitHub Pages)로 통일합니다.

---

## 1. 프로젝트 개요

FC 온라인 카카오톡 오픈채팅 모임 **도륙(Dor6)** 의 클럽 개편에 맞춰, 클럽원 활동을 한눈에 보는 전용 정보 사이트.

- **핵심 목적**: 부클럽장이 수작업하던 **시즌 판수 체크 자동화**
- **부가 목적**: 클럽원 간 전적·성향 공유로 교류 활성화
- **대상**: 클럽원 약 50명 + 부클럽장 + 클럽장(관리자)
- **접속 환경**: 대부분 모바일 → **모바일 우선 반응형** (터치 타깃·세로 스크롤 최적화)
- **개인정보 원칙**: 게임 닉네임·전적 외 개인정보는 **일절 다루지 않음** (공개 사이트)

| 항목 | 값 |
|------|-----|
| 폴더 | `C:\Projects\dor6-club` |
| 배포 | `https://johnlee-korea.github.io/dor6-club` |
| 클럽 표시명 | 도륙 (영문 약어 Dor6) |

---

## 2. 기술 스택 및 배포

| 항목 | 결정 | 비고 |
|------|------|------|
| 프론트 | 순수 HTML / CSS / JavaScript | 프레임워크·빌드 없음 (형제 프로젝트 동일) |
| 백엔드 | 없음 | 정적 JSON 로딩만 |
| 데이터 수집 | Node.js 스크립트 | `scripts/` 하위 |
| 자동화 | GitHub Actions (cron) | 정기 실행 → JSON 커밋 |
| 외부 API | 넥슨 오픈 API (EA SPORTS FC 온라인) | `open.api.nexon.com` |
| API 키 | **GitHub Secrets** 저장 (`NEXON_API_KEY`) | 프론트/커밋에 **절대 노출 금지** |
| 저장소 | `/data` 폴더 JSON 커밋 | 누적 저장 |
| 관리자 백엔드 | **Cloudflare Workers** (무료) | 비밀번호 인증 → GitHub API로 `members.json` 커밋 |
| 배포 | GitHub Pages | 브랜치: `main` / 루트 또는 `/docs` |

**데이터 흐름**
```
GitHub Actions (cron)
  → collect.js (넥슨 API 호출: ouid → 신규 matchid → 매치 상세)
  → /data/matches/{ouid}.json 누적 갱신 (matchid 중복 제거)
  → aggregate.js (대시보드/성향/내전/명예의전당 집계 JSON 생성)
  → git commit & push
  → GitHub Pages가 정적 JSON을 화면에 표시
```

---

## 3. 폴더 구조

```
C:\Projects\dor6-club\
├── CLAUDE.md                  # 기획서 (본 문서)
├── README.md                  # ⑤ 기록자 단계에서 작성
├── .gitignore                 # .env, node_modules 등 제외
├── config.json                # 집계 대상 매치유형 등 운영 파라미터
│
├── index.html                 # 홈(대시보드 요약) — 진입점
├── members.html               # ① 클럽원 명단
├── dashboard.html             # ② 시즌 판수 대시보드
├── record.html                # ③ 클럽원 전적 (개별)
├── style.html                 # (v1.7.2 폐지) members.html로 리다이렉트만
├── internal.html              # ⑤ 클럽 내전 기록
├── tournament.html            # 토너먼트 진행기(1회성, 저장 없음 — 11장)
├── hall.html                  # ⑥ 명예의 전당
├── rules.html                 # ⑦ 규칙·공지
├── admin.html                 # 🔒 관리자 패널(로그인 후 클럽원 등록/삭제)
│
├── dor6.png                   # ★클럽 엠블럼 원본(사용자 제공 완료, 307x306 RGBA)
├── assets\
│   ├── favicon.png            # dor6.png 기반 파비콘(개발 단계 생성)
│   └── og.png                 # 공유 미리보기 이미지(dor6.png 기반)
│
├── css\
│   ├── tokens.css             # 디자인 토큰(색·간격·타이포 변수) — 다크/실버 테마
│   ├── style.css              # 레이아웃·헤더·네비·공통 컴포넌트
│   └── components.css         # 카드·진행바·배지·테이블·태그
│
├── js\
│   ├── common.js             # 공통 헤더/네비 주입, 유틸(fetch, 포맷)
│   ├── loader.js             # data/*.json 로딩 + 캐시
│   ├── members.js            # 명단 렌더 (부클럽장별 그룹)
│   ├── dashboard.js          # 판수 진행률·중간점검 미달·휴식 제외
│   ├── record.js             # 개별 전적·라인업 렌더
│   ├── internal.js           # 내전 추출·상대전적표
│   ├── tournament.js         # 토너먼트: 추첨·부전승·승자 진출 로직 + 대진표 렌더
│   ├── hall.js               # 명예의 전당 렌더
│   ├── auth.js               # 관리자 로그인 상태 관리(세션)
│   └── admin.js              # 관리자 패널: 등록/삭제, 닉→ouid 변환, Worker 호출
│
├── data\
│   ├── members.json          # ★수동 관리 (명단·역할·담당·휴식)
│   ├── seasons.json          # ★수동 관리 (시즌·중간점검·종료일)
│   ├── dashboard.json        # 자동 집계 (시즌별 판수)
│   ├── playstyles.json       # 자동 집계 (명단 플레이스타일, 랭커 대비)
│   ├── internal.json         # 자동 집계 (내전·상대전적)
│   ├── hall.json             # 자동 집계 (명예의 전당)
│   ├── insights.json         # 자동 집계 (v1.9.0 경기 상세 인사이트, 현재 시즌)
│   └── matches\
│       └── {ouid}.json       # 자동 수집 (회원별 매치 요약 누적)
│
├── scripts\
│   ├── collect.js            # 넥슨 API 수집 (신규 매치만 상세 조회·누적)
│   ├── aggregate.js          # matches → dashboard/stats/internal/hall 집계
│   ├── lib\
│   │   ├── nexon-api.js      # API 래퍼(호출 간격·재시도·에러 로그)
│   │   └── season.js         # 시즌 판정·비례 기준 계산 유틸
│   └── .env.example          # NEXON_API_KEY 예시 (실제 .env는 커밋 금지)
│
├── worker\
│   ├── src\index.js          # Cloudflare Worker: 인증 + GitHub API 커밋
│   ├── wrangler.toml         # Worker 배포 설정
│   └── README.md             # Worker 배포·시크릿 등록 가이드
│
└── .github\
    └── workflows\
        └── collect.yml       # cron 스케줄 → collect + aggregate + commit
```

> **설계 방침**: 7개 기능을 **다중 HTML 페이지**로 구성(모바일에서 페이지별 독립 로딩·유지보수 단순). 헤더/네비는 `common.js`가 주입해 중복 제거. 무거운 개별 매치 데이터(`matches/{ouid}.json`)는 해당 페이지에서 **필요할 때만** 로딩.

---

## 4. 데이터 설계

### 4-1. `members.json` (★관리자 수동 편집 또는 admin.html 패널에서 등록/삭제)
```jsonc
{
  "meta": { "updated": "2026-09-23" },
  "members": [
    {
      "ouid": "abcd1234...",        // 넥슨 ouid — 모든 수집/집계의 기준 키(닉 변경 대응)
      "ingameNick": "도륙사자",       // 인게임 닉네임(사이트 관리 기준)
      "talkNick": "철수",            // 톡방 '불릴이름'
      "role": "클럽원",              // 회장 | 클럽장 | 부클럽장 | 클럽원 (회장·클럽장 = 관리자)
      "manager": "abcd0000...",     // 담당 부클럽장 ouid (부클럽장/클럽장/회장은 null)
      "joinDate": "2026-01-05",     // 가입일(시즌 중 가입 시 비례 기준 계산)
      "isSub": false,               // 부계정 여부(직접 플레이 계정만 인정)
      "parentOuid": null,           // 부계정이면 본계정 ouid
      "restPeriods": [              // 휴식 신청 기간(판수 기준 제외)
        { "from": "2026-02-01", "to": "2026-02-14" }
      ]
    }
  ]
}
```

### 4-2. `seasons.json` (★관리자 수동 편집)
```jsonc
{
  "seasons": [
    {
      "id": "2026-h1",
      "name": "2026 상반기",
      "start": "2026-01-01",
      "midCheck": "2026-02-15",     // 상반기 종료 = 중간점검일
      "end": "2026-03-15",
      "targetGames": 50,            // 시즌 기준 판수
      "midTargetGames": 25          // 중간점검 기준 판수
    }
  ]
}
```

### 4-3. `config.json` (운영 파라미터)
```jsonc
{
  // 판수 집계 대상 매치유형 — [사용자 확정] 공식경기+공식친선+리그친선, 감독모드·볼타 제외
  // 30:리그친선 40:클래식1on1 50:공식경기 52:감독모드 60:공식친선 / 204·214·224·234:볼타
  "countedMatchTypes": [50, 60, 30],
  "collectMatchTypes": [50, 60, 30],       // 수집 대상(집계·성향분석 동일 범위)
  "matchListLimit": 100,                   // 매치목록 1회 조회 개수(개발 착수 시 상한 확정)
  "apiCallIntervalMs": 250                 // 호출 간격(개발 착수 시 제한 확정 후 조정)
}
```

### 4-4. `data/matches/{ouid}.json` (자동 수집·누적)
```jsonc
{
  "ouid": "abcd1234...",
  "updated": "2026-09-23T04:00:00Z",
  "knownMatchIds": ["m1","m2"],   // 중복 제거용(신규 matchid만 상세 조회)
  "matches": [
    {
      "matchId": "m1",
      "matchType": 50,
      "matchDate": "2026-01-10T21:00:00Z",
      "result": "win",             // win | draw | lose
      "goalFor": 3, "goalAgainst": 1,
      "opponentOuid": "xxxx",      // 상대 ouid(내전 판정용)
      "opponentNick": "상대닉",
      "stats": {                   // 저장소 절약: 요약 값만
        "possession": 55,
        "shootTotal": 12, "effectiveShoot": 6,
        "passTry": 320, "passSuccess": 285,
        "tackle": 8, "foul": 3, "corner": 4
      },
      "lineup": [                  // 최근 경기 라인업(출전 선수)
        { "spId": 300012345, "spPosition": 27, "spGrade": 8 }
      ]
    }
  ]
}
```
> `spId`(선수 고유 id)·`spPosition`·`spGrade`는 넥슨 메타데이터로 이름/포지션 변환. 선수 이미지는 개발자센터 정책 범위 내에서만 사용.

### 4-5. 자동 집계 산출물
- **`dashboard.json`**: `{ seasonId, rows:[{ouid, playedGames, target, mid, restDays, prorated, status}] }` — 진행률·중간점검 미달·휴식 제외·비례 기준 반영.
- ~~`stats.json`~~: v1.7.2에서 폐지(플레이스타일 탭 제거, 명단 `playstyles.json`으로 대체).
- **`internal.json`**: 양측 모두 클럽원(ouid ∈ members)인 매치만 추출 → `{ matches:[...], headToHead:{ "ouidA|ouidB": {aWin,bWin,draw} } }`.
- **`hall.json`**: 시즌별 최다 판수/최다 승/최고 승률 등 자동 선정.
- **`squads.json`**: `{ [ouid]: { matchId, matchDate, matchType, result, goalFor, goalAgainst, opponentNick, lineup } }` — 회원별 최근 수집 경기 라인업 원본(넥슨은 현재 스쿼드 미제공). 선수 카드·포메이션 변환은 화면 `js/squad.js`(sqBuildTeam·sqFormation) 한 곳에서 처리. 선수/시즌 메타는 `data/meta/players.json`·`seasonid.json`(수집된 모든 경기 양팀 선수만 추림).
- **`internal.json` 매치의 `aLineup`/`bLineup`**: 내전 당시 양팀 스쿼드(A 기록의 lineup/oppLineup). 내전 페이지 행 탭 → 양팀 스쿼드 모달.
- **전적 검색 캐시**: 검색 결과는 브라우저 localStorage(`dor6.search.<닉 소문자>`)에 저장, [최신 업데이트]로만 Worker 재조회. 검색 유저는 cron 수집 대상 아님. 클럽 밖 선수 이름은 `data/meta/pnames.json`(pid→이름, collect.js가 매 실행 갱신)에서 필요 시 로딩.
- **`playstyles.json`** (v1.7.0): `{ baselineUpdated, baselineSource, recentGames, minGames, players:{ [ouid]: { games, style:{name,line,conds}, highs:[{k,label,unit,v,avg,z}×3], lows:[…×3] } } }`. 최근 인정 경기 `config.playstyle.recentGames`판(정상 종료만)의 지표를 `data/meta/ranker-baseline.json`(지표별 mean·sd)과 Z점수 비교. 판정 규칙·스타일·지표 정의(desc 포함)는 `scripts/lib/playstyle.js` 단일 소스. v1.7.1부터 스타일은 **표시된 ▲3·▼3 칩 안에서만** 판정: `COMBO_STYLES`(두 조건 모두 칩에 있을 때, 편차 합 최대) → 없으면 `SINGLE_STYLES`(지표×방향 50종, 최대 편차 칩) → 최대 편차 0.5σ 미만이면 '무난함의 정석'. 근거 칩은 `key:true`(화면 ★). `minGames` 미만 회원은 `{games}`만 → 화면에 '분석 대기'.
- **랭커 기준값** `data/meta/ranker-baseline.json`: `scripts/ranker-baseline.js`가 FC온라인 데이터센터 랭킹 HTML(`rank_inner?rt=manager&n4pageno=`)에서 닉 샘플 → 넥슨 API로 공식경기 상세 조회 → 지표별 평균·표준편차. `config.rankerBaseline.refreshDays`(7일) 이내면 건너뜀, 유효 표본 20명 미만이면 기존 값 유지. 랭킹 페이지 구조가 바뀌면 이 스크립트의 정규식만 수정.
- **`matches/{ouid}.json`의 `styleRaw`**: 플레이스타일용 경기별 원본 카운트(짧은 키, `lib/playstyle.js` styleRaw 참고). 도입 이전 경기는 oppLineup과 같은 백필 루틴에서 채움(4xx면 null).
- **`matches/{ouid}.json`의 `oppLineup`**: 상대 라인업(형식은 `lineup`과 동일). 전적 페이지 '양팀 스쿼드' 모달에 사용. 도입 이전 매치는 collect.js가 회당 `config.detailBackfillPerRun`건씩 백필(넥슨 4xx 응답 시 빈 배열로 표시).

---

## 5. 기능 명세 (1차)

| # | 페이지 | 핵심 내용 | 데이터 소스 |
|---|--------|-----------|-------------|
| 홈 | index.html | 클럽 로고, 이번 시즌 요약(전체 달성률·중간점검 임박 알림), 각 페이지 진입 | dashboard.json |
| ① | members.html | 인게임닉·최고등급·역할(운영진+클럽원 평면), **🎭 플레이스타일**(랭커 대비 ▲▼ 지표·한 줄 스타일), **[스쿼드] 최근 경기 포메이션 모달** | members.json, profiles.json, squads.json, playstyles.json |
| ② | dashboard.html | 클럽원별 현재판수/기준판수 **진행률 바**, 상반기 중간점검 **미달자 표시**, **휴식자 제외**, 부클럽장별 담당 인원 현황 | dashboard.json |
| ③ | record.html | 회원 선택 → 최근 경기 목록(승/무/패·스코어·상대), 탭하면 **양팀 스쿼드 모달** | matches/{ouid}.json, meta/* |
| ④ | ~~style.html~~ | **v1.7.2 폐지** — 명단 플레이스타일로 통합, 기존 주소는 members.html로 리다이렉트 | - |
| ⑤ | internal.html | 클럽원끼리 경기만 추출, **클럽원 간 상대 전적표** | internal.json |
| ⑥ | hall.html | 시즌별 최다판수·최다승·최고승률 **자동 선정** | hall.json |
| ⑦ | rules.html | 클럽 운영 수칙·개편 공지(정적 콘텐츠) | (하드코딩/rules.json) |

### 판수·기준 계산 규칙 (사이트 반영)
- 시즌당 **50판 이상**(매치 유형 무관 → `config.countedMatchTypes` 기준 집계).
- 상반기 종료 시 **25판** 중간점검.
- **시즌 중 가입자**: 남은 기간 비례 적용(예: 하반기 가입 → 25판). `joinDate` vs 시즌 구간으로 자동 계산.
- **휴식 신청 기간**: 해당 일수만큼 기준 비례 차감(또는 제외 표시).
- 부계정도 동일 조건, **직접 플레이 계정만 인정**(`isSub`/`parentOuid`로 구분).
- **닉네임이 아닌 `ouid` 기준** 관리(닉 변경 대응). 화면에는 인게임 닉 + 톡방 닉 병기.

---

## 6. 넥슨 API 사용 설계

| 용도 | 엔드포인트(개발 착수 시 최종 확인) | 비고 |
|------|-----------------------------------|------|
| 닉→ouid | `/fconline/v1/id?nickname=` | 최초 등록 시 1회, 이후 ouid 고정 |
| 기본정보 | `/fconline/v1/user/basic?ouid=` | 닉·레벨 |
| 최고등급 | `/fconline/v1/user/maxdivision?ouid=` | 최고 등급 표시용 |
| 매치목록 | `/fconline/v1/user/match?ouid=&matchtype=&offset=&limit=` | 신규 matchid만 필터 |
| 매치상세 | `/fconline/v1/match-detail?matchid=` | 요약 값만 저장 |
| 메타데이터 | `/static/fconline/meta/*.json` (matchtype, spid, spposition 등) | 정적 캐시 |

**매치 유형 코드(확인 완료)**: `30`리그친선 · `40`클래식1on1 · `50`공식경기 · `52`감독모드 · `60`공식친선 · `204/214/224/234`볼타
→ **[사용자 확정] 판수/수집 대상 = 공식경기(50) + 공식친선(60) + 리그친선(30). 감독모드(52)·볼타 제외.**

**수집 원칙**
- 매치 데이터 보관주기가 짧으므로 **정기 수집으로 누적 저장 필수**(넥슨: 크롤링 데이터 30일 내 갱신 의무).
- `matchid` 기준 **중복 제거**, 신규 매치만 상세 조회.
- 매치 상세는 **필요한 요약 값만** 저장(저장소 용량 관리).
- 호출 간격 조절(`config.apiCallIntervalMs`)·재시도·에러 로깅. **정확한 초당 제한/목록 최대 개수는 개발자센터 문서로 최종 확정 후 반영**.
- API 키는 GitHub Secrets(`NEXON_API_KEY`)에서만 주입, 프론트·커밋에 노출 금지.

**수집 주기 [사용자 확정]**: **2시간마다** 실행 (UTC 짝수시 05분, 하루 12회). 매치 보관 30일 대비 충분한 신선도 확보. 개발자센터 초당 호출 제한 확인 후 회당 호출 간격(`apiCallIntervalMs`)만 미세 조정.
> 2026-09-25 변경: GitHub Actions 자체 schedule이 하루 4회 수준으로 누락돼, **Cloudflare Worker Cron Trigger**(`5 */2 * * *`)가 GitHub API `workflow_dispatch`로 collect.yml을 호출하도록 전환. GitHub schedule(`47 */6 * * *`)은 예비용. Worker의 `GH_TOKEN`에 **Actions: Read and write** 권한 필요(토큰 만료·권한 누락 시 정시 수집 중단 → 예비 스케줄만 동작).

---

## 6-A. 관리자 기능 & 인증 설계 (1차 포함, 사용자 확정)

정적 사이트(GitHub Pages)는 서버가 없어 웹에서의 데이터 쓰기를 직접 할 수 없다. 따라서 **Cloudflare Workers**(무료)를 얇은 인증·쓰기 백엔드로 둔다.

**역할 체계**: `회장` > `클럽장` > `부클럽장` > `클럽원`
**관리자 권한(등록/삭제)**: 회장 · 클럽장 · 부클럽장 (사용자 확정)

**로그인·쓰기 흐름**
```
관리자가 admin.html 접속 → 비밀번호 입력
  → Worker /login: 비밀번호 검증(Worker 시크릿과 대조) → 서명 토큰(JWT류) 발급
  → 관리자 패널에서 클럽원 등록(닉네임 입력)/삭제
     · 등록 시 Worker /resolve: 닉네임 → 넥슨 API로 ouid 변환(키는 Worker 시크릿)
  → Worker /commit: 검증된 요청만 GitHub Contents API로 data/members.json 갱신 커밋
  → GitHub Pages 재빌드 → 사이트 반영
```

**보안 원칙**
- 넥슨 API 키·GitHub 토큰은 **Worker 시크릿에만** 저장(브라우저·저장소 노출 0).
- 프론트는 비밀번호만 다루고, 실제 쓰기 권한은 Worker가 검증 후 수행.
- 비로그인 사용자는 모든 조회 메뉴 사용 가능, 관리 메뉴(admin.html)만 잠금.
- 관리자 비밀번호는 Worker 시크릿(`ADMIN_PASSWORD`)로 관리, 코드/저장소에 평문 저장 금지.

**Worker 시크릿 (wrangler secret)**: `ADMIN_PASSWORD`, `NEXON_API_KEY`, `GH_TOKEN`(repo contents 쓰기 권한), `JWT_SECRET`
**Worker 엔드포인트**: `POST /login`, `POST /resolve`(닉→ouid), `POST /members`(등록/삭제 커밋) — 모두 CORS 허용(Pages 도메인 한정).

---

## 7. 디자인 방향

- 확정 엠블럼(`dor6.png`) 기반: **검은 방패 + 실버 메탈릭 사자·왕관 + "도륙/Dor6"**.
- **다크 테마 기본**(near-black 배경 → 엠블럼과 자연스럽게 융화), **실버/그레이 포인트**.
- 엠블럼을 헤더 로고·파비콘·OG 이미지로 사용.
- 모바일 우선: 큰 터치 타깃, 카드형 레이아웃, 하단/상단 고정 네비.
- 토큰 예시(`tokens.css`): `--bg:#0e0f11; --surface:#17191d; --silver:#c7ccd1; --accent:#9aa4ad; --text:#e8eaed; --danger:#e5534b(미달); --ok:#3fb950(달성)`.

---

## 8. 2차 기능 (1차 안정화 후)
- **아무 유저 전적 조회**: Cloudflare Workers 프록시로 API 키 보호(1차에서 만든 Worker 확장).
- **스쿼드메이커**: 선수 메타데이터 기반(시세 정보 제외).
> 참고: Cloudflare Worker는 원래 2차 예정이었으나, 관리자 CRUD 요구로 **1차에 선반영**. 2차 전적 조회는 동일 Worker에 라우트만 추가.

---

## 9. 개발 전 최종 확인 사항 (③ 개발 착수 시)
- [x] 판수 집계 대상 매치 유형 확정 — 공식경기(50)+공식친선(60)+리그친선(30), 감독모드·볼타 제외
- [x] 수집 주기 확정 — 2시간마다 cron (`0 */2 * * *`)
- [ ] 넥슨 개발자센터에서 **초당 호출 제한·매치목록 최대 개수** 최종 확인 → `config.json` 반영
- [ ] 매치 데이터 **정확한 보관 기간** 확인 → cron 주기 확정
- [ ] 클럽원 **초기 ouid 목록** 확보(닉 → ouid 1회 변환해 `members.json` 채움)
- [x] **엠블럼 이미지 파일** 확보(`dor6.png`) — 파비콘·OG는 개발 단계에서 생성

---

## 10. 5단계 파이프라인 규칙 (본 프로젝트 적용)

| 단계 | 역할 | 완료 선언 | 전환 |
|------|------|-----------|------|
| ① 마스터 | claude.ai 기획 논의 | (완료·전달됨) | → ② |
| ② 기획자 | 본 CLAUDE.md 작성 | **✅ 기획 완료** | 사용자 승인 후 → ③ |
| ③ 개발자 | 기획 순서대로 코드 작성 | ✅ 개발 완료 | 자동 → ④ |
| ④ 검수자 | 기획 기준 검수(기능·품질·누락) | ✅ 검수 완료 | 불합격 시 ③ 롤백, 합격 시 → ⑤ |
| ⑤ 기록자 | README·변경이력·배포정보 | ✅ 프로젝트 완료 | 종료 |

**개발 순서(③ 착수 시 제안)**
1. 프로젝트 뼈대 + `tokens.css`/공통 레이아웃/네비 주입
2. `members.json`/`seasons.json`/`config.json` 스키마 확정 + 샘플 데이터
3. `scripts/lib/nexon-api.js` → `collect.js`(수집) → 로컬 검증
4. `aggregate.js`(집계) → dashboard/stats/internal/hall JSON 생성
5. 화면: 명단 → 대시보드 → 전적 → 성향 → 내전 → 명예의전당 → 규칙
6. GitHub Actions `collect.yml`(cron) + Secrets 연동 + Pages 배포

**공통 규칙**: 한국어 주석 · 유지보수 우선 구조 · 설계 의도 문서화 · 사용자 친화 에러메시지 + 콘솔 상세 로그 · 커밋은 `[유형] 내용`(기능/수정/리팩토링/문서/스타일).

---

## 11. v1.8.0 클럽 토너먼트 기록기 (2026-09-24, 사용자 확정)

**목적**: 클럽 토너먼트를 현장에서 한 번에 진행하는 **1회성 도구**. 저장·서버·로그인 없음(브라우저 메모리에서만 동작).

**흐름 [사용자 확정]**: 명단 등록 → 🎲 추첨 → 대진표 발표 → 이긴 사람 클릭 → 다음 라운드 자동 진출 → 🏆 우승
- 명단: 클럽원(members.json) 선택 + 비클럽원 닉 직접 추가, 대회명 입력
- 추첨: 랜덤 셔플, 대진 크기 = 인원 이상 최소 2의 제곱수. 부전승(크기−인원)은 1라운드에 고르게 분산(부전승끼리 붙지 않음) → 자동 진출
- 대진표: 라운드별 칼럼(모바일 가로 스크롤), 1라운드 대진 순차 공개 애니메이션
- 승자 클릭: 다음 라운드 칸 자동 채움. 승자를 바꾸면 이후 라운드의 해당 선수 기록은 자동 초기화
- 다시 추첨: 부전승 외 첫 승자 입력 전까지만 가능
- 우승: 🏆 우승·🥈 준우승 카드, [같은 명단으로 새 대회]
- 스코어·경기 방식 입력 없음, 새로고침/닫기 시 진행 중이면 경고(beforeunload)

**파일**: `tournament.html`, `js/tournament.js`(상태·추첨·진출 로직 + 렌더), `css/components.css`(.tn-*). 네비 '토너먼트'·홈 바로가기 추가.

---

## 12. v1.9.0 경기 상세 인사이트 (2026-09-25 기획·사용자 승인)

**목적**: 넥슨 매치 상세에 이미 들어 있지만 버리던 값(선수별 기록·슈팅 상세·컨트롤러·카드)을 저장해 **API 호출 증가 없이** 개인 전적·명예의 전당을 풍성하게.

### 12-1. 추가 저장 필드 (`matches/{ouid}.json` 매치별, 짧은 키로 용량 절약)
```jsonc
{
  "ctrl": "keyboard",                 // matchDetail.controller (keyboard | gamepad | 기타)
  "cards": { "y": 1, "r": 0 },         // 옐로·레드 (파울은 기존 stats.foul)
  "pStats": [                          // 내 출전 선수별 기록 — 교체 벤치(spPosition 28) 미출전은 제외
    [spId, 골, 도움, 평점]              // 예: [250206534, 1, 0, 7.8]
  ],
  "shots": [                           // 내 슈팅 전부
    [초, x, y, 결과, 유형, spId, 도움spId|0]   // 킥오프 기준 경기 시각(초), x·y 소수 2자리, 결과 1유효·2빗나감·3골, 승부차기 제외
  ],
  "oppGoals": [699, 1210]              // 상대 골 시각(초) — 역전·실점 시간대 판정용 (같은 분 안의 순서까지 보존하려고 초 단위)
}
```
- **골 시각 변환**: 넥슨 `goalTime`은 초 단위 + 하프 오프셋(2^24 = 후반, 2^25 = 연장 전반, …) → `경기 시각(초) = 하프 시작(0/45/90/105분) + 하프 내 초`, 승부차기(2^26~)는 제외. 변환은 `scripts/lib/insight.js` 단일 소스.
- **용량**: 실측 data/matches 7.3MB → 9.9MB (1,553경기).
- **백필**: 기존 백필 루틴(`backfillOppLineups` → `backfillDetails`로 일반화)에서 새 필드가 없는 매치를 회당 `config.detailBackfillPerRun`건씩 채움. 최초 1회 로컬 전체 백필 완료(`node --env-file=.env scripts/collect.js --backfill-all`, 1,553건 모두 성공·골 시각 수 = 스코어 100% 일치).

### 12-2. 집계 (`aggregate.js` → 신규 `data/insights.json`)
집계 범위: **현재 시즌 · 인정 매치유형(50/60/30) · 정상 종료 경기**(플레이스타일과 동일 기준).
```jsonc
{
  "seasonId": "s5", "seasonStart", "seasonEnd", "countedTypes",   // 전적 슈팅맵이 같은 범위로 거르도록
  "players": { "[ouid]": {
    "ctrl": "keyboard",                               // 최근 20경기 최빈값
    "ace": [{ "spId", "games", "goals", "assists", "rating" }],   // 골+도움 상위 3명(동률 시 평점)
    "goalMins": { "for": [0-15,16-30,31-45,46-60,61-75,76-90,90+], "against": [...] },  // 7구간 득실
    "comebacks": 3,                                   // 역전승: 한 번이라도 뒤졌다가 승리
    "lateWinners": 2,                                 // 극장골: 80분 이후 골로 동점→리드 되며 그대로 승리
    "manner": { "games", "yellow", "red", "foul" }
  } },
  "clubTop": {                                        // 명예의 전당용 (시즌 전체 클럽원 합산)
    "topScorers":  [{ "ouid", "spId", "goals" }] ×5,  // 클럽 득점왕 선수 카드 (클럽원×선수 단위)
    "topAssists":  [...] ×5,
    "comebackKing": [...] ×3, "lateHero": [...] ×3,
    "gentleman": [...] ×3,    // 경기당 (카드×3 + 파울) 최저, minGames 이상
    "toughGuy":  [...] ×3     // 경기당 (카드×3 + 파울) 최고, minGames 이상
  }
}
```

### 12-3. 화면
| 페이지 | 추가 내용 |
|---|---|
| **record.html** (전적) | 선택한 클럽원 상단에 **인사이트 카드 3개**: ① ⚽ 에이스 선수 TOP3(선수 카드·골·도움·평점) ② ⏱ 골 시간대 막대(득점/실점 7구간) + 역전승·극장골 배지 ③ 🎯 **슈팅맵**(SVG 하프 코트, 골 ●·유효 ○·빗나감 ×, 필터 [전체/골만]) |
| **members.html** (명단) | 닉 옆 컨트롤러 아이콘 🎮 / ⌨️ |
| **hall.html** (명예의 전당) | 기존 3부문 아래 **⚽ 클럽 득점왕 선수 · 🅰️ 도움왕 선수 · 🔄 역전의 명수 · 🎭 극장골 제조기 · 😇 신사상 · 💪 터프가이상** |

- 슈팅맵 좌표: 넥슨 x(0 자기 골문 → 1 상대 골문), y(0~1 좌우) → 공격 방향 하프 코트(x ≥ 0.5)만 그림. 모바일 폭에 맞춰 SVG viewBox 스케일.
- 선수 이름·카드는 기존 `js/squad.js` 메타 변환 재사용.
- 새 필드 없는 옛 데이터·`minGames` 미만은 "데이터 모으는 중" 표시.

### 12-4. 개발 순서
1. `scripts/lib/insight.js`(골 시각 변환·pStats/shots 추출·역전/극장골 판정) + collect.js 저장 + 백필 일반화
2. 로컬 전체 백필 → 커밋
3. aggregate.js `buildInsights()` → `insights.json`
4. 화면: 전적 인사이트 카드 → 명단 아이콘 → 명예의 전당 6부문
5. `npm test` 스모크 테스트에 insights 렌더 추가, README 변경 이력

---

## 13. v1.10.0 포지션 스페셜리스트 에이스 (2026-09-25 기획·사용자 승인 — 명예의 전당 스페셜리스트 포함)

**배경(사용자 피드백)**: v1.9.0 에이스(골+도움 순)는 공격수만 나옴 → **같은 포지션 랭커 평균 대비 특정 지표가 눈에 띄게 높은 선수**를 에이스로 뽑고 칭호 부여. 예) 내 CDM 마이콘의 가로채기가 랭커 CDM 평균보다 월등 → "🧹 진공청소기".

### 13-1. 포지션 그룹 (spposition → 8그룹)
| 그룹 | 포지션 코드 | 화면 표기 |
|---|---|---|
| GK | 0 | 골키퍼 |
| CB | 1 SW · 4 RCB · 5 CB · 6 LCB | 센터백 |
| FB | 2 RWB · 3 RB · 7 LB · 8 LWB | 풀백 |
| DM | 9 RDM · 10 CDM · 11 LDM | 수비형 미드필더 |
| CM | 13 RCM · 14 CM · 15 LCM | 중앙 미드필더 |
| W  | 12 RM · 16 LM · 23 RW · 27 LW | 측면 |
| AM | 17 RAM · 18 CAM · 19 LAM | 공격형 미드필더 |
| ST | 20 RF · 21 CF · 22 LF · 24 RS · 25 ST · 26 LS | 스트라이커 |
교체(28 SUB)는 출전 시간 불명 → 선발 출전만 집계(랭커·클럽원 동일).

### 13-2. 비교 지표 (선수 1경기 status 기준, 경기당)
| 키 | 지표 | 넥슨 status | 비고 |
|---|---|---|---|
| int | 가로채기·태클 | intercept | 넥슨 tackle 값이 intercept와 동일(실측) → 하나로 |
| win | 볼 획득 | ballPossesionSuccess | |
| blk | 슈팅 블록 | block | |
| air | 공중볼 경합 성공 | aerialSuccess | |
| pas | 패스 성공 | passSuccess | |
| drb | 드리블 성공 | dribbleSuccess | |
| sht | 슈팅 | shoot | |
| gol | 골 | goal | |
| ast | 도움 | assist | |
| sav | 선방 | defending | GK만 의미 있음 |
| rt  | 평점 | spRating | |
- 해당 그룹 랭커 평균이 **경기당 0.3 미만인 지표는 제외**(예: 측면 블록 — 1~2개로 수치가 튀는 노이즈 방지). GK는 선방·평점·패스만.

### 13-3. 랭커 포지션 기준값 (`ranker-baseline.js` 확장, API 호출 추가 없음)
- 이미 조회하는 랭커 공식경기 상세에서 **랭커 본인 팀 선발 선수** status를 (랭커, spId, 그룹) 단위로 평균 → 5경기 이상인 선수 단위의 **평균·표준편차**를 그룹×지표별로 저장.
  (경기 단위가 아니라 '선수 단위 평균'의 분포와 비교해야 여러 경기 평균인 클럽원 값과 공정)
- 산출: `data/meta/ranker-baseline.json`에 `positions: { CB: { n, int:{mean,sd}, … }, … }` 추가. 주 1회 갱신 주기 동일, 도입 시 `--force` 1회.

### 13-4. 클럽원 저장·판정
- `pStats` 확장: `[spId, pos, gol, ast, rt, sht, pas, drb, int, win, blk, air, sav]` (키 순서는 `lib/insight.js` P_KEYS 단일 소스). 기존 1,557경기 재백필(로컬 1회).
- 현재 시즌 · 인정 매치 · 정상 종료 경기에서 (spId, 그룹)별 경기당 평균 → 그룹 기준값과 **Z점수**.
- 자격: 해당 (선수, 그룹) 선발 **5경기 이상**.
- **에이스 3명** = 선수별 최고 Z 지표 기준 상위 3명(같은 선수 중복 없음). **Z ≥ 1.0**이면 칭호 부여, 미만이면 칭호 없이 '가장 돋보인 지표'만 표시.

### 13-5. 칭호 (지표 × 포지션)
| 지표 | 칭호 |
|---|---|
| 가로채기·태클 | DM·CM **🧹 진공청소기** · CB **🚧 길목 차단기** · 그 외 **🦅 볼 사냥꾼** |
| 볼 획득 | **🥷 볼 탈취왕** |
| 슈팅 블록 | **🧱 통곡의 벽** |
| 공중볼 | CB **✈️ 제공권의 지배자** · ST **🗼 타깃맨** · 그 외 **🙆 헤더 장인** |
| 패스 성공 | DM·CM **🎼 중원의 지휘자** · CB·FB **⚙️ 빌드업 엔진** · 그 외 **📨 패스 마스터** |
| 드리블 성공 | W·FB **🏃 측면 돌파왕** · 그 외 **🪄 드리블 마법사** |
| 도움 | **🎯 킬패스 장인** |
| 골 | ST·AM·W **🔫 골 사냥꾼** · CB·FB **💥 골 넣는 수비수** · DM·CM **🚀 골 넣는 미드필더** |
| 슈팅 | **🏹 슈팅 머신** |
| 선방 | GK **🧤 수호신** |
| 평점 | **⭐ 믿을맨** |
칭호 표는 `lib/insight.js` TITLES 단일 소스(문구 수정은 한 곳).

### 13-6. 화면
- **전적 · 에이스 카드** 교체: `1 🧹 진공청소기 [마이콘 칩] CDM · 가로채기 2.8/경기 · 랭커 수비형 미드필더 평균 1.2 (2.3배) · 14경기`
- 카드 하단 안내: "같은 포지션 랭커 평균 대비 가장 돋보이는 지표 기준 (랭커 N명 표본)"
- **명예의 전당 🏅 포지션 스페셜리스트**(승인): 클럽 전체에서 Z 상위 5명(클럽원·선수·칭호)
- 기존 명예의 전당 득점왕·도움왕 선수는 유지.
