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
| 클럽원 명단 | 운영진·클럽원, 역할·최고등급, **[스쿼드]** 최근 경기 포메이션 모달 |
| 시즌 판수 | 진행률 바, 중간점검 미달자, 휴식 제외, 가입일 비례 |
| 클럽원 전적 | 최근 경기(승/무/패·스코어·상대)·라인업 |
| 플레이스타일 | 점유율·슈팅·패스성공률 + 성향 태그 |
| 클럽 내전 | 클럽원 간 상대 전적표 |
| 명예의 전당 | 시즌별 최다판수·최다승·최고승률 |
| 규칙·공지 | 운영 수칙 |
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
npm run aggregate   # 집계 → dashboard/stats/internal/hall.json
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
GitHub Actions (2시간마다)
  → collect.js  (신규 matchid만 상세 조회·누적)
  → aggregate.js(집계 JSON 생성)
  → data/ 커밋 → Pages 자동 반영
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
- **관리자 백엔드**: Cloudflare Worker (URL은 `js/common.js`의 `workerUrl` 참조). Secret: `NEXON_API_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`.
- **자동 수집**: `.github/workflows/collect.yml` 이 2시간마다 실행 → data 커밋 → Pages 반영.

### 클럽원 (25명)
- 운영진: 곽철용(회장, *닉 색인 반영 대기 → collect.js 자동 등록*), 문선생(클럽장), 쌌따(부클럽장)
- 클럽원 22명. **담당(부클럽장별) 시스템은 사용 안 함** → 명단/판수는 운영진+클럽원 평면 표시.

### 운영 규칙(확정)
- 판수 인정 매치: 공식경기(50)+공식친선(60)+리그친선(30). **감독모드·볼타 제외.**
- 시즌 50판 / 중간점검(전반기 종료) 25판. 가입일·휴식 비례 자동.

### 남은 작업 (TODO)
1. **관리자 등록/삭제 활성화** — Worker에 `GH_TOKEN`(repo contents 쓰기용 fine-grained PAT) 시크릿 추가 필요. (로그인·검색은 이미 동작)
2. **시즌 시작·종료 정확일** — `data/seasons.json` `s5`의 start/end는 추정값(중간점검 2026-10-01만 확정). 확인되면 수정.
3. **팀컬러 현황판** — 보류. 넥슨이 선수→구단 데이터 미제공. 대안으로 '회원별 스쿼드 보기'(v1.4.0) 먼저 반영. 선수→구단 매핑은 별도 데이터 필요.

## 변경 이력
- **v1.5.0** (2026-09-24): 전적 페이지에서 경기를 탭하면 **양팀 스쿼드**(포메이션 필드·교체 명단)를 모달로 표시(기존 포지션·강화 표 대체). 수집 시 상대 라인업(`oppLineup`)도 저장하고, 기존 1,384경기는 백필 완료(`config.oppLineupBackfillPerRun`로 회당 상한). `players.json`은 수집된 모든 경기 양팀 선수로 확대. 선수 카드·포메이션 변환을 화면(`js/squad.js`) 한 곳으로 일원화, `squads.json`은 원본 라인업만 저장. 강화 색 구간 보정(1~4 브론즈·5~7 실버·8~10 골드·11~13 백금/하늘색).
- **v1.4.0** (2026-09-24): 클럽원 명단에 **[스쿼드]** 버튼 추가 — 회원별 최근 수집 경기 라인업을 포메이션 필드(선수 이미지·시즌·강화)와 교체 명단으로 표시. 넥슨 API가 현재 스쿼드를 제공하지 않아 '최근 경기 출전 명단' 기준. 수집 시 필요한 선수/시즌 메타만 `data/meta/players.json`·`seasonid.json`으로 추려 저장(spid.json 6MB 미커밋), 집계 시 `data/squads.json` 생성.
- **v1.3.0** (2026-09-24): 시즌5 일정 반영(중간점검 10-01) + 대시보드 종료 D-day 표시. 클럽원 25명 등록. 정식 API 키로 전환. 관리자 로그인 활성화. 담당 시스템 제거(전원 평면 표시).
- **v1.1.0** (2026-09-23): 클럽/일반 2영역 재구성 + 일반 전적 검색(Cloudflare Worker 프록시) 추가.
- **v1.0.0** (2026-09-23): 1차 오픈 — 7개 조회 기능 + 관리자 패널 + 2시간 자동 수집.
