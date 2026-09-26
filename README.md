# 도륙 · Dor6 클럽원 전용 정보 사이트

FC 온라인 클럽 **도륙(Dor6)** 클럽원 전용 정보 사이트.
넥슨 오픈 API로 매치를 자동 수집해 **시즌 판수 체크를 자동화**하고, 전적·성향·내전·명예의전당을 공유합니다.

- 배포: https://johnlee-korea.github.io/dor6-club
- 기술: 순수 HTML/CSS/JS · Node.js 수집 스크립트 · GitHub Actions(2시간마다) · Cloudflare Worker(관리자) · GitHub Pages
- 개인정보 원칙: 게임 닉네임·전적 외 개인정보 미수집

> 상세 설계는 [`CLAUDE.md`](./CLAUDE.md)(기획서) 참고.

---

## 주요 기능
| 페이지 | 내용 |
|--------|------|
| 홈 | 이번 시즌 요약(달성률·중간점검 미달) |
| 클럽원 | **검색 우선** — 닉네임 검색 · ⭐ 내 프로필 · 최근 본 프로필 · 전체 명단(접힘, 폼·연승/연패·스타일 한 줄) |
| 시즌 판수 | 진행률 바, 중간점검 미달자, 휴식 제외, 가입일 비례, 최근 7일 활동 · **📸 전체 판수 한 장 이미지**(30명 초과 2단) |
| 🩺 구단운영 (프로필 `#manage` 탭 · 전적 검색 `#manage` 탭) | 닉네임 검색 → **공식경기 · 친선 · 감독모드** 탭별 선수 진단(🟢 유지 · 🟡🟠 관찰 · 🔴 교체 고려 — 같은 카드 랭커 × 같은 포지션 랭커 비교), ⚽ 기대 득점(xG)·결정력·xA, 🛡 실점 루트(좌·중·우), 🔁 선발/빠진 경기 승률, 평점 추이. 결과는 브라우저 저장, [최신 업데이트] 시 새 경기만 조회 |
| 개인 프로필 (`member.html?id=`) | 탭 6개(구단운영 포함): 개요(전적·폼·🎭 플레이스타일) · 인사이트(⚽ 에이스·⏱ 골 시간대·🎯 슈팅맵) · 스쿼드 · 라이벌(😈 천적·🍖 먹잇감) · 경기 / 탭마다 **📸 이 탭 이미지로** |
| 클럽 내전 | 클럽원 간 상대 전적표 |
| 토너먼트 | 1회성 대회 진행기 — 명단 등록 → 🎲 추첨(부전승 자동) → 이긴 선수 클릭으로 진출 → 🏆 우승 (저장 없음) |
| 명예의 전당 | 시즌별 최다판수·최다승·최고승률 + 🏅 포지션 스페셜리스트, 클럽 득점왕·도움왕 선수, 역전의 명수, 극장골 제조기, 신사상, 터프가이상 |
| 규칙·공지 | 운영 수칙 |
| 📝 패치노트 | 날짜별 업데이트 이력 (홈 맨 아래 버튼) — `data/patchnotes.json` |
| 🔒 관리자 | 로그인 후 클럽원 등록/삭제 |

---

## 폴더 구조
```
dor6-club/
├── *.html              # 페이지 (index + 7기능 + admin)
├── css/                # tokens · style · components
├── js/                 # 페이지별 렌더 로직 + common(헤더/네비/유틸)
├── data/               # JSON (수동: members·seasons / 자동: dashboard·stats·internal·hall·matches·profiles)
├── scripts/            # collect(수집)·aggregate(집계)·lib · smoke-test
├── worker/             # Cloudflare Worker (관리자 백엔드)
├── .github/workflows/  # collect.yml (2시간마다 cron)
├── dor6.png            # 클럽 엠블럼
└── config.json         # 집계 대상 매치유형 등 운영 파라미터
```

---

## 운영 규칙 반영
- 판수 인정 매치: **공식경기(50) · 공식친선(60) · 리그친선(30)** — 감독모드·볼타 제외 (`config.json`)
- 시즌 50판 / 중간점검 25판, **가입일·휴식 비례 자동 계산**
- 모든 관리·집계는 **닉네임이 아닌 `ouid` 기준**(닉 변경 대응)

---

## 로컬 실행
```bash
# 1) .env 준비 (.env.example 복사 후 키 입력)
#    NEXON_API_KEY=발급받은_키

npm run collect     # 넥슨 API 수집 → data/matches/*.json, profiles.json
npm run baseline    # 랭커 기준값 → data/meta/ranker-baseline.json (7일 이내면 건너뜀, --force로 강제)
npm run aggregate   # 집계 → dashboard/stats/internal/hall/squads/playstyles.json
npm run build       # 수집 + 집계
npm test            # 페이지 렌더 스모크 테스트 (jsdom)

# 사이트 미리보기 (예)
npx serve .         # 또는 python -m http.server
```

---

## 배포 절차 (최초 1회)

### 1. GitHub 저장소 & Pages
1. `johnlee-korea/dor6-club` 저장소 생성 후 푸시
2. **Settings → Secrets and variables → Actions**: `NEXON_API_KEY` 등록
3. **Settings → Pages**: Source = `main` 브랜치 / 루트
4. **Actions** 탭에서 "매치 데이터 수집·집계" 워크플로 수동 1회 실행(또는 2시간 cron 대기)

### 2. 관리자 기능 (Cloudflare Worker)
[`worker/README.md`](./worker/README.md) 가이드대로 배포 후,
`js/common.js`의 `DOR6.workerUrl`에 Worker URL 입력.
> Worker 미배포 상태에서도 조회 기능은 모두 동작하며, 클럽원 관리는 `data/members.json` 직접 편집으로 가능.

---

## 자동화 흐름
```
Cloudflare Worker Cron (2시간마다, UTC 짝수시 05분) → workflow_dispatch
  (GitHub 자체 schedule은 6시간 예비용 — 누락이 잦아 정시 실행은 Worker 담당)
GitHub Actions
  → collect.js  (신규 matchid만 상세 조회·누적)
  → aggregate.js(집계 JSON 생성)
  → data/ 커밋(실행 중 다른 커밋이 있으면 rebase 후 재시도) → Pages 자동 반영

GitHub Actions baseline.yml (매주 월 03:20 KST, 수동 실행 가능)
  → ranker-baseline.js  (공식 1on1 랭커 · 감독모드 랭커 각 150명 × 15경기, 약 15~20분)
     → data/meta/ranker-baseline.json (모드별 포지션 기준값·플레이스타일) + xg-model.json (xG 표·실점 루트 평균)
  → aggregate.js → data/ 커밋
```

---

## 사이트 구성 (2영역)
- **클럽 탭**: 클럽원 전용 기능(명단·판수·전적·성향·내전·명예의전당·규칙)
- **일반 정보 탭**: 아무 닉네임이나 검색하는 **전적 검색** (Worker 프록시로 키 보호)

## 2차 로드맵
- 스쿼드메이커 (선수 메타데이터 기반)

---

## 배포 현황 / 인수인계

- **라이브**: https://johnlee-korea.github.io/dor6-club/
- **저장소**: `johnlee-korea/dor6-club` (GitHub Pages, main 브랜치)
- **넥슨 키**: 정식 `live_` 키 사용. **3곳 동기화 필요** — 로컬 `.env`(비커밋) · GitHub Secret `NEXON_API_KEY` · Worker Secret `NEXON_API_KEY`.
- **관리자 백엔드**: Cloudflare Worker (URL은 `js/common.js`의 `workerUrl` 참조). Secret: `NEXON_API_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`, `GH_TOKEN`(fine-grained PAT `dor6-club-worker`: 이 레포만 · Contents + Actions 읽기/쓰기 · 무기한 — 삭제·만료 시 관리자 등록과 정시 수집이 멈춤).
- **자동 수집**: Worker Cron(`worker/wrangler.toml`)이 2시간마다 `.github/workflows/collect.yml` 실행 → data 커밋 → Pages 반영. collect.yml 자체 schedule(6시간)은 예비용.

### 클럽원 (25명)
- 운영진: 곽철용(회장, *닉 색인 반영 대기 → collect.js 자동 등록*), 문선생(클럽장), 쌌따(부클럽장)
- 클럽원 22명. **담당(부클럽장별) 시스템은 사용 안 함** → 명단/판수는 운영진+클럽원 평면 표시.

### 운영 규칙(확정)
- 판수 인정 매치: 공식경기(50)+공식친선(60)+리그친선(30). **감독모드·볼타 제외.**
- 시즌 50판 / 중간점검(전반기 종료) 25판. 가입일·휴식 비례 자동.

### 남은 작업 (TODO)
1. **시즌 시작·종료 정확일** — `data/seasons.json` `s5`의 start/end는 추정값(중간점검 2026-10-01만 확정). 확인되면 수정.
2. **팀컬러 현황판** — 보류. 넥슨이 선수→구단 데이터 미제공. 대안으로 '회원별 스쿼드 보기'(v1.4.0) 먼저 반영. 선수→구단 매핑은 별도 데이터 필요.

## 변경 이력
- **v2.4.0** (2026-09-26): **구단운영을 프로필·검색 안으로** — 별도 메뉴라 닉네임을 두 번 검색해야 하던 불편(사용자 피드백). 클럽: 개인 프로필 6번째 탭 `#manage`(ouid로 조회 — Worker `/manage/overview`가 ouid도 받음), 일반 정보: 검색 결과 [📋 전적 | 🩺 구단운영] 탭(`#record`/`#manage`, 구단운영은 탭을 처음 열 때만 조회). 두 메뉴의 '구단운영' 제거, `manage.html`은 `search.html?q=…#manage`로 이동(예전 링크 호환). `js/manage.js`를 페이지 → 부품(`window.Dor6Manage.mount(container, {ouid|nickname})`, 준비 이벤트 `dor6-manage-ready`, mount 토큰으로 조회 중 탭 이동 시 화면 엉킴 방지). 모드 선택은 고정 탭 대신 칩. 프로필 탭 6개가 폭을 넘으면 선택 탭으로 가로 스크롤.
- **v2.3.0** (2026-09-26): **📸 탭별 캡처** — 개인 프로필 5탭·구단운영 모드 탭마다 [📸 이 탭 이미지로] → 보이는 탭 그대로(버튼·필터·접힌 설명·'참고' 선수 제외) 폭 960px 이미지. 프로필 헤더의 전용 카드(스타일+에이스)는 제거. `share.js shareSection()` 공용: html-to-image 캔버스 → **UPNG.js 256색 PNG**(pako, 실패 시 일반 PNG), 라이브러리 idle 미리 로딩, 프록시 이미지 data URL 메모리 캐시 + 탭을 보는 동안 idle 미리 받기, SVG(슈팅맵·평점 추이)는 계산된 스타일을 복제본에 인라인(안 하면 검게 나옴). 실측(Chrome, 새 프로필): 프로필 카드 247KB·첫 클릭 4.3s → 탭 25~110KB·0.2~1.1s, 판수 25명 337KB → 75KB, 구단운영 170KB.
- **v2.2.0** (2026-09-26): **🩺 구단운영** — 클럽·일반 정보 메뉴 모두에 `manage.html`. 닉네임 검색 → 공식경기(50)·친선(60+30 날짜순 병합)·감독모드(52) 탭별 선수 진단: 같은 카드·같은 포지션 넥슨 랭커 평균(`/fconline/v1/ranker-stats`, 친선은 넥슨 미제공이라 공식경기 값 대체) × 같은 포지션 그룹 랭커 분포를 포지션별 가중 Z로 비교, 표본 보정 n/(n+10), 선발 10경기 미만은 '참고'(접힘). xG(거리×각도×유형 실측 득점률 표, 모드별), 실점 루트(상대 공격 출발점 좌·중·우 xG 비중 vs 랭커, 20경기 이상일 때만 점검 안내), 선발/빠진 경기 비교, 평점 추이. Worker `/manage/overview·ids·details(30경기)·ranker` — 무료 한도 때문에 브라우저가 나눠 호출하고 계산은 브라우저(`scripts/lib/manage.js` 단일 소스를 ES 모듈로 직접 import). 브라우저 저장 모드별 최대 300경기(경기당 약 1.1KB). 실측: 감독모드 100경기 최초 분석 약 8초. **버그 수정**: 공식경기 랭커 기준값을 감독모드 랭킹(`rt=manager`)에서 뽑던 문제 → `rt=1vs1`(유효 랭커 85→150명, 플레이스타일·에이스 재집계). 기준값 생성은 `collect.yml`에서 분리한 주 1회 `baseline.yml`. 스모크 테스트에 구단운영(실데이터 40경기 픽스처 `scripts/fixtures/manage-rows.json`) 추가.
- **v2.1.0** (2026-09-26): **📝 패치노트 · 저작권 안내** — 홈 맨 아래 [📝 패치노트] 버튼 → `patchnotes.html`(날짜별, ✨새 기능·🔧개선·🐛수정, 데이터 `data/patchnotes.json` — 업데이트 시 여기에 항목 추가). 홈 하단 저작권 안내(무단 복제·배포·유사 사이트 제작 금지, 넥슨 데이터 권리 표기 "Data based on NEXON Open API"), 모든 페이지 푸터에 © 한 줄 + 패치노트 링크. 저장소에 `LICENSE`(All rights reserved, 사용 허락 없음) 추가.
- **v2.0.0** (2026-09-26): **클럽원 탭 개편 + 이미지 공유** — 사용자 피드백(한 사람 정보가 클럽원·전적 탭에 나뉨, 명단은 운영진 관점이라 클럽원은 자기 찾으려 스크롤) 반영. 클럽원 탭을 검색 우선(⭐ 내 프로필·최근 본 프로필·접힌 전체 명단)으로, 개인 프로필 `member.html?id=<ouid>#<탭>` 신설(개요·인사이트·스쿼드·라이벌·경기, 카톡 공유 링크·뒤로가기). **전적 탭 폐지**(`record.html`은 클럽원 탭으로 이동). **📸 프로필 공유 카드**(닉·등급·시즌 판수·폼·플레이스타일·에이스 3명 얼굴) · **📸 전체 판수 한 장**(판수 페이지, 30명 초과 2단) — `js/share.js`가 html-to-image(jsdelivr, 클릭 시 로딩)로 PNG 생성, 미리보기에서 [공유하기](모바일 공유 시트)·[이미지 저장]. 넥슨 이미지 서버 CORS 미허용 → Worker `/img` 프록시(넥슨 호스트 2곳만, CORS·24h 캐시). 공용 조각 정리: 골 시간대·슈팅맵 카드 → `insight-ui.js`, `sqSquadHtml`(squad.js), `myProfile`·`profileUrl`(common.js).
- **v1.13.0** (2026-09-25): **클래식 1on1(매치유형 40) 수집 + 🆚 내전 라이벌** — 클럽원끼리는 클래식으로 붙는다는 사용자 확인에 따라 `collectMatchTypes`에 40 추가(판수 `countedMatchTypes`에는 미포함 → 시즌 판수·플레이스타일·인사이트·폼 영향 없음). 내전 페이지가 자동으로 채워짐(로컬 검증 153경기·14쌍). 전적 페이지에 😈천적(승점률 50% 미만 최저)·🍖먹잇감(50% 초과 최고)·🔁자주 붙은 상대 — 클럽원끼리 3판 이상. 전적 요약·최근 15경기 점은 인정 매치만(클래식 목록엔 '클래식' 표시).
- **v1.12.1** (2026-09-25): 전적 탭 진입 시 첫 클럽원 자동 선택 제거(사용자 요청) → 빈 화면에 닉네임 검색창, 부분 일치 후보 선택 또는 Enter(첫 후보).
- **v1.12.0** (2026-09-25): **폼·연승 / 최근 7일 활동 / 명예의 전당 +4** — 명단에 최근 10경기 폼 점(●승 ○패 ◐무)과 🔥N연승·🧊N연패 배지(3 이상, 무승부는 끊김), 홈에 🔥지금 연승 중·🧊지금 연패 중·📅최근 7일 활동 TOP5, 판수 페이지에 최근 7일 활동. 명예의 전당에 💥최다 골 차 승리·🧤무실점 경기·📈최다 연승 기록·🗓하루 최다 판수(KST). 산출 `data/activity.json`, 화면 조각 `js/activity-ui.js`. **버그 수정**: 넥슨 matchDate는 UTC인데 KST로 해석하던 문제(시즌 경계 00~09시 경기 누락 → 쌌따·멩똘·AUD똘콩스 판수 +1~3, 화면 날짜 하루 밀림) — `season.js matchTime`·`common.js parseTime`. 홈 요약 타일이 `dashboard.rows`(없는 경로)를 읽어 항상 '-'로 나오던 문제 수정. 천적·먹잇감은 보류(매칭이 무작위라 같은 상대 3회 이상이 1,536쌍 중 2쌍뿐).
- **v1.11.0** (2026-09-25): **전적 검색(일반 정보)에 🎭 플레이스타일 · ⚽ 에이스 선수** — [🔄 최신 업데이트]로 조회한 유저에 한해 표시(이전 캐시는 안내 문구). Worker `/search`가 공식경기 최근 30경기(기존 8)를 5개씩 병렬 조회하고, 클럽과 같은 판정 로직(`scripts/lib/playstyle.js`·`insight.js`, 에이스는 공용 `rankPlayers`)을 번들에 포함해 결과(`analysis`)만 응답. 랭커 기준값은 Pages의 `ranker-baseline.json`을 isolate에 6시간 캐시(`SITE_URL` var). 플레이스타일 칩·에이스 카드를 `js/insight-ui.js`로 공용화(명단·전적·검색). 응답 약 2.5초(콜드 스타트 첫 요청은 더 걸릴 수 있음).
- **v1.10.0** (2026-09-25): **포지션 스페셜리스트 에이스** — 사용자 피드백(에이스가 골·도움 순이라 공격수만 나옴) 반영. 선수를 8개 포지션 그룹(GK·CB·FB·DM·CM·측면·AM·ST)으로 나눠 **같은 그룹 랭커 선수 평균**과 11개 지표(가로채기·태클, 볼 획득, 블록, 공중볼, 패스, 드리블, 슈팅, 골, 도움, 선방, 평점)를 Z점수 비교 → 가장 돋보이는 선수 3명을 에이스로, Z ≥ 1이면 칭호(🧹 진공청소기, ✈️ 제공권의 지배자, 🎼 중원의 지휘자 등). 자격: 해당 포지션 선발 5경기 이상, 랭커 평균 경기당 0.3 미만 지표 제외. 랭커 포지션 기준값은 `ranker-baseline.js`가 기존 조회 데이터로 함께 계산(`positions`, API 추가 없음). `pStats`를 13칸(P_KEYS)으로 확장해 전체 재백필. 명예의 전당 🏅 포지션 스페셜리스트 TOP5. 넥슨 status.tackle은 intercept와 값이 같아 하나로 취급.
- **v1.9.0** (2026-09-25): **경기 상세 인사이트** — 이미 받던 매치 상세에서 선수별 골·도움·평점(`pStats`), 슈팅 상세(`shots`: 시각·좌표·결과·유형·도움), 상대 골 시각(`oppGoals`), 컨트롤러(`ctrl`), 카드(`cards`)를 추가 저장(API 호출 증가 없음, 기존 1,553경기 전체 백필 · data/matches 7.3→9.9MB). `aggregate.js` → `data/insights.json`(현재 시즌). 전적: 에이스 선수 TOP3·골 시간대(7구간)·역전승·극장골(80분 이후 동점→리드 결승골)·슈팅맵(SVG, 전체/골만). 명단: 🎮/⌨️. 명예의 전당: 득점왕·도움왕 선수, 역전의 명수, 극장골 제조기, 신사상·터프가이상(경기당 카드×3+파울). 판정 로직 단일 소스 `scripts/lib/insight.js`. 백필 설정 `oppLineupBackfillPerRun` → `detailBackfillPerRun`, 전체 백필 `collect.js --backfill-all`.
- **운영** (2026-09-25): 전적 갱신 지연(GitHub schedule 누락, 하루 ~4회) → **Cloudflare Worker Cron**이 2시간마다 수집 워크플로 실행. Worker `GH_TOKEN` 등록으로 관리자 클럽원 등록/삭제도 활성화. 수집 커밋 push 전 rebase·재시도.
- **v1.8.0** (2026-09-24): **토너먼트** 페이지(`tournament.html`, `js/tournament.js`) 추가 — 클럽원 선택 + 게스트 닉 추가 → 랜덤 추첨(대진 크기 = 인원 이상 최소 2의 제곱수, 부전승 1라운드 균등 분산·자동 진출) → 1라운드 순차 공개 → 이긴 선수 클릭으로 다음 라운드 진출(변경 시 이후 라운드 연쇄 초기화) → 우승·준우승 카드. 서버·저장 없는 1회성 도구(진행 중 새로고침 경고). 다시 추첨은 첫 결과 입력 전까지만.
- **v1.7.2** (2026-09-24): **플레이스타일 탭 제거** — 명단 플레이스타일과 중복. 네비·홈 바로가기에서 빼고 `style.html`은 명단으로 리다이렉트(기존 북마크 대응). `js/style-analysis.js`·`data/stats.json`·집계 `buildStats`·`config.styleTagThresholds` 삭제.
- **v1.7.1** (2026-09-24): 플레이스타일 판정을 **화면에 보이는 ▲3·▼3 지표 안에서만** 하도록 변경 — 두 지표가 함께 있으면 조합 스타일(56종), 없으면 가장 두드러진 지표 하나의 단일 스타일(25지표×높음/낮음=50종). 근거 지표는 ★칩으로 강조, 명단 상단에 '지표 기준 보기'(지표별 계산식) 추가. `playstyles.json`에 `metrics`(label·desc), 칩에 `key`, 스타일에 `basis` 추가.
- **v1.7.0** (2026-09-24): 클럽원 명단에 **플레이스타일** 표시 — 최근 인정 경기 50판(정상 종료, 최소 10판)의 지표 25종을 **랭커 평균**(공식 랭킹 1~1000위에서 페이지당 3명 샘플, 공식경기 최근 15판)과 Z점수로 비교해 ▲높은/▼낮은 지표 3개씩 + 30가지 스타일 중 조건(3개 중 2개 이상, 편차 0.5σ↑)이 가장 잘 맞는 한 줄 문구. 규칙은 `scripts/lib/playstyle.js`(`STYLES`) 한 곳에서 관리. 수집 시 경기별 원본 카운트(`styleRaw`) 저장·기존 경기 백필, 기준값은 `scripts/ranker-baseline.js`가 주 1회 갱신(넥슨 API에 랭킹 목록이 없어 FC온라인 데이터센터 랭킹 페이지에서 닉네임 수집). 크로스 수치는 API에 없어 '띄우는 패스 비율'로 대체.
- **v1.6.0** (2026-09-24): **내전** 경기 탭 → 당시 양팀 스쿼드(`internal.json`에 `aLineup`/`bLineup`). **전적 검색**: 결과를 이 기기(localStorage)에 저장하고 **[🔄 최신 업데이트]**를 눌러야 새로 조회(검색 유저는 자동 수집 안 함), 최근 검색 칩, [스쿼드](최근 경기 라인업)·경기 탭 → 양팀 스쿼드. Worker `/search`가 경기별 `lineup`/`oppLineup` 반환(**Worker 재배포 필요**). 클럽 밖 선수 이름용 `data/meta/pnames.json`(pid→이름, 누락 시에만 로딩) 추가.
- **v1.5.0** (2026-09-24): 전적 페이지에서 경기를 탭하면 **양팀 스쿼드**(포메이션 필드·교체 명단)를 모달로 표시(기존 포지션·강화 표 대체). 수집 시 상대 라인업(`oppLineup`)도 저장하고, 기존 1,384경기는 백필 완료(`config.oppLineupBackfillPerRun`로 회당 상한). `players.json`은 수집된 모든 경기 양팀 선수로 확대. 선수 카드·포메이션 변환을 화면(`js/squad.js`) 한 곳으로 일원화, `squads.json`은 원본 라인업만 저장. 강화 색 구간 보정(1~4 브론즈·5~7 실버·8~10 골드·11~13 백금/하늘색).
- **v1.4.0** (2026-09-24): 클럽원 명단에 **[스쿼드]** 버튼 추가 — 회원별 최근 수집 경기 라인업을 포메이션 필드(선수 이미지·시즌·강화)와 교체 명단으로 표시. 넥슨 API가 현재 스쿼드를 제공하지 않아 '최근 경기 출전 명단' 기준. 수집 시 필요한 선수/시즌 메타만 `data/meta/players.json`·`seasonid.json`으로 추려 저장(spid.json 6MB 미커밋), 집계 시 `data/squads.json` 생성.
- **v1.3.0** (2026-09-24): 시즌5 일정 반영(중간점검 10-01) + 대시보드 종료 D-day 표시. 클럽원 25명 등록. 정식 API 키로 전환. 관리자 로그인 활성화. 담당 시스템 제거(전원 평면 표시).
- **v1.1.0** (2026-09-23): 클럽/일반 2영역 재구성 + 일반 전적 검색(Cloudflare Worker 프록시) 추가.
- **v1.0.0** (2026-09-23): 1차 오픈 — 7개 조회 기능 + 관리자 패널 + 2시간 자동 수집.
