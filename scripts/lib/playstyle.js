/* ============================================================
   playstyle.js — 플레이스타일 지표·판정 공용 로직
   - collect.js: 매치 상세 → 경기별 원본 카운트(styleRaw) 저장
   - ranker-baseline.js: 랭커 샘플 지표 → 평균·표준편차(기준값)
   - aggregate.js: 클럽원 지표를 기준값과 비교(Z점수) → 높은/낮은 지표 3개씩 + 스타일 판정
   설계: 비율 지표는 '경기별 비율의 평균'이 아니라 '합계 ÷ 합계'로 계산(표본 적은 경기의 왜곡 방지)
   스타일은 화면에 보이는 ▲3·▼3 지표 안에서만 판정 → 칩과 스타일 문구가 항상 일치
   ============================================================ */

/* 매치 상세의 한쪽(me) + 상대(opp) → 저장용 원본 카운트 (키를 짧게 해 파일 크기 절약) */
export function styleRaw(me, opp) {
  if (!me) return null;
  const md = me.matchDetail || {}, sh = me.shoot || {}, ps = me.pass || {}, df = me.defence || {};
  return {
    end: md.matchEndType ?? 0,                       // 0 정상 종료, 1·2 몰수(집계 제외)
    pos: md.possession ?? 0, rt: md.averageRating ?? 0, dr: md.dribble ?? 0,
    off: md.offsideCount ?? 0, ck: md.cornerKick ?? 0, fl: md.foul ?? 0,
    cd: (md.yellowCards ?? 0) + (md.redCards ?? 0),
    pT: ps.passTry ?? 0, pS: ps.passSuccess ?? 0, spT: ps.shortPassTry ?? 0, lpT: ps.longPassTry ?? 0,
    tpT: ps.throughPassTry ?? 0, lobT: (ps.bouncingLobPassTry ?? 0) + (ps.lobbedThroughPassTry ?? 0),
    sT: sh.shootTotal ?? 0, eS: sh.effectiveShootTotal ?? 0, g: sh.goalTotal ?? 0,
    gH: sh.goalHeading ?? 0, sO: sh.shootOutPenalty ?? 0, gO: sh.goalOutPenalty ?? 0, gI: sh.goalInPenalty ?? 0,
    gSet: (sh.goalFreekick ?? 0) + (sh.goalPenaltyKick ?? 0),
    tT: df.tackleTry ?? 0, tS: df.tackleSuccess ?? 0, bT: df.blockTry ?? 0,
    ga: (opp && opp.shoot && opp.shoot.goalTotal) ?? 0
  };
}

/* ---------- 슈팅 상세 기반 원본 카운트 (v2.5.0) ----------
   입력: insight.js 형식 슈팅 배열 [초, x, y, 결과, 유형, spId, 도움spId] — 클럽 matches[].shots, 랭커·검색은 insightRaw().shots
   유형 코드(넥슨 shootDetail.type, fc-info 골 유형과 대조해 확정): 1 일반 · 2 감아차기 · 3 헤더 · 6 땅볼 · 7 발리 · 8 프리킥 · 9 PK
   styleRaw와 키가 겹치지 않게 x 접두사 — computeMetrics가 합산 */
const ST = { FINESSE: 2, HEAD: 3, LOW: 6, VOLLEY: 7, FK: 8, PK: 9 };
const WIDE_ANGLE = 40;   // 골문 중앙 기준 이 각도(도) 이상이면 측면 각도 슈팅
export function shotStyleRaw(shots) {
  if (!Array.isArray(shots)) return null;
  const r = { xN: 0, xF: 0, xV: 0, xL: 0, xH: 0, xW: 0, xG: 0, xG2: 0 };
  for (const [t, x, y, res, type] of shots) {
    if (res === 3 && t != null) { r.xG++; if (t >= 45 * 60) r.xG2++; }   // 후반·연장 골
    if (type === ST.FK || type === ST.PK) continue;                      // 세트피스는 슈팅 방식 지표에서 제외
    r.xN++;
    if (type === ST.FINESSE) r.xF++;
    else if (type === ST.VOLLEY) r.xV++;
    else if (type === ST.LOW) r.xL++;
    else if (type === ST.HEAD) r.xH++;
    const angle = (Math.atan2(Math.abs(y - 0.5) * 68, Math.max(0, (1 - x) * 105)) * 180) / Math.PI;
    if (angle >= WIDE_ANGLE) r.xW++;
  }
  return r;
}
/* 경기 원본 + 슈팅 상세 → 한 경기 원본 (슈팅 상세가 없으면 styleRaw만 — 새 지표는 계산 제외) */
export const withShots = (raw, shots) => (raw ? { ...raw, ...(shotStyleRaw(shots) || {}) } : raw);

/* 지표 정의 — unit '%'는 0~1 비율(화면에서 ×100), 'avg%'는 이미 % 값, 나머지는 경기당 수치
   desc: 화면 '지표 기준' 안내에 그대로 노출되는 계산식 */
export const METRICS = {
  poss:        { label: "점유율",           unit: "avg%", desc: "경기별 볼 점유율 평균" },
  passRate:    { label: "패스 성공률",      unit: "%", desc: "패스 성공 ÷ 패스 시도" },
  shortRatio:  { label: "짧은 패스 비율",   unit: "%", desc: "짧은 패스 시도 ÷ 전체 패스 시도" },
  longRatio:   { label: "롱패스 비율",      unit: "%", desc: "롱패스 시도 ÷ 전체 패스 시도" },
  throughRatio:{ label: "스루패스 비율",    unit: "%", desc: "스루패스 시도 ÷ 전체 패스 시도" },
  lobRatio:    { label: "띄우는 패스 비율", unit: "%", desc: "(로빙 패스 + 로빙 스루) 시도 ÷ 전체 패스 시도 — 넥슨 API에 크로스 수치가 없어 대신 사용" },
  shots:       { label: "경기당 슈팅",      unit: "", desc: "슈팅 수 ÷ 경기 수" },
  effRate:     { label: "유효슈팅 비율",    unit: "%", desc: "유효슈팅 ÷ 슈팅" },
  finish:      { label: "결정력",           unit: "%", desc: "골 ÷ 슈팅" },
  headGoal:    { label: "헤더골 비율",      unit: "%", desc: "헤더골 ÷ 전체 골" },
  longShot:    { label: "중거리 슈팅 비율", unit: "%", desc: "박스 밖 슈팅 ÷ 전체 슈팅" },
  longGoal:    { label: "중거리골 비율",    unit: "%", desc: "박스 밖 골 ÷ 전체 골" },
  boxGoal:     { label: "박스안골 비율",    unit: "%", desc: "박스 안 골 ÷ 전체 골" },
  setGoal:     { label: "세트피스골",       unit: "", desc: "(프리킥 골 + PK 골) ÷ 경기 수" },
  dribble:     { label: "경기당 드리블",    unit: "", desc: "드리블 거리(넥슨 dribble 값) ÷ 경기 수" },
  offside:     { label: "오프사이드",       unit: "", desc: "오프사이드 ÷ 경기 수" },
  corner:      { label: "코너킥",           unit: "", desc: "코너킥 ÷ 경기 수" },
  tackleTry:   { label: "태클 시도",        unit: "", desc: "태클 시도 ÷ 경기 수" },
  tackleRate:  { label: "태클 성공률",      unit: "%", desc: "태클 성공 ÷ 태클 시도" },
  block:       { label: "블락 시도",        unit: "", desc: "블락 시도 ÷ 경기 수" },
  foul:        { label: "파울",             unit: "", desc: "파울 ÷ 경기 수" },
  cards:       { label: "카드",             unit: "", desc: "(옐로 + 레드) ÷ 경기 수" },
  gf:          { label: "경기당 득점",      unit: "", desc: "득점 ÷ 경기 수" },
  ga:          { label: "경기당 실점",      unit: "", desc: "실점 ÷ 경기 수" },
  rating:      { label: "평균 평점",        unit: "", desc: "경기별 선수 평균 평점의 평균" },
  // v2.5.0 슈팅 상세 기반 (프리킥·PK 제외 슈팅 기준)
  finesse:     { label: "감아차기 비율",    unit: "%", desc: "감아차기 슈팅 ÷ 슈팅 (프리킥·PK 제외)" },
  volley:      { label: "발리 비율",        unit: "%", desc: "발리 슈팅 ÷ 슈팅 (프리킥·PK 제외)" },
  lowShot:     { label: "땅볼 슈팅 비율",   unit: "%", desc: "땅볼(깔아 차기) 슈팅 ÷ 슈팅 (프리킥·PK 제외)" },
  headShot:    { label: "헤더 슈팅 비율",   unit: "%", desc: "헤더 슈팅 ÷ 슈팅 (프리킥·PK 제외)" },
  wideShot:    { label: "측면 각도 슈팅",   unit: "%", desc: "골문 중앙 기준 40° 이상 각도에서 쏜 슈팅 ÷ 슈팅" },
  lateGoal:    { label: "후반 득점 비율",   unit: "%", desc: "후반(46분~)·연장 골 ÷ 전체 골" }
};
/* 실력(결과) 지표 — 스타일 판정 점수를 0.7배로 낮춰 '플레이 방식' 조합이 먼저 뽑히게 함 (v2.5.0) */
export const SKILL_METRICS = ["finish", "effRate", "gf", "ga", "rating"];
const SKILL_WEIGHT = 0.7;

/* 원본 카운트 배열(정상 종료 경기만 넘길 것) → 지표 값 */
export function computeMetrics(raws) {
  const S = {};
  for (const r of raws) for (const [k, v] of Object.entries(r)) S[k] = (S[k] || 0) + (v || 0);
  const n = raws.length;
  const r = (a, b) => (b ? a / b : 0);
  return {
    poss: S.pos / n, passRate: r(S.pS, S.pT), shortRatio: r(S.spT, S.pT), longRatio: r(S.lpT, S.pT),
    throughRatio: r(S.tpT, S.pT), lobRatio: r(S.lobT, S.pT),
    shots: S.sT / n, effRate: r(S.eS, S.sT), finish: r(S.g, S.sT),
    headGoal: r(S.gH, S.g), longShot: r(S.sO, S.sT), longGoal: r(S.gO, S.g), boxGoal: r(S.gI, S.g),
    setGoal: S.gSet / n, dribble: S.dr / n, offside: S.off / n, corner: S.ck / n,
    tackleTry: S.tT / n, tackleRate: r(S.tS, S.tT), block: S.bT / n,
    foul: S.fl / n, cards: S.cd / n, gf: S.g / n, ga: S.ga / n, rating: S.rt / n,
    // 슈팅 상세가 하나도 없으면 null → 판정에서 제외
    finesse: S.xN ? S.xF / S.xN : null, volley: S.xN ? S.xV / S.xN : null, lowShot: S.xN ? S.xL / S.xN : null,
    headShot: S.xN ? S.xH / S.xN : null, wideShot: S.xN ? S.xW / S.xN : null, lateGoal: S.xG ? S.xG2 / S.xG : null
  };
}

/* 여러 사람의 지표 → 지표별 평균·표준편차 (기준값) */
export function baselineStats(metricsList) {
  const out = {};
  for (const k of Object.keys(METRICS)) {
    const v = metricsList.map((m) => m[k]).filter((x) => x != null);
    if (!v.length) continue;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    out[k] = { mean, sd: sd || 1 };
  }
  return out;
}

/* ---------- 스타일 규칙 ----------
   표기: '지표+' = 랭커보다 높음(▲ 칩), '지표-' = 낮음(▼ 칩)
   ① COMBO_STYLES: 두 조건이 모두 화면의 ▲3·▼3 칩에 있을 때만 후보 — 단일보다 우선
   ② SINGLE_STYLES: 25개 지표 × 높음/낮음 = 50개 — 조합이 없을 때 편차가 가장 큰 칩 하나로 판정(항상 매칭 보장)
   문구 수정·추가는 이 두 표만 편집하면 됨 */
export const SINGLE_STYLES = {
  "poss+": ["점유율 지배자", "공은 내 거, 상대는 90분 구경꾼"],
  "poss-": ["공 양보왕", "점유율은 상대 줘, 난 결과만 가져간다"],
  "passRate+": ["정밀 배송기사", "패스 하나하나가 택배처럼 정확 배송"],
  "passRate-": ["패스 복권러", "이 패스… 받으면 좋고 아님 말고"],
  "shortRatio+": ["발밑 패스 장인", "한 칸씩 또박또박, 짧은 패스 성애자"],
  "shortRatio-": ["짧은 패스 거부자", "옆으로 툭툭 주는 건 성미에 안 맞아"],
  "longRatio+": ["대포알 롱패스", "하프라인 넘기는 건 기본, 전환의 달인"],
  "longRatio-": ["롱패스 금지령", "멀리 차는 건 불안해, 가까운 동료부터"],
  "throughRatio+": ["스루패스 중독자", "틈만 보이면 찔러 넣는 스루 성애자"],
  "throughRatio-": ["스루 아끼는 신중파", "찔러줄 타이밍? 아직 아니야"],
  "lobRatio+": ["공중 배달부", "공은 하늘로, 크로스·로빙이 주무기"],
  "lobRatio-": ["땅볼 신봉자", "공이 뜨면 불안해, 크로스는 사치"],
  "shots+": ["슈팅 머신", "기회만 나면 일단 때리고 본다"],
  "shots-": ["슈팅 아끼는 수도승", "확실할 때만 쏜다, 슈팅은 신중하게"],
  "effRate+": ["골문 저격수", "쏘면 일단 골문 안으로, 유효슈팅 장인"],
  "effRate-": ["관중석 기념품 배달부", "오늘도 관중석에 공 한 개 선물"],
  "finish+": ["원샷원킬", "한 번 쏘면 골, 냉혈 피니셔"],
  "finish-": ["골대 수집가", "만들긴 잘하는데 마무리가 아쉬운 형"],
  "headGoal+": ["뚝배기 원툴", "골은 머리로 넣는 것"],
  "headGoal-": ["헤더 포기자", "머리는 생각할 때만 쓴다"],
  "longShot+": ["중거리 애호가", "박스 밖이 곧 내 슈팅 존"],
  "longShot-": ["박스 입장 필수", "박스 안 아니면 안 쏜다"],
  "longGoal+": ["원더골 제조기", "골 하이라이트는 늘 박스 밖에서"],
  "longGoal-": ["중거리 무득점", "중거리골은 남의 얘기"],
  "boxGoal+": ["박스 안 포식자", "골대 앞 3m만 믿는 사냥꾼"],
  "boxGoal-": ["박스 밖 해결사", "골은 멀리서도 터진다"],
  "setGoal+": ["데드볼 장인", "프리킥·PK만 얻으면 반은 골"],
  "setGoal-": ["필드골 순수주의자", "세트피스? 골은 흐름 속에서 넣는 것"],
  "dribble+": ["드리블 메시", "패스? 내가 직접 들고 간다"],
  "dribble-": ["원터치 플레이어", "공 오래 끄는 건 질색, 바로바로 처리"],
  "offside+": ["오프사이드 제조기", "라인 끝에서 늘 한 발 먼저 출발"],
  "offside-": ["라인 지킴이", "침투 타이밍 칼같이 지키는 모범생"],
  "corner+": ["코너킥 공장장", "측면을 파고들어 코너킥을 뽑아낸다"],
  "corner-": ["코너킥 무소식", "코너킥? 그게 뭐죠"],
  "tackleTry+": ["태클 광전사", "보이면 일단 발부터 넣는다"],
  "tackleTry-": ["태클 절약형", "태클은 아껴두는 거야"],
  "tackleRate+": ["수비 교과서", "발만 쏙, 깔끔하게 뺏는 정석 수비"],
  "tackleRate-": ["헛발 태클러", "태클은 했는데 공은 그대로"],
  "block+": ["몸빵 수비수", "슈팅은 내 몸으로 막는다"],
  "block-": ["블락 면제", "슈팅 막는 건 키퍼 몫"],
  "foul+": ["파울 트러블메이커", "공 아니면 발목, 도륙 정신 계승자"],
  "foul-": ["신사 플레이어", "심판이 필요 없는 매너 축구"],
  "cards+": ["카드 수집가", "옐로카드도 소중한 수집품"],
  "cards-": ["클린 플레이어", "카드 한 장 없는 깨끗한 축구"],
  "gf+": ["득점 기계", "경기마다 골이 쏟아지는 화력 담당"],
  "gf-": ["골 가뭄", "골 넣기가 이렇게 어렵다니"],
  "ga+": ["24시 무인 자동문", "우리 골문은 연중무휴 개방"],
  "ga-": ["통곡의 벽", "우리 골문은 좀처럼 열리지 않는다"],
  "rating+": ["평점 에이스", "선수 평점이 증명하는 경기력"],
  "rating-": ["평점 테러범", "선수들이 울고 있다"],
  // v2.5.0 슈팅 상세 지표
  "finesse+": ["감아차기 장인", "ZD 한 방이면 골키퍼는 구경꾼"],
  "finesse-": ["정직한 슈터", "감아차기? 난 정직하게 일반 슛"],
  "volley+": ["논스톱 발리러", "떨어지는 공은 무조건 논스톱"],
  "volley-": ["트래핑 먼저", "발리는 불안해, 일단 잡고 쏜다"],
  "lowShot+": ["땅볼 슈터", "골키퍼 발밑으로 깔아 찬다"],
  "lowShot-": ["깔아 차기 거부", "슈팅은 뜨게 차야 제맛"],
  "headShot+": ["헤딩 중독", "공이 뜨면 일단 머리부터"],
  "headShot-": ["발로만 슛", "머리는 헤어스타일 지키는 용"],
  "wideShot+": ["각도 무시 슈터", "골라인 옆에서도 일단 쏜다"],
  "wideShot-": ["정면 승부사", "각 없는 슈팅은 안 쏜다, 골문 정면만"],
  "lateGoal+": ["후반 몰아치기", "후반만 되면 살아나는 슬로 스타터"],
  "lateGoal-": ["전반 폭격형", "초반에 몰아치고 후반엔 관리 모드"]
};

export const COMBO_STYLES = [
  // 빌드업
  ["티키타카 장인", "공은 내 거, 패스는 정확, 상대는 구경꾼", ["poss+", "passRate+"]],
  ["원터치 티키타카", "짧게 주고 바로 뿌리는 원터치 패스 축구", ["shortRatio+", "dribble-"]],
  ["점유율 수집가", "공은 실컷 돌리는데 슈팅은 아끼는 박물관 축구", ["poss+", "shots-"]],
  ["공 돌리다 한 방", "점유하다 틈이 보이면 바로 찔러 넣는다", ["poss+", "throughRatio+"]],
  ["빌드업 생략파", "미드필더 생략, 골키퍼에서 공격수로 직행", ["longRatio+", "shortRatio-"]],
  ["역습 대포", "공은 넘겨주고, 뺏으면 롱패스로 한 번에", ["poss-", "longRatio+"]],
  ["역습 저격수", "공 주고 기다리다 한 방에 끝낸다", ["poss-", "finish+"]],
  ["선수비 후역습", "내주는 점유율, 안 내주는 골문", ["poss-", "ga-"]],
  ["점유율 롱볼러", "공은 오래 갖고, 찰 땐 멀리 찬다", ["poss+", "longRatio+"]],
  ["안전제일 공무원", "리스크 제로, 칼퇴 보장 공무원 축구", ["passRate+", "dribble-"]],
  ["패스보다 발", "패스는 불안해도 드리블은 자신 있다", ["dribble+", "passRate-"]],
  // 침투·스루
  ["오프사이드 공장", "스루패스 버튼 닳는 오프사이드 제조기", ["throughRatio+", "offside+"]],
  ["킬패스 마에스트로", "스루패스 한 번에 수비 라인 해체", ["throughRatio+", "finish+"]],
  ["스루 난사범", "찔러는 주는데 절반은 상대 발 앞", ["throughRatio+", "passRate-"]],
  ["반 박자 빠른 사나이", "라인 끝에서 늘 한 발 먼저, 마무리는 한 발 늦게", ["offside+", "finish-"]],
  ["깃발 무시 득점기", "오프사이드 몇 번 걸려도 결국 넣는다", ["offside+", "gf+"]],
  // 공중·측면
  ["뚝배기 크로스형", "패스보다 크로스, 골은 머리로", ["lobRatio+", "headGoal+"]],
  ["뚝배기 원툴", "그냥 패스보다 크로스를 잘하는 뚝배기 원툴", ["headGoal+", "passRate-"]],
  ["데드볼 헤더", "코너킥 뽑고 머리로 마무리", ["corner+", "headGoal+"]],
  ["측면 크랙", "측면 끝까지 파고들어 올려주는 윙어 장인", ["lobRatio+", "corner+"]],
  ["로빙스루 마술사", "머리 위로 넘기는 한 방 로빙스루", ["lobRatio+", "finish+"]],
  ["땅볼 중거리파", "크로스는 사치, 박스 밖에서 깔아 차는 낮은 탄도 장인", ["longShot+", "lobRatio-"]],
  ["발로만 해결", "머리 대신 발, 박스 밖에서도 해결한다", ["longShot+", "headGoal-"]],
  // 슈팅·마무리
  ["중거리 스나이퍼", "박스 밖이 곧 내 슈팅 존, 실제로 들어간다", ["longShot+", "longGoal+"]],
  ["중거리 대포", "박스 밖에서도 골문 안으로 꽂는다", ["longShot+", "effRate+"]],
  ["관중석 기념품 배달부", "중거리 한 방이 관중석으로 선물", ["longShot+", "finish-"]],
  ["관중석 VIP 배송", "박스 밖에서 쏘고 관중석으로 배송 완료", ["longShot+", "effRate-"]],
  ["박스 안 포식자", "골대 앞 3m만 믿는 냉혈 사냥꾼", ["boxGoal+", "longShot-"]],
  ["박스 안 결정자", "박스 안에 들어오면 반드시 넣는다", ["boxGoal+", "finish+"]],
  ["프리킥 스페셜리스트", "파울만 얻으면 반은 골, 멀리서도 넣는다", ["setGoal+", "longGoal+"]],
  ["슈팅 난사범", "열 번 쏘면 한 번은 들어간다는 믿음", ["shots+", "finish-"]],
  ["막 쏘는 형", "일단 쏘고 본다, 방향은 운에 맡긴다", ["shots+", "effRate-"]],
  ["가성비 스트라이커", "적게 쏘고 많이 넣는 원샷원킬", ["shots-", "finish+"]],
  ["신중한 저격수", "아껴 쏘는 만큼 골문 안으로", ["shots-", "effRate+"]],
  ["냉혈 피니셔", "골문 안으로 쏘고, 쏘면 들어간다", ["effRate+", "finish+"]],
  ["화력 폭격기", "쉴 새 없이 쏘고 쉴 새 없이 넣는다", ["shots+", "gf+"]],
  ["파상공세", "슈팅에 코너킥까지, 쉴 새 없이 두드린다", ["shots+", "corner+"]],
  ["닥공 노수비", "공격은 최선의 방어… 는 아니었다", ["shots+", "ga+"]],
  ["앞만 보는 공격수", "쏘고 또 뛰어들고, 라인은 신경 안 쓴다", ["shots+", "offside+"]],
  ["박스 밖 전문가", "박스 밖에서 쏘고, 박스 밖에서 넣는다", ["longShot+", "boxGoal-"]],
  ["돌격대장", "드리블로 밀고 들어가 일단 쏜다", ["dribble+", "shots+"]],
  ["원맨쇼", "패스는 필요 없다, 혼자 들고 가서 넣는다", ["dribble+", "throughRatio-"]],
  ["골 가뭄 심화", "쏴도 안 들어가고 골도 안 난다", ["gf-", "finish-"]],
  ["순수 골잡이", "골만 넣고 패스는 모르는 공격수", ["gf+", "passRate-"]],
  // 수비·매너
  ["도륙 정신 계승자", "공 아니면 발목, 클럽명에 충실한 수비", ["tackleTry+", "foul+"]],
  ["카드 컬렉터", "파울에 카드까지, 심판과 친한 사이", ["foul+", "cards+"]],
  ["태클 장인", "많이 들어가고 많이 뺏는 진짜 수비", ["tackleTry+", "tackleRate+"]],
  ["신사 수비수", "파울 없이 깔끔하게 뺏는 매너 수비", ["tackleRate+", "foul-"]],
  ["버스 기사", "골문 앞에 버스 세우고 몸으로 막는다", ["block+", "ga-"]],
  ["무인 자동문", "태클은 헛발, 골문은 활짝", ["ga+", "tackleRate-"]],
  ["블락 없는 골문", "슈팅 막는 사람이 없는 오픈 골대", ["ga+", "block-"]],
  ["불꽃 난타전", "5:4 아니면 재미없는 공격 축구", ["gf+", "ga+"]],
  ["짠물 1:0 장인", "1:0이면 충분, 재미는 상대 몫", ["ga-", "gf-"]],
  ["짠물 수비", "적게 쏘고 적게 먹는 실리 축구", ["ga-", "shots-"]],
  // 종합
  ["육각형 올라운더", "패스도 평점도 되는 사기캐", ["rating+", "passRate+"]],
  ["평점 캐리", "골로 평점까지 끌어올리는 에이스", ["rating+", "gf+"]],
  ["평점 폭락장", "실점에 평점까지 우울한 날들", ["rating-", "ga+"]],

  /* ===== v2.5.0 확장 — ▲×▼ 대비 조합 (높은 지표 하나 + 낮은 지표 하나) ===== */
  // 중거리
  ["역습 중거리포", "뺏으면 바로 박스 밖에서 한 방", ["longShot+", "poss-"]],
  ["헛심 중거리", "박스 밖에서 열심히 쏘는데 스코어는 조용", ["longShot+", "gf-"]],
  ["나 홀로 포병", "중거리는 쏘는데 팀 평점은 바닥", ["longShot+", "rating-"]],
  ["패스 대신 중거리", "패스가 꼬이면 그냥 박스 밖에서 때린다", ["longShot+", "passRate-"]],
  ["스루 대신 중거리", "찔러주기보다 멀리서 해결하는 편", ["longShot+", "throughRatio-"]],
  ["원터치 중거리", "잡자마자 박스 밖에서 바로 슛", ["longShot+", "dribble-"]],
  ["공격만 하는 한량", "수비는 남 일, 중거리는 내 일", ["longShot+", "tackleTry-"]],
  ["쏘고 잊는 공격수", "앞에선 쏘고, 뒤에선 안 막는다", ["longShot+", "block-"]],
  // 스루패스
  ["카운터 스루", "공 내주고, 뺏는 순간 스루 한 방", ["throughRatio+", "poss-"]],
  ["찔러주기 전문", "스루는 내가, 수비는 네가", ["throughRatio+", "tackleTry-"]],
  ["건너뛰는 패서", "옆 패스는 건너뛰고 바로 뒷공간", ["throughRatio+", "shortRatio-"]],
  ["헛스루 장인", "스루는 쉴 새 없는데 골은 없다", ["throughRatio+", "gf-"]],
  ["떠먹여도 못 먹는", "스루는 완벽, 마무리가 문제", ["throughRatio+", "finish-"]],
  ["원터치 킬패스", "잡자마자 뒷공간으로 찔러준다", ["throughRatio+", "dribble-"]],
  ["땅볼 스루 장인", "공 띄울 일 없이 발밑 스루로 뚫는다", ["throughRatio+", "lobRatio-"]],
  // 침투·오프사이드
  ["침투만 하는 러너", "라인은 넘는데 슈팅은 아낀다", ["offside+", "shots-"]],
  ["박스 침투형", "박스 밖 슈팅? 난 뒷공간으로 들어간다", ["offside+", "longShot-"]],
  ["깃발 수집가", "골보다 오프사이드 깃발이 더 많다", ["offside+", "gf-"]],
  ["뒷공간 카운터", "공 내주고 라인 뒤로 뛰어든다", ["offside+", "poss-"]],
  ["무모한 침투", "패스도 침투도 일단 던지고 본다", ["offside+", "passRate-"]],
  ["원터치 침투", "받자마자 라인 뒤로", ["offside+", "dribble-"]],
  // 짧은 패스
  ["슈팅 공포증 티키타카", "패스는 백 번, 슈팅은 한 번", ["shortRatio+", "shots-"]],
  ["노골 티키타카", "예쁘게 돌리는데 골이 안 난다", ["shortRatio+", "gf-"]],
  ["중앙 티키타카", "측면은 안 간다, 가운데로만", ["shortRatio+", "corner-"]],
  ["옆으로만 패스", "앞으로는 안 가고 옆으로만 툭툭", ["shortRatio+", "throughRatio-"]],
  ["발밑 전용", "공은 절대 안 띄운다, 발밑으로만", ["shortRatio+", "lobRatio-"]],
  ["골대 앞까지 패스", "박스 안까지 패스로 들고 간다", ["shortRatio+", "longShot-"]],
  // 파울·카드
  ["발목 사냥꾼", "공은 못 뺏고 발목만 걷어찬다", ["foul+", "tackleRate-"]],
  ["거친 역습", "공은 내주고 몸으로 부딪힌다", ["foul+", "poss-"]],
  ["태클 없는 반칙왕", "태클 대신 잡아당기기", ["foul+", "tackleTry-"]],
  ["터프한 카운터", "점유율은 양보해도 몸싸움은 양보 못 해", ["cards+", "poss-"]],
  ["화만 나는 축구", "슈팅은 안 들어가고 카드만 쌓인다", ["cards+", "finish-"]],
  ["말로 하는 수비", "태클은 안 하는데 카드는 받는다", ["cards+", "tackleTry-"]],
  ["패스 대신 몸싸움", "패스는 흘리고 몸으로 되찾는다", ["cards+", "passRate-"]],
  // 슈팅 수
  ["역습 난사", "공 뺏으면 무조건 슈팅", ["shots+", "poss-"]],
  ["패스 생략 슈팅", "패스 대신 슈팅, 일단 쏜다", ["shots+", "passRate-"]],
  ["원터치 슈터", "받자마자 바로 슈팅", ["shots+", "dribble-"]],
  ["쏘기 바쁜 공격수", "슈팅은 많고 수비 가담은 없다", ["shots+", "tackleTry-"]],
  // 점유
  ["무딘 창 점유율", "공은 다 갖는데 끝이 무디다", ["poss+", "finish-"]],
  ["점유율 부자 골 가난", "점유율은 60%, 골은 0", ["poss+", "gf-"]],
  ["뺏기면 끝", "공 잡을 땐 왕, 뺏기면 무방비", ["poss+", "block-"]],
  ["중앙 점유", "측면은 버리고 가운데서 돌린다", ["poss+", "corner-"]],
  ["공이 곧 수비", "뺏길 일이 없으니 태클할 일도 없다", ["poss+", "tackleTry-"]],
  // 태클
  ["한 방 태클러", "태클은 가끔, 하면 무조건 뺏는다", ["tackleRate+", "tackleTry-"]],
  ["뺏고 달리는 수비", "깔끔하게 뺏고 바로 역습", ["tackleRate+", "poss-"]],
  ["뺏고 흘리는", "뺏는 건 잘하는데 주는 게 문제", ["tackleTry+", "passRate-"]],
  ["압박 카운터", "공 없을 땐 미친 듯이 압박", ["tackleTry+", "poss-"]],
  ["압박 원툴", "뺏는 건 열심, 넣는 건 남 일", ["tackleTry+", "gf-"]],
  // 롱패스·크로스
  ["로또 롱패스", "멀리 차고 기도한다", ["longRatio+", "passRate-"]],
  ["롱볼 헛수고", "롱볼은 멀리, 골은 더 멀리", ["longRatio+", "gf-"]],
  ["롱볼 카운터", "뺏으면 드리블 없이 바로 전방으로", ["longRatio+", "dribble-"]],
  ["크로스 헛수고", "올리고 또 올리는데 머리에 안 맞는다", ["lobRatio+", "headGoal-"]],
  ["공중볼 도박사", "띄우고 보는 패스, 성공은 운", ["lobRatio+", "passRate-"]],
  // 드리블
  ["드리블만 하는", "들고 다니기만 하고 슈팅은 안 한다", ["dribble+", "shots-"]],
  ["혼자 치고 가는", "짧은 패스는 생략, 직접 들고 간다", ["dribble+", "shortRatio-"]],
  ["헛 드리블", "화려한 드리블, 조용한 스코어", ["dribble+", "gf-"]],
  // 코너킥·박스·세트피스·원더골·블락
  ["발끝 코너킥", "코너킥은 땄는데 머리는 안 쓴다", ["corner+", "headGoal-"]],
  ["두드려도 안 열리는", "코너킥까지 뽑는데 골문은 안 열린다", ["corner+", "finish-"]],
  ["박스 안 한 방", "적게 쏘고 박스 안에서만 넣는다", ["boxGoal+", "shots-"]],
  ["원터치 골잡이", "골문 앞에서 원터치로 끝낸다", ["boxGoal+", "dribble-"]],
  ["세트피스 의존증", "필드골은 없고 세트피스만", ["setGoal+", "gf-"]],
  ["역습 원더골러", "공 뺏으면 박스 밖에서 원더골", ["longGoal+", "poss-"]],
  ["원더골 한 방 인생", "패스는 흔들려도 원더골 한 방이면 된다", ["longGoal+", "passRate-"]],
  ["골문 앞 인간 방패", "점유율 내주고 몸으로 막는다", ["block+", "poss-"]],
  // 슈팅 유형 (v2.5.0 지표)
  ["감아차기 과신러", "감으면 들어간다던 믿음… 오늘도 골대 옆", ["finesse+", "finish-"]],
  ["발끝 감성", "머리는 안 쓰고 발끝으로 감는다", ["finesse+", "headShot-"]],
  ["ZD 역습", "뺏으면 바로 감아서 끝낸다", ["finesse+", "poss-"]],
  ["ZD 원툴", "스루도 크로스도 필요 없다, 감아차기면 된다", ["finesse+", "throughRatio-"]],
  ["땅볼 정직파", "감지도 띄우지도 않고 깔아 찬다", ["lowShot+", "finesse-"]],
  ["낮게 더 낮게", "공은 땅에서 굴러야 한다", ["lowShot+", "headShot-"]],
  ["헤딩 헛방", "머리는 대는데 방향이 안 맞는다", ["headShot+", "finish-"]],
  ["박스 안 공중전", "박스 밖 슈팅은 없다, 머리로 해결", ["headShot+", "longShot-"]],
  ["투박한 타깃맨", "감아차기는 모른다, 머리로 들이받는다", ["headShot+", "finesse-"]],
  ["발리 난사", "떨어지는 공마다 발리, 결과는 하늘에", ["volley+", "finish-"]],
  ["원터치 발리", "잡을 시간이 어딨어, 바로 발리", ["volley+", "dribble-"]],
  ["각도 없는 난사", "각이 없어도 쏘고, 역시 안 들어간다", ["wideShot+", "finish-"]],
  ["측면 끝 슈터", "측면 깊숙이 들어가서 직접 해결", ["wideShot+", "lobRatio-"]],
  ["후반 역습왕", "상대 지친 후반에 역습으로 몰아친다", ["lateGoal+", "poss-"]],
  ["슬로 스타터", "전반엔 조용, 후반에 슈팅이 터진다", ["lateGoal+", "shots-"]],
  ["전반 원툴", "초반 러시 후 방전", ["lateGoal-", "shots+"]],

  /* ===== v2.5.0 확장 — 같은 방향 조합 ===== */
  ["싸움닭 수비", "발은 거친데 골문은 활짝", ["foul+", "ga+"]],
  ["돌리다 한 방", "실컷 돌리다 결국 박스 밖에서", ["longShot+", "poss+"]],
  ["스루 아니면 중거리", "뚫리면 찔러주고, 막히면 멀리서 쏜다", ["longShot+", "throughRatio+"]],
  ["측면 두드리고 중거리", "코너킥도 뽑고 중거리도 쏘는 전방위 공세", ["longShot+", "corner+"]],
  ["거친 포병", "박스 밖에서 쏘고 몸싸움도 거칠게", ["longShot+", "cards+"]],
  ["정교한 중거리파", "패스도 정확, 슈팅은 박스 밖에서", ["longShot+", "passRate+"]],
  ["무법자 스트라이커", "라인도 규칙도 안 지킨다", ["offside+", "foul+"]],
  ["침투 아니면 원더골", "뒷공간 아니면 박스 밖 원더골", ["offside+", "longGoal+"]],
  ["터프한 플레이메이커", "스루는 날카롭게, 몸싸움은 거칠게", ["throughRatio+", "cards+"]],
  ["뺏고 찌르고", "압박으로 뺏고 바로 스루패스", ["tackleTry+", "throughRatio+"]],
  ["패스로 박스까지", "짧은 패스로 박스 안까지 들어가서 넣는다", ["shortRatio+", "boxGoal+"]],
  ["발밑 정밀 배송", "짧고 정확하게, 한 칸씩 전진", ["passRate+", "shortRatio+"]],
  ["ZD 중거리 스나이퍼", "박스 밖 감아차기가 주무기", ["finesse+", "longShot+"]],
  ["감아차기 마스터", "감으면 들어간다, 진짜로", ["finesse+", "finish+"]],
  ["크로스 발리", "올리고 바로 발리로 마무리", ["volley+", "lobRatio+"]],
  ["크로스-헤더 공식", "측면에서 올리고 머리로 끝낸다", ["headShot+", "lobRatio+"]],
  ["측면 파괴자", "측면 끝까지 파고들어 코너킥도 슈팅도", ["wideShot+", "corner+"]],
  ["후반 폭격기", "후반에 골이 쏟아진다", ["lateGoal+", "gf+"]],
  ["막 차는 축구", "점유도 패스도 포기, 몸으로 부딪힌다", ["poss-", "passRate-"]],
  ["원터치 카운터", "공 없이 기다리다 원터치로 역습", ["poss-", "dribble-"]],
  ["평화주의자", "안 뺏고, 안 넣는다", ["tackleTry-", "gf-"]],
  ["조용한 공격수", "안 쏘니 안 들어간다", ["shots-", "gf-"]]
];

/* 레어 3조합 (v2.5.0) — 세 칩이 모두 화면에 있을 때만, 2조합보다 우선 */
export const RARE_COMBOS = [
  ["카운터 스나이퍼", "공 내주고 스루 한 방, 막히면 중거리", ["longShot+", "throughRatio+", "poss-"]],
  ["난사 포병대", "박스 밖에서 쏘고 또 쏘고, 골문은 멀기만", ["shots+", "longShot+", "effRate-"]],
  ["무한 포격", "들어갈 때까지 박스 밖 포격", ["shots+", "longShot+", "finish-"]],
  ["돌격 일변도", "패스는 대충, 라인은 무시, 슈팅은 무조건", ["shots+", "offside+", "passRate-"]],
  ["침투 설계자", "스루와 침투는 많은데 슈팅은 아낀다", ["offside+", "throughRatio+", "shots-"]],
  ["옆패스 공무원", "정확하게, 안전하게, 옆으로만", ["shortRatio+", "passRate+", "throughRatio-"]],
  ["저격형 수비수", "가끔 들어가서 확실하게, 대신 거칠게", ["tackleRate+", "cards+", "tackleTry-"]],
  ["진흙탕 싸움꾼", "뺏고, 부딪히고, 흘린다", ["tackleTry+", "foul+", "passRate-"]],
  ["파상 포격", "코너킥에 중거리까지 다 두드리는데 안 열린다", ["longShot+", "corner+", "finish-"]],
  ["역습 원더골 장인", "뺏으면 박스 밖에서 원더골", ["longGoal+", "longShot+", "poss-"]],
  ["선 넘는 침투꾼", "라인도 넘고 선도 넘는데 슈팅은 없다", ["offside+", "foul+", "shots-"]],
  ["마지막 1m", "박스 안까지 패스로 배달, 그런데 골은…", ["shortRatio+", "boxGoal+", "gf-"]],
  ["무소음 공격", "슈팅도 코너킥도 골도 조용", ["shots-", "gf-", "corner-"]],
  ["정교한 원거리 포수", "패스는 정확, 스루 대신 박스 밖 슈팅", ["longShot+", "passRate+", "throughRatio-"]],
  ["ZD 중독자", "박스 밖 감아차기, 오늘도 골대 옆으로", ["finesse+", "longShot+", "finish-"]],
  ["ZD 스나이퍼", "박스 밖에서 감으면 그대로 골", ["finesse+", "longShot+", "finish+"]],
  ["공중 폭격기", "크로스 올리고 머리로, 코너킥도 머리로", ["lobRatio+", "headShot+", "corner+"]],
  ["원맨 돌격대", "혼자 들고 가서 혼자 쏜다", ["dribble+", "shots+", "passRate-"]],
  ["박물관 티키타카", "공은 실컷 돌리는데 슈팅은 전시용", ["poss+", "shortRatio+", "shots-"]],
  ["공중볼 장인", "크로스에 발리, 헤더까지 공중전은 다 내 것", ["volley+", "headShot+", "lobRatio+"]],
  ["카운터 러너", "공 내주고 스루 받아 라인 뒤로", ["poss-", "throughRatio+", "offside+"]],
  ["거친 역습대", "뺏고 부딪히며 역습, 점유율은 관심 없음", ["poss-", "tackleTry+", "foul+"]]
];

export const DEFAULT_STYLE = ["무난함의 정석", "모든 지표가 랭커 평균, 무난함 그 자체"];
const MIN_Z = 0.5; // 칩 중 가장 큰 편차가 이보다 작으면(=전부 평균 근처) 기본 스타일

/* 지표 값 + 기준값 → 높은/낮은 지표 3개씩과 스타일(반드시 이 6개 칩 안에서 판정)
   v2.5.0: ① 레어 3조합 → ② 2조합 → ③ 단일 순, 같은 단계에서는 가중 편차 합이 큰 것
   실력 지표(SKILL_METRICS)는 가중치 0.7 — 결정력·득점 같은 결과보다 '플레이 방식' 조합이 먼저 뽑히게
   기준값에 없는 지표(새 지표 도입 직후)·값이 없는 지표(슈팅 상세 없음)는 칩 후보에서 제외 */
export function judge(metrics, baseline) {
  const zs = Object.keys(METRICS)
    .filter((k) => metrics[k] != null && baseline[k])
    .map((k) => ({ k, v: metrics[k], avg: baseline[k].mean, z: (metrics[k] - baseline[k].mean) / baseline[k].sd }))
    .sort((a, b) => b.z - a.z);
  const highs = zs.slice(0, 3), lows = zs.slice(-3).reverse();

  // 화면 칩 6개 → { '지표+': 가중 |z| } (▲는 z>0일 때만, ▼는 z<0일 때만 유효한 방향)
  const w = (k) => (SKILL_METRICS.includes(k) ? SKILL_WEIGHT : 1);
  const shown = {};
  for (const x of highs) if (x.z > 0) shown[x.k + "+"] = x.z * w(x.k);
  for (const x of lows) if (x.z < 0) shown[x.k + "-"] = -x.z * w(x.k);

  const best = (table) => {
    let pick = null;
    for (const [name, line, conds] of table) {
      if (!conds.every((c) => c in shown)) continue;
      const score = conds.reduce((a, c) => a + shown[c], 0);
      if (!pick || score > pick.score) pick = { name, line, basis: conds, score };
    }
    return pick;
  };
  let pick = best(RARE_COMBOS) || best(COMBO_STYLES);
  if (!pick) {
    const [key, z] = Object.entries(shown).sort((a, b) => b[1] - a[1])[0] || [];
    if (key && z >= MIN_Z) pick = { name: SINGLE_STYLES[key][0], line: SINGLE_STYLES[key][1], basis: [key] };
  }
  if (!pick) pick = { name: DEFAULT_STYLE[0], line: DEFAULT_STYLE[1], basis: [] };
  pick.rare = RARE_COMBOS.some(([n]) => n === pick.name);

  const round = (x) => Math.round(x * 1000) / 1000;
  // label·unit도 함께 담아 화면(js/members.js)이 지표 정의를 중복 보유하지 않게 함, key=스타일 근거 칩 여부
  const slim = (x, dir) => ({ k: x.k, label: METRICS[x.k].label, unit: METRICS[x.k].unit,
    v: round(x.v), avg: round(x.avg), z: Math.round(x.z * 100) / 100, key: pick.basis.includes(x.k + dir) });
  return {
    style: { name: pick.name, line: pick.line, basis: pick.basis, rare: pick.rare || undefined },
    highs: highs.map((x) => slim(x, "+")),
    lows: lows.map((x) => slim(x, "-"))
  };
}
