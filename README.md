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
| 클럽원 명단 | 부클럽장별 그룹, 역할·최고등급·톡방닉 |
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

## 2차 로드맵
- 아무 유저 전적 조회 (Worker 프록시 확장)
- 스쿼드메이커 (선수 메타데이터 기반)

---

## 변경 이력
- **v1.0.0** (2026-09-23): 1차 오픈 — 7개 조회 기능 + 관리자 등록/삭제 + 2시간 자동 수집.
  초기 클럽원: Dor6문선생(클럽장). *Dor6곽철용(회장)은 인게임 닉 확인 후 등록 예정.*
